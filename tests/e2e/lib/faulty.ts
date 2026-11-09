/**
 * Mandataire HTTP de test, placé devant le faux portail BMC : enregistre les en-têtes reçus et injecte
 * des pannes par chemin (statut, corps arbitraire, redirection, coupure, lenteur), selon le rang de la requête.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export type Fault =
  | 'pass'
  | { status: number; body?: string | Buffer; headers?: Record<string, string> }
  | { destroy: true }
  | { delayMs: number; then?: Fault };

export interface Rule {
  match: RegExp;
  /** n = rang de la requête pour cette règle (1, 2, 3…). */
  fault: (n: number) => Fault;
}

export interface Seen {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  status?: number;
}

export interface FaultyProxy {
  url: string;
  seen: Seen[];
  rules: Rule[];
  close(): Promise<void>;
}

export function startFaultyProxy(upstream: string, rules: Rule[] = []): Promise<FaultyProxy> {
  const seen: Seen[] = [];
  const counts = new Map<Rule, number>();
  const state = { rules };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://proxy');
    const entry: Seen = { method: req.method ?? 'GET', path: url.pathname + url.search, headers: { ...req.headers } };
    seen.push(entry);
    const rule = state.rules.find((r) => r.match.test(url.pathname));
    let fault: Fault = 'pass';
    if (rule) {
      const n = (counts.get(rule) ?? 0) + 1;
      counts.set(rule, n);
      fault = rule.fault(n);
    }
    const apply = (f: Fault): void => {
      if (f === 'pass') {
        const headers = { ...req.headers };
        delete headers.host;
        const up = http.request(new URL(req.url ?? '/', upstream), { method: req.method, headers }, (ur) => {
          entry.status = ur.statusCode;
          res.writeHead(ur.statusCode ?? 502, ur.headers);
          ur.pipe(res);
        });
        up.on('error', () => {
          entry.status = 502;
          res.writeHead(502);
          res.end();
        });
        req.pipe(up);
        return;
      }
      if ('destroy' in f) {
        entry.status = -1;
        req.socket.destroy();
        return;
      }
      if ('delayMs' in f) {
        setTimeout(() => apply(f.then ?? 'pass'), f.delayMs);
        return;
      }
      entry.status = f.status;
      const body = f.body ?? '';
      res.writeHead(f.status, { 'Content-Length': String(Buffer.byteLength(body)), ...(f.headers ?? {}) });
      res.end(body);
    };
    apply(fault);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        seen,
        get rules() {
          return state.rules;
        },
        set rules(r: Rule[]) {
          state.rules = r;
          counts.clear();
        },
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}

/** Petit serveur statique (autre origine) qui enregistre les en-têtes reçus. */
export function startRecorder(files: Record<string, { body: Buffer | string; type?: string }>): Promise<{ url: string; seen: Seen[]; close(): Promise<void> }> {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://rec');
    seen.push({ method: req.method ?? 'GET', path: url.pathname, headers: { ...req.headers } });
    const f = files[url.pathname];
    if (!f) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': f.type ?? 'application/octet-stream', 'Content-Length': String(Buffer.byteLength(f.body)) });
    res.end(f.body);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        seen,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}

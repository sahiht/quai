/**
 * Pilotage du simulateur Even Hub (API d'automatisation) pour les tests de bout en bout :
 * lancement sous xvfb-run, journal de la console (QUAI_READY, QUAI_SCREEN), gestes, captures des lunettes.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { PNG } from 'pngjs';

export const SIM_BIN = process.env.EVENHUB_SIMULATOR ?? '/home/claude/tools/node_modules/@evenrealities/sim-linux-x64/bin/evenhub-simulator';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Screen {
  screen: string;
  title: string;
  lines: string[];
  clock?: string;
  sel?: number;
}
export interface ConsoleEntry {
  id: number;
  level: string;
  message: string;
  ts: number;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** Serveur statique (appli construite + fichiers en plus, ex. /preset.json), avec CORS. */
export function startStatic(dir: string, extra: Record<string, string> = {}): Promise<{ url: string; close(): Promise<void> }> {
  const root = resolve(dir);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://static');
    let path = extra[url.pathname] ?? normalize(join(root, decodeURIComponent(url.pathname)));
    if (!extra[url.pathname] && path !== root && !path.startsWith(root + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'index.html');
    if (!existsSync(path)) {
      res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
      res.end('introuvable');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
    createReadStream(path).pipe(res);
  });
  return new Promise((r) =>
    server.listen(0, '127.0.0.1', () =>
      r({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      }),
    ),
  );
}

/** Pixels allumés (alpha > 0) d'une capture RGBA des lunettes. */
export function litPixels(png: Buffer): { lit: number; width: number; height: number } {
  const img = PNG.sync.read(png);
  let lit = 0;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 0) lit++;
  return { lit, width: img.width, height: img.height };
}

export class Sim {
  proc: ChildProcess | null = null;
  readonly api: string;
  private lastId = -1;
  entries: ConsoleEntry[] = [];
  screens: (Screen & { at: number; id: number })[] = [];
  out: string[] = [];
  /** Rang de la dernière capture d'écran QUAI_SCREEN vue avant le dernier geste. */
  private mark = -1;

  constructor(
    readonly port: number,
    readonly shotsDir: string,
  ) {
    this.api = `http://127.0.0.1:${port}`;
    mkdirSync(shotsDir, { recursive: true });
  }

  async call(path: string, init?: RequestInit): Promise<Response> {
    const r = await fetch(this.api + path, init);
    if (!r.ok) throw new Error(`${path} : HTTP ${r.status}`);
    return r;
  }

  async launch(url: string, opts: { waitReady?: boolean; onPing?: () => Promise<void> } = {}): Promise<void> {
    await this.stop();
    this.lastId = -1;
    this.entries = [];
    this.screens = [];
    this.mark = -1;
    this.out = [];
    this.proc = spawn('xvfb-run', ['-a', SIM_BIN, '--automation-port', String(this.port), url], { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, RUST_LOG: process.env.RUST_LOG ?? 'info' } });
    this.proc.stdout?.on('data', (b: Buffer) => this.out.push(b.toString()));
    this.proc.stderr?.on('data', (b: Buffer) => this.out.push(b.toString()));
    const t0 = Date.now();
    for (;;) {
      if (Date.now() - t0 > 30_000) throw new Error(`simulateur injoignable sur ${this.api}\n${this.out.join('').slice(-2000)}`);
      try {
        if ((await (await fetch(this.api + '/api/ping')).text()).includes('pong')) break;
      } catch {
        /* pas encore prêt */
      }
      await sleep(150);
    }
    if (opts.onPing) await opts.onPing();
    if (opts.waitReady !== false) await this.waitLog((m) => m === 'QUAI_READY', 40_000, 'QUAI_READY');
  }

  async stop(): Promise<void> {
    const p = this.proc;
    if (!p) return;
    this.proc = null;
    try {
      process.kill(-(p.pid as number), 'SIGTERM');
    } catch {
      /* déjà arrêté */
    }
    for (let i = 0; i < 30; i++) {
      try {
        await fetch(this.api + '/api/ping');
        await sleep(200);
      } catch {
        return;
      }
    }
    try {
      process.kill(-(p.pid as number), 'SIGKILL');
    } catch {
      /* rien */
    }
  }

  /** Lit les nouvelles entrées de la console. */
  async drain(): Promise<ConsoleEntry[]> {
    const q = this.lastId >= 0 ? `?since_id=${this.lastId}` : '';
    const { entries } = (await (await this.call(`/api/console${q}`)).json()) as { entries: ConsoleEntry[] };
    const fresh = entries.filter((e) => e.id > this.lastId);
    for (const e of fresh) {
      this.lastId = Math.max(this.lastId, e.id);
      this.entries.push(e);
      if (e.message.startsWith('QUAI_SCREEN ')) {
        try {
          this.screens.push({ ...(JSON.parse(e.message.slice(12)) as Screen), at: Date.now(), id: e.id });
        } catch {
          /* ligne tronquée */
        }
      }
    }
    return fresh;
  }

  get last(): Screen | undefined {
    return this.screens[this.screens.length - 1];
  }

  async waitLog(pred: (m: string) => boolean, timeout = 10_000, label = 'message'): Promise<string> {
    const t0 = Date.now();
    let seen = this.entries.length;
    while (Date.now() - t0 < timeout) {
      await this.drain();
      for (; seen < this.entries.length; seen++) if (pred(this.entries[seen].message)) return this.entries[seen].message;
      await sleep(120);
    }
    throw new Error(`délai dépassé en attendant ${label}`);
  }

  /** Attend un écran (rendu après le dernier geste) qui vérifie `pred`. */
  async waitScreen(pred: (s: Screen) => boolean, timeout = 12_000, label = 'écran'): Promise<Screen> {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      await this.drain();
      const s = this.screens[this.screens.length - 1];
      if (s && s.id > this.mark && pred(s)) return s;
      await sleep(120);
    }
    const s = this.last;
    throw new Error(`délai dépassé en attendant ${label} (dernier écran : ${s ? `${s.screen} « ${s.title} » ${JSON.stringify(s.lines)}` : 'aucun'})`);
  }

  async input(action: 'up' | 'down' | 'click' | 'double_click', pause = 450): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.drain();
      this.mark = this.screens.length ? this.screens[this.screens.length - 1].id : -1;
      const from = this.entries.length;
      await this.call('/api/input', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) });
      await sleep(pause);
      // Un glissement reçu dans les 80 ms d'un rendu (horloge accélérée du simulateur, rafraîchissement) est écarté par
      // l'anti-rebond des lunettes (journal QUAI_GESTURE « écarté : après un rendu ») : une personne le referait.
      if (action !== 'up' && action !== 'down') return;
      await this.drain();
      if (!this.entries.slice(from).some((e) => e.message.startsWith(`QUAI_GESTURE ${action} écarté : après un rendu`))) return;
    }
  }

  /** Déplace la sélection jusqu'à `index`. */
  async select(index: number, timeout = 10_000): Promise<void> {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      await this.drain();
      const cur = this.last?.sel ?? 0;
      if (cur === index) return;
      await this.input(cur < index ? 'down' : 'up', 500);
    }
    throw new Error(`sélection ${index} non atteinte (sel ${this.last?.sel})`);
  }

  async shot(name: string): Promise<{ file: string; lit: number }> {
    const buf = Buffer.from(await (await this.call('/api/screenshot/glasses')).arrayBuffer());
    const file = join(this.shotsDir, `${name}.png`);
    writeFileSync(file, buf);
    return { file, lit: litPixels(buf).lit };
  }

  async rawShot(): Promise<Buffer> {
    return Buffer.from(await (await this.call('/api/screenshot/glasses')).arrayBuffer());
  }

  async webviewShot(name: string): Promise<string> {
    const buf = Buffer.from(await (await this.call('/api/screenshot/webview')).arrayBuffer());
    const file = join(this.shotsDir, `${name}.png`);
    writeFileSync(file, buf);
    return file;
  }

  /** Erreurs de la console (exceptions, rejets, erreurs). */
  errors(): ConsoleEntry[] {
    return this.entries.filter((e) => e.level === 'error' || e.message.startsWith('[uncaught]') || e.message.startsWith('[unhandledrejection]'));
  }
}

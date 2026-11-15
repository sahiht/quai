/**
 * 1.3.0 : hôte simulé pour le simulateur Even Hub 0.9.5 (tests de bout en bout seulement).
 *
 * L'API d'automatisation du simulateur ne connaît que les gestes, la console et les captures : ni capteur de mouvement
 * (imuControl, mesures x, y, z), ni état des lunettes (batterie, port), ni moyen d'agir sur la page du téléphone. Les
 * scénarios s130 en ont besoin (PRD-1.3.0 § 6.1 à § 6.4). Le serveur statique des tests (lib/sim.ts, startStatic) sert
 * alors la page avec un petit script en tête (`/__host/shim.js`), seulement quand l'adresse porte `e2eHost=1` :
 *
 *  - il entoure `window.flutter_inappwebview.callHandler` (le pont posé par le simulateur) : `imuControl` reçoit la
 *    réponse d'un vrai hôte (true) et, tant qu'il est ouvert, une mesure `sysEvent` (eventType 8, imuData) part toutes
 *    les `reportFrq` ms avec la pose réglée par le test ; chaque appel qui compte (imuControl, page entière, écriture
 *    du stockage) est noté dans la console (`QUAI_HOST {...}`), que le test lit par /api/console ;
 *  - il pousse l'état des lunettes comme l'appli Even (`deviceStatusChanged` : connectType, isWearing, batteryLevel) ;
 *  - il exécute les ordres du test (file d'attente lue toutes les 120 ms) : état des lunettes, pose du capteur,
 *    événement brut, et `eval` (lire ou toucher la page du téléphone, régler l'horloge simulée par
 *    `window.__quaiClock.set`, pousser une position par `window.__quaiPushFix`), comme Runtime.evaluate dans Chrome.
 *
 * Formes vérifiées sur le SDK 0.0.16 (sonde Node) : imuControl envoie `{ method: 'imuControl', data: { iMUReportEn,
 * reportFrq } }` et ne rend vrai que si le pont répond `true` ; `deviceStatusChanged` est la méthode reconnue pour l'état
 * des lunettes ; une mesure arrive en `evenHubEvent` `['sysEvent', { eventType: 8, imuData: { x, y, z } }]`.
 * Rien de tout cela n'existe hors des tests : l'appli construite n'est pas modifiée, le script n'est servi que par ce
 * serveur local, et seulement sur demande.
 */
import type http from 'node:http';

export interface HostCall {
  /** méthode du pont (imuControl, rebuildPageContainer, createStartUpPageContainer, setLocalStorage, …) */
  m: string;
  /** heure (Date.now() de la page) */
  t: number;
  /** imuControl : ouvert et cadence ; setLocalStorage : clé et longueur */
  on?: boolean;
  pace?: number;
  key?: string;
  len?: number;
}

export interface DeviceStatus {
  connectType?: 'connected' | 'disconnected' | 'connecting' | 'none' | 'connectionFailed';
  isWearing?: boolean;
  batteryLevel?: number;
  isCharging?: boolean;
  isInCase?: boolean;
}

export interface Pose {
  x: number;
  y: number;
  z: number;
}

type CmdBody =
  | { kind: 'device'; status: DeviceStatus & { sn: string } }
  | { kind: 'imu'; pose: Pose; noise: number }
  | { kind: 'event'; type: string; data: unknown }
  | { kind: 'eval'; code: string };
type Cmd = { id: number } & CmdBody;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Script injecté en tête de la page (ES5, aucune dépendance). */
const SHIM = String.raw`(function () {
  if (window.__quaiHost) return;
  var host = { store: {}, pose: { x: 0, y: -1, z: 0 }, noise: 0, imuTimer: null, imuPace: 0, last: 0, busy: false };
  window.__quaiHost = host;
  function note(o) { try { o.t = Date.now(); console.log('QUAI_HOST ' + JSON.stringify(o)); } catch (e) {} }
  function deliver(msg) {
    if (typeof window._listenEvenAppMessage === 'function') { window._listenEvenAppMessage(msg); return true; }
    note({ m: 'erreur', why: 'pont du SDK pas encore prêt' });
    return false;
  }
  function hub(type, data) { return deliver({ type: 'listen_even_app_data', method: 'evenHubEvent', data: [type, data] }); }
  function jitter() { return host.noise ? (Math.random() * 2 - 1) * host.noise : 0; }
  function sample() {
    var p = host.pose;
    hub('sysEvent', { eventType: 8, imuData: { x: p.x + jitter(), y: p.y + jitter(), z: p.z + jitter() } });
  }
  function imu(on, pace) {
    if (host.imuTimer) { clearInterval(host.imuTimer); host.imuTimer = null; }
    host.imuPace = on ? pace : 0;
    if (on) host.imuTimer = setInterval(sample, Math.max(100, pace || 100));
  }
  var fb = window.flutter_inappwebview;
  if (fb && typeof fb.callHandler === 'function') {
    var orig = fb.callHandler;
    fb.callHandler = function (name, arg) {
      var msg = null;
      try { msg = typeof arg === 'string' ? JSON.parse(arg) : arg; } catch (e) {}
      var m = msg && msg.method;
      var d = (msg && msg.data) || {};
      if (m === 'imuControl') {
        var on = d.iMUReportEn === 1 || d.iMUReportEn === true || d.isOpen === true;
        var pace = Number(d.reportFrq) || 100;
        note({ m: m, on: on, pace: pace });
        imu(on, pace);
        return Promise.resolve(true);
      }
      if (m === 'setLocalStorage') {
        var k = String(d.key == null ? '' : d.key);
        var v = d.value == null ? '' : String(d.value);
        host.store[k] = v;
        note({ m: m, key: k, len: v.length });
      } else if (m === 'createStartUpPageContainer' || m === 'rebuildPageContainer' || m === 'shutDownPageContainer') {
        note({ m: m });
      }
      return orig.apply(this, arguments);
    };
  } else {
    note({ m: 'erreur', why: 'pont flutter_inappwebview absent' });
  }
  function run(c) {
    if (c.kind === 'device') return deliver({ type: 'listen_even_app_data', method: 'deviceStatusChanged', data: c.status });
    if (c.kind === 'imu') { host.pose = c.pose; host.noise = c.noise || 0; return true; }
    if (c.kind === 'event') return hub(c.type, c.data);
    if (c.kind === 'eval') return (0, eval)(c.code);
    throw new Error('ordre inconnu ' + c.kind);
  }
  function answer(id, ok, value) {
    var body;
    try { body = JSON.stringify({ id: id, ok: ok, value: value === undefined ? null : value }); }
    catch (e) { body = JSON.stringify({ id: id, ok: false, value: 'réponse non sérialisable' }); }
    return fetch('/__host/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body }).catch(function () {});
  }
  function poll() {
    if (host.busy) return;
    host.busy = true;
    fetch('/__host/cmd?after=' + host.last, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (cmds) {
        var chain = Promise.resolve();
        cmds.forEach(function (c) {
          host.last = Math.max(host.last, c.id);
          chain = chain.then(function () {
            return Promise.resolve()
              .then(function () { return run(c); })
              .then(function (v) { return answer(c.id, true, v); }, function (e) { return answer(c.id, false, String((e && e.message) || e)); });
          });
        });
        return chain;
      })
      .catch(function () {})
      .then(function () { host.busy = false; });
  }
  setInterval(poll, 120);
  note({ m: 'pret' });
})();
`;

/**
 * Côté test : la file des ordres et leurs réponses (même processus que le serveur statique). Un seul simulateur à la
 * fois : `reset()` avant chaque lancement oublie les ordres d'une page précédente.
 */
export class HostBridge {
  private queue: Cmd[] = [];
  private nextId = 1;
  private results = new Map<number, { ok: boolean; value: unknown }>();
  /** dernier ordre lu par la page (elle est vivante) */
  private seen = 0;
  private lastPoll = 0;

  /** Oublie la file (nouveau lancement du simulateur). */
  reset(): void {
    this.queue = [];
    this.results.clear();
    this.seen = 0;
    this.lastPoll = 0;
  }

  /** La page interroge la file depuis moins de 2 s. */
  alive(): boolean {
    return Date.now() - this.lastPoll < 2000;
  }

  private async send(cmd: CmdBody, timeout = 10_000): Promise<unknown> {
    const id = this.nextId++;
    this.queue.push({ ...cmd, id });
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const r = this.results.get(id);
      if (r) {
        this.results.delete(id);
        if (!r.ok) throw new Error(`hôte simulé : ${String(r.value)}`);
        return r.value;
      }
      await sleep(60);
    }
    throw new Error(`hôte simulé : pas de réponse de la page à l’ordre ${cmd.kind} en ${timeout} ms (script /__host/shim.js chargé ? adresse avec e2eHost=1 ?)`);
  }

  /** État des lunettes poussé comme l'appli Even (onDeviceStatusChanged). */
  device(status: DeviceStatus): Promise<unknown> {
    return this.send({ kind: 'device', status: { sn: 'S200E2E0000001', connectType: 'connected', isWearing: true, isCharging: false, isInCase: false, ...status } });
  }

  /** Pose du capteur de mouvement : envoyée à la cadence demandée par imuControl, tant qu'il est ouvert. */
  imu(pose: Pose, noise = 0.01): Promise<unknown> {
    return this.send({ kind: 'imu', pose, noise });
  }

  /** Événement brut du SDK (evenHubEvent). */
  event(type: 'sysEvent' | 'textEvent' | 'listEvent', data: unknown): Promise<unknown> {
    return this.send({ kind: 'event', type, data });
  }

  /** Expression évaluée dans la page (résultat sérialisable ; une promesse est attendue). */
  async eval<T>(code: string, timeout = 10_000): Promise<T> {
    return (await this.send({ kind: 'eval', code }, timeout)) as T;
  }

  /** Valeur écrite par l'appli dans le stockage du téléphone (setLocalStorage), telle que l'hôte l'a reçue. */
  storage(key: string): Promise<string | null> {
    return this.eval<string | null>(`(window.__quaiHost && window.__quaiHost.store[${JSON.stringify(key)}]) ?? null`);
  }

  /** Routes du serveur statique ; vrai si la requête a été servie. */
  handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL): boolean {
    if (!url.pathname.startsWith('/__host/')) return false;
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/__host/shim.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(SHIM);
      return true;
    }
    if (url.pathname === '/__host/cmd') {
      this.lastPoll = Date.now();
      const after = Number(url.searchParams.get('after') ?? 0);
      this.seen = Math.max(this.seen, after);
      json(200, this.queue.filter((c) => c.id > after));
      this.queue = this.queue.filter((c) => c.id > after);
      return true;
    }
    if (url.pathname === '/__host/result' && req.method === 'POST') {
      let body = '';
      req.on('data', (b: Buffer) => (body += b.toString()));
      req.on('end', () => {
        try {
          const r = JSON.parse(body) as { id: number; ok: boolean; value: unknown };
          this.results.set(r.id, { ok: r.ok, value: r.value });
          json(200, { ok: true });
        } catch {
          json(400, { ok: false });
        }
      });
      return true;
    }
    json(404, { error: 'route inconnue' });
    return true;
  }

  /** Page servie avec le script de l'hôte en tête (avant les scripts de l'appli). */
  static inject(html: string): string {
    const tag = '<script src="/__host/shim.js"></script>';
    return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}\n    ${tag}`) : `${tag}\n${html}`;
  }
}

/** Appels notés par l'hôte simulé dans la console (QUAI_HOST), depuis le rang `from` des entrées du simulateur. */
export function hostCalls(entries: { message: string }[], from = 0): HostCall[] {
  const out: HostCall[] = [];
  for (const e of entries.slice(from)) {
    if (!e.message.startsWith('QUAI_HOST ')) continue;
    try {
      out.push(JSON.parse(e.message.slice(10)) as HostCall);
    } catch {
      /* ligne tronquée */
    }
  }
  return out;
}

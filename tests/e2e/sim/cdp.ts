/**
 * Pilote minimal de Chrome sans affichage (protocole DevTools, sans dépendance : WebSocket de Node 22) pour les
 * contrôles de l'interface du téléphone : page de l'appli construite (même code que dans l'appli Even, lunettes
 * dessinées dans l'émulateur de la page), console (QUAI_SCREEN), clics, saisie, captures 390 × 844 en densité 2.
 * Sert aussi pour Quai Web (gestes par sa barre de boutons, position refusée par permission du navigateur).
 * Le stockage local de la page reste d'un chargement à l'autre (réouverture de Quai).
 *
 * Binaire : google-chrome (variable CHROME_BIN pour un autre emplacement).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CHROME_BIN = process.env.CHROME_BIN ?? ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => existsSync(p)) ?? 'google-chrome';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Json = Record<string, unknown>;
interface Pending {
  resolve(v: Json): void;
  reject(e: Error): void;
  method: string;
}

export interface ConsoleLine {
  type: string;
  text: string;
  at: number;
}

/** Écran des lunettes journalisé par l'appli (mode test). */
export interface GlassesScreen {
  screen: string;
  title: string;
  lines: string[];
  clock?: string;
  sel?: number;
  [k: string]: unknown;
}

export class Chrome {
  private ws!: WebSocket;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private listeners = new Set<(method: string, params: Json, sessionId?: string) => void>();
  private constructor(
    private proc: ChildProcess,
    private profile: string,
  ) {}

  /** Lance Chrome sans affichage avec un profil neuf (stockage vide). */
  static async launch(): Promise<Chrome> {
    const profile = mkdtempSync(join(tmpdir(), 'quai-chrome-'));
    const proc = spawn(
      CHROME_BIN,
      [
        '--headless=new',
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-networking',
        '--hide-scrollbars',
        '--lang=fr-BE',
        '--font-render-hinting=none',
        'about:blank',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], detached: true },
    );
    const url = await new Promise<string>((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => reject(new Error(`Chrome ne démarre pas (${CHROME_BIN})\n${buf.slice(-1500)}`)), 20_000);
      const on = (b: Buffer) => {
        buf += b.toString();
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
        if (m) {
          clearTimeout(timer);
          resolve(m[1]);
        }
      };
      proc.stderr?.on('data', on);
      proc.stdout?.on('data', on);
      proc.on('exit', (code) => reject(new Error(`Chrome arrêté (code ${code})\n${buf.slice(-1500)}`)));
    });
    const c = new Chrome(proc, profile);
    c.ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      c.ws.addEventListener('open', () => resolve(), { once: true });
      c.ws.addEventListener('error', () => reject(new Error('connexion DevTools impossible')), { once: true });
    });
    c.ws.addEventListener('message', (ev) => c.onMessage(String((ev as MessageEvent).data)));
    return c;
  }

  private onMessage(data: string): void {
    const msg = JSON.parse(data) as { id?: number; result?: Json; error?: { message: string }; method?: string; params?: Json; sessionId?: string };
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method} : ${msg.error.message}`));
      else p.resolve(msg.result ?? {});
      return;
    }
    if (msg.method) for (const l of this.listeners) l(msg.method, msg.params ?? {}, msg.sessionId);
  }

  send(method: string, params: Json = {}, sessionId?: string): Promise<Json> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  on(l: (method: string, params: Json, sessionId?: string) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Nouvel onglet aux dimensions d'un téléphone (390 × 844, densité 2, tactile). */
  async newPage(viewport = { width: 390, height: 844, dpr: 2, mobile: true }): Promise<Page> {
    const { targetId } = (await this.send('Target.createTarget', { url: 'about:blank' })) as { targetId: string };
    const { sessionId } = (await this.send('Target.attachToTarget', { targetId, flatten: true })) as { sessionId: string };
    const page = new Page(this, sessionId, targetId);
    await page.init(viewport);
    return page;
  }

  async close(): Promise<void> {
    try {
      await Promise.race([this.send('Browser.close'), sleep(2000)]);
    } catch {
      /* déjà fermé */
    }
    try {
      this.ws.close();
    } catch {
      /* rien */
    }
    try {
      process.kill(-(this.proc.pid as number), 'SIGKILL');
    } catch {
      /* déjà arrêté */
    }
    await sleep(200);
    rmSync(this.profile, { recursive: true, force: true });
  }
}

export class Page {
  console: ConsoleLine[] = [];
  errors: string[] = [];
  private loaded = 0;
  constructor(
    private chrome: Chrome,
    readonly sessionId: string,
    readonly targetId: string,
  ) {
    chrome.on((method, params, sid) => {
      if (sid !== this.sessionId) return;
      if (method === 'Runtime.consoleAPICalled') {
        const args = (params.args as { type: string; value?: unknown; description?: string }[]) ?? [];
        const text = args.map((a) => (a.value !== undefined ? (typeof a.value === 'string' ? a.value : JSON.stringify(a.value)) : (a.description ?? ''))).join(' ');
        this.console.push({ type: String(params.type), text, at: Date.now() });
      } else if (method === 'Runtime.exceptionThrown') {
        const d = params.exceptionDetails as { text?: string; exception?: { description?: string } };
        this.errors.push(`${d.text ?? ''} ${d.exception?.description ?? ''}`.trim());
      } else if (method === 'Page.loadEventFired') this.loaded++;
    });
  }

  send(method: string, params: Json = {}): Promise<Json> {
    return this.chrome.send(method, params, this.sessionId);
  }

  async init(v: { width: number; height: number; dpr: number; mobile: boolean }): Promise<void> {
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Emulation.setDeviceMetricsOverride', { width: v.width, height: v.height, deviceScaleFactor: v.dpr, mobile: v.mobile });
    if (v.mobile) await this.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await this.send('Emulation.setLocaleOverride', { locale: 'fr-BE' }).catch(() => undefined);
    await this.send('Emulation.setTimezoneOverride', { timezoneId: 'Europe/Brussels' }).catch(() => undefined);
  }

  /** Ouvre une adresse et attend la fin du chargement. */
  async goto(url: string, settleMs = 300): Promise<void> {
    const before = this.loaded;
    const r = (await this.send('Page.navigate', { url })) as { loaderId?: string };
    if (!r.loaderId) {
      // même document (seule l'ancre change) : pas de chargement, le routeur de l'appli suit l'ancre
      await sleep(settleMs + 200);
      return;
    }
    const t0 = Date.now();
    while (this.loaded === before && Date.now() - t0 < 20_000) await sleep(50);
    await sleep(settleMs);
  }

  /** Recharge la page (réouverture de Quai : le stockage local reste). */
  async reload(settleMs = 300): Promise<void> {
    const before = this.loaded;
    await this.send('Page.reload', { ignoreCache: false });
    const t0 = Date.now();
    while (this.loaded === before && Date.now() - t0 < 20_000) await sleep(50);
    await sleep(settleMs);
  }

  /** Évalue une expression dans la page (promesses attendues, valeur sérialisée). */
  async eval<T = unknown>(expression: string): Promise<T> {
    const r = (await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })) as {
      result: { value?: T };
      exceptionDetails?: { text: string; exception?: { description?: string } };
    };
    if (r.exceptionDetails) throw new Error(`évaluation : ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value as T;
  }

  /** Attend qu'une expression soit vraie (valeur renvoyée). */
  async waitFor<T = unknown>(expression: string, timeout = 10_000, label = expression): Promise<T> {
    const t0 = Date.now();
    let last: unknown;
    while (Date.now() - t0 < timeout) {
      try {
        last = await this.eval<T>(expression);
        if (last) return last as T;
      } catch (e) {
        last = (e as Error).message;
      }
      await sleep(100);
    }
    throw new Error(`délai dépassé : ${label} (dernière valeur : ${JSON.stringify(last)?.slice(0, 300)})`);
  }

  /** Clique le premier élément visible dont le texte contient `text` (boutons, liens, options), dans `scope` (sélecteur CSS). */
  async clickText(text: string, scope = 'body', tags = 'button,a,[role=option],[role=radio],label,summary'): Promise<void> {
    const ok = await this.eval<boolean>(`(() => {
      const want = ${JSON.stringify(text)};
      const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
      const roots = [...document.querySelectorAll(${JSON.stringify(scope)})];
      const els = (roots.length ? roots : [document.body])
        .flatMap((root) => [...root.querySelectorAll(${JSON.stringify(tags)})])
        .filter((e) => e.offsetParent !== null || e.getClientRects().length);
      const el = els.find((e) => norm(e.textContent) === want) || els.find((e) => norm(e.textContent).includes(want)) || els.find((e) => norm(e.getAttribute('aria-label')).includes(want));
      if (!el) return false;
      el.scrollIntoView({ block: 'center' });
      el.click();
      return true;
    })()`);
    if (!ok) throw new Error(`élément « ${text} » introuvable`);
  }

  /** Clique un élément par sélecteur CSS. */
  async click(selector: string): Promise<void> {
    const ok = await this.eval<boolean>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true; })()`);
    if (!ok) throw new Error(`sélecteur ${selector} introuvable`);
  }

  /** Saisie dans un champ (focus, texte remplacé, événement input comme au clavier). */
  async type(selector: string, text: string): Promise<void> {
    const ok = await this.eval<boolean>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.focus();
      el.value = ${JSON.stringify(text)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    if (!ok) throw new Error(`champ ${selector} introuvable`);
  }

  /** Texte visible de la page (ou d'une partie), espaces insécables remplacées par des espaces, espaces normalisés. */
  text(selector = 'main'): Promise<string> {
    return this.eval<string>(`(document.querySelector(${JSON.stringify(selector)})?.innerText || '').replace(/[\\u00a0\\u202f]/g, ' ').replace(/[ \\t]+/g, ' ')`);
  }

  /** Ajoute une feuille de style (captures sans l'émulateur des lunettes de la page de développement). */
  async addStyle(css: string): Promise<void> {
    await this.eval(`(() => { const s = document.createElement('style'); s.dataset.qa = '1'; s.textContent = ${JSON.stringify(css)}; document.head.appendChild(s); return true; })()`);
  }

  /** Permission du navigateur pour toutes les origines (Quai Web : position refusée par l'utilisateur). */
  async permission(name: string, setting: 'granted' | 'denied' | 'prompt'): Promise<void> {
    await this.chrome.send('Browser.setPermission', { permission: { name }, setting });
  }

  /** Téléphone hors ligne (navigator.onLine faux, requêtes refusées) ou de nouveau en ligne. */
  async offline(on: boolean): Promise<void> {
    await this.send('Network.enable');
    await this.send('Network.emulateNetworkConditions', { offline: on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  }

  async screenshot(file: string): Promise<void> {
    const { data } = (await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })) as { data: string };
    writeFileSync(file, Buffer.from(data, 'base64'));
  }

  /** Écrans des lunettes journalisés (QUAI_SCREEN), du plus ancien au plus récent. */
  screens(): GlassesScreen[] {
    const out: GlassesScreen[] = [];
    for (const l of this.console) {
      if (!l.text.startsWith('QUAI_SCREEN ')) continue;
      try {
        out.push(JSON.parse(l.text.slice(12)) as GlassesScreen);
      } catch {
        /* ligne tronquée */
      }
    }
    return out;
  }

  lastScreen(): GlassesScreen | undefined {
    const s = this.screens();
    return s[s.length - 1];
  }

  /** Attend un écran des lunettes (journal) qui vérifie `pred`, journalisé après le rang `since`. */
  async waitScreen(pred: (s: GlassesScreen) => boolean, timeout = 15_000, label = 'écran des lunettes', since = 0): Promise<GlassesScreen> {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const all = this.screens();
      for (let i = all.length - 1; i >= since; i--) if (pred(all[i])) return all[i];
      await sleep(100);
    }
    const s = this.lastScreen();
    throw new Error(`délai dépassé en attendant ${label} (dernier : ${s ? `${s.screen} « ${s.title} » ${JSON.stringify(s.lines)}` : 'aucun'})`);
  }

  /**
   * Geste sur l'émulateur des lunettes de la page (boutons ▲ ▼ Toucher Double toucher), espacés comme sur les G2
   * (le filtre des gestes ignore deux glissements de même sens à moins de 350 ms). Jamais de double toucher sur
   * l'écran racine : la page de développement demanderait « Quitter Quai ? » dans une boîte du navigateur.
   */
  async gesture(g: 'up' | 'down' | 'tap' | 'double', bar = '.g-emu'): Promise<void> {
    await this.click(`${bar} button[data-g="${g}"]`);
    await sleep(450);
  }

  async close(): Promise<void> {
    await this.chrome.send('Target.closeTarget', { targetId: this.targetId }).catch(() => undefined);
  }
}

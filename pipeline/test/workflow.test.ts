/** .github/workflows/nightly.yml : YAML valide et conforme au cahier des charges. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { ROOT_DIR } from './helpers.ts';

const text = readFileSync(join(ROOT_DIR, '.github', 'workflows', 'nightly.yml'), 'utf8');

interface Step { name?: string; uses?: string; run?: string; with?: Record<string, unknown>; env?: Record<string, string>; id?: string; if?: string; 'working-directory'?: string; 'continue-on-error'?: boolean }
interface Job { needs?: string | string[]; if?: string; permissions?: Record<string, string>; environment?: { name: string; url?: string }; steps: Step[]; 'timeout-minutes'?: number }
interface Workflow {
  name: string;
  on: { schedule: { cron: string }[]; workflow_dispatch: unknown; push?: { branches: string[]; paths: string[] } };
  permissions: Record<string, string>;
  concurrency: { group: string; 'cancel-in-progress': boolean };
  jobs: Record<string, Job>;
}

const wf = parse(text, { strict: true, uniqueKeys: true }) as Workflow;
const uses = (job: string) => wf.jobs[job].steps.map((s) => s.uses).filter(Boolean);

describe('nightly.yml', () => {
  it('est un YAML valide, sans tabulation ni tiret cadratin', () => {
    expect(wf).toBeTypeOf('object');
    expect(text).not.toContain('\t');
    expect(text).not.toContain('\u2014');
  });

  it('se déclenche chaque nuit à 01:15 UTC et à la demande', () => {
    expect(wf.on.schedule).toEqual([{ cron: '15 1 * * *' }]);
    expect('workflow_dispatch' in wf.on).toBe(true);
  });

  it('permissions du flux, concurrence sans interruption', () => {
    expect(wf.permissions).toEqual({ contents: 'read', pages: 'write', 'id-token': 'write' });
    expect(wf.concurrency.group).toBeTruthy();
    expect(wf.concurrency['cancel-in-progress']).toBe(false);
  });

  it('job build : moindre privilège, contrôle du secret en français, Node 22 avec cache npm, npm ci, données vers site/', () => {
    const b = wf.jobs.build;
    expect(b.permissions).toEqual({ contents: 'read', pages: 'read' });
    const check = b.steps[0];
    expect(check.env?.BMC_KEY).toBe('${{ secrets.BMC_KEY }}');
    expect(check.run).toContain('if [ -z "$BMC_KEY" ]');
    expect(check.run).toContain("Le secret BMC_KEY n'est pas défini");
    expect(check.run).toContain('exit 1');
    expect(uses('build')).toEqual(['actions/checkout@v7', 'actions/setup-node@v7', 'actions/cache/restore@v6', 'actions/cache/save@v6', 'actions/configure-pages@v6', 'actions/upload-pages-artifact@v5']);
    const node = b.steps.find((s) => s.uses === 'actions/setup-node@v7');
    // cache npm du pipeline et de l'appli (Quai Web)
    expect(node?.with).toEqual({ 'node-version': 22, cache: 'npm', 'cache-dependency-path': 'pipeline/package-lock.json\napp/package-lock.json\n' });
    const ci = b.steps.find((s) => s.run === 'npm ci');
    expect(ci?.['working-directory']).toBe('pipeline');
    const data = b.steps.find((s) => s.run?.startsWith('npm run build-data'));
    expect(data?.run).toBe('npm run build-data -- --out ../site/data --site ../site --cache-dir ../gtfs-cache');
    expect(data?.['working-directory']).toBe('pipeline');
    expect(data?.env).toEqual({ BMC_KEY: '${{ secrets.BMC_KEY }}' });
    expect(b.steps.find((s) => s.uses === 'actions/upload-pages-artifact@v5')?.with).toEqual({ path: 'site' });
    expect(b.steps.find((s) => s.uses === 'actions/checkout@v7')?.with).toEqual({ 'persist-credentials': false });
  });

  it('GTFS gardés entre les nuits : restauration avant la préparation, sauvegarde après, même en cas d’échec d’un réseau', () => {
    const steps = wf.jobs.build.steps;
    const i = (pred: (s: Step) => boolean) => steps.findIndex(pred);
    const restore = steps[i((s) => s.uses === 'actions/cache/restore@v6')];
    const save = steps[i((s) => s.uses === 'actions/cache/save@v6')];
    const data = i((s) => !!s.run?.startsWith('npm run build-data'));
    expect(i((s) => s.uses === 'actions/cache/restore@v6')).toBeLessThan(data);
    expect(i((s) => s.uses === 'actions/cache/save@v6')).toBeGreaterThan(data);
    expect(steps[data].id).toBe('data');
    // clé unique par exécution, restauration du plus récent par préfixe ; même dossier que --cache-dir
    expect(restore.with).toEqual({ path: 'gtfs-cache', key: 'gtfs-${{ github.run_id }}-${{ github.run_attempt }}', 'restore-keys': 'gtfs-\n' });
    expect(save.with).toEqual({ path: 'gtfs-cache', key: 'gtfs-${{ github.run_id }}-${{ github.run_attempt }}' });
    expect(save.if).toBe("${{ !cancelled() && steps.data.outcome != 'skipped' }}");
    // moindre privilège : le cache ne demande aucun droit supplémentaire
    expect(wf.jobs.build.permissions).toEqual({ contents: 'read', pages: 'read' });
  });

  it('republie après un changement de l’appli : push sur main limité à app/, shared/ et ce workflow', () => {
    expect(wf.on.push).toEqual({ branches: ['main'], paths: ['app/**', 'shared/**', '.github/workflows/nightly.yml'] });
  });

  it('Quai Web : construit dans site/app après les données et avant l’envoi, adresses dérivées du dépôt, données publiées quoi qu’il arrive', () => {
    const steps = wf.jobs.build.steps;
    const i = (pred: (s: Step) => boolean) => steps.findIndex(pred);
    const addr = steps[i((s) => s.id === 'web')];
    const build = steps[i((s) => s.id === 'webapp')];
    const wait = steps[i((s) => s.name === "Page d'attente de Quai Web")];
    expect(i((s) => s.id === 'web')).toBeGreaterThan(i((s) => !!s.run?.startsWith('npm run build-data')));
    expect(i((s) => s.id === 'web')).toBeGreaterThan(i((s) => s.uses === 'actions/cache/save@v6'));
    expect(i((s) => s.id === 'webapp')).toBeGreaterThan(i((s) => s.id === 'web'));
    expect(i((s) => s.name === "Page d'attente de Quai Web")).toBeGreaterThan(i((s) => s.id === 'webapp'));
    expect(i((s) => s.uses === 'actions/upload-pages-artifact@v5')).toBeGreaterThan(i((s) => s.name === "Page d'attente de Quai Web"));
    // adresse des données : https://<compte en minuscules>.github.io/<dépôt>/data ; base de la page /<dépôt>/app/
    expect(addr.env).toEqual({ VAR_RELAY_BASE: '${{ vars.QUAI_RELAY_BASE }}' });
    expect(addr.run).toContain("tr '[:upper:]' '[:lower:]'");
    expect(addr.run).toContain('echo "data=https://$owner.github.io${path}data"');
    expect(addr.run).toContain('echo "base=${path}app/"');
    expect(addr.run).toContain('} >> "$GITHUB_OUTPUT"');
    // variable absente : avis en français, pas d'échec
    expect(addr.run).toContain('if [ -z "$VAR_RELAY_BASE" ]');
    expect(addr.run).toContain('::notice title=Quai Web non publié::');
    expect(addr.run).toContain('les données sont publiées quand même');
    expect(addr.run).not.toContain('exit 1');
    expect(addr.run).toContain('build=false');
    expect(build.if).toBe("${{ steps.web.outputs.build == 'true' }}");
    expect(build['continue-on-error']).toBe(true);
    expect(build['working-directory']).toBe('app');
    expect(build.env).toMatchObject({ QUAI_DATA_BASE: '${{ steps.web.outputs.data }}', QUAI_RELAY_BASE: '${{ vars.QUAI_RELAY_BASE }}', QUAI_WEB_BASE: '${{ steps.web.outputs.base }}' });
    expect(build.run).toContain('npm run build:web');
    expect(build.run).toContain('cp -R dist-web ../site/app');
    expect(wait.if).toBe("${{ steps.web.outputs.build != 'true' || steps.webapp.outcome != 'success' }}");
    expect(wait.run).toContain('site/app/index.html');
    // aucune expression ${{ }} dans les scripts (valeurs passées par l'environnement)
    for (const st of [addr, build, wait]) expect(st.run).not.toContain('${{');
    // moindre privilège inchangé
    expect(wf.jobs.build.permissions).toEqual({ contents: 'read', pages: 'read' });
  });

  it('1.2.6 : balayage des lignes après Quai Web, sans bloquer ; essai d’une branche (verification) sans rien publier', () => {
    const steps = wf.jobs.build.steps;
    const i = (pred: (s: Step) => boolean) => steps.findIndex(pred);
    const scan = steps[i((s) => s.name === 'Balayer les lignes de bus, tram et métro')];
    expect(scan).toMatchObject({ if: "${{ steps.webapp.outcome == 'success' }}", 'continue-on-error': true, 'working-directory': 'app', env: { QUAI_SCAN_DATA: '../site/data' }, run: 'npx vitest run test/scan' });
    expect(i((s) => s.name === 'Balayer les lignes de bus, tram et métro')).toBeGreaterThan(i((s) => s.id === 'webapp'));
    expect(i((s) => s.name === 'Balayer les lignes de bus, tram et métro')).toBeLessThan(i((s) => s.uses === 'actions/upload-pages-artifact@v5'));
    const dispatch = (wf.on as { workflow_dispatch?: { inputs?: Record<string, { type?: string; default?: unknown }> } }).workflow_dispatch;
    expect(dispatch?.inputs?.verification).toMatchObject({ type: 'boolean', default: false });
    for (const u of ['actions/configure-pages@v6', 'actions/upload-pages-artifact@v5']) expect(steps[i((s) => s.uses === u)].if).toBe('${{ !inputs.verification }}');
    expect(wf.jobs.deploy.if).toBe('${{ !inputs.verification }}');
  });

  it('job deploy : environnement github-pages, deploy-pages avec délai de 30 min et un nouvel essai', () => {
    const d = wf.jobs.deploy;
    expect(d.needs).toBe('build');
    expect(d.permissions).toEqual({ pages: 'write', 'id-token': 'write' });
    expect(d.environment).toEqual({ name: 'github-pages', url: '${{ steps.deployment.outputs.page_url || steps.retry.outputs.page_url }}' });
    expect(d['timeout-minutes']).toBeGreaterThanOrEqual(65);
    const [first, wait, retry] = d.steps;
    expect(first).toMatchObject({ name: 'Publier', id: 'deployment', uses: 'actions/deploy-pages@v5', 'continue-on-error': true });
    expect(Number(first.with?.timeout)).toBeGreaterThanOrEqual(1_800_000);
    expect(wait.if).toBe("steps.deployment.outcome == 'failure'");
    expect(retry).toMatchObject({ id: 'retry', uses: 'actions/deploy-pages@v5', if: "steps.deployment.outcome == 'failure'" });
    expect(Number(retry.with?.timeout)).toBeGreaterThanOrEqual(1_800_000);
    expect(d.steps).toHaveLength(3);
  });

  it('job keepalive : seul à pouvoir écrire, commit daté après 30 jours d’inactivité, jamais bloquant', () => {
    const k = wf.jobs.keepalive;
    expect(k.permissions).toEqual({ contents: 'write' });
    expect(k.needs).toEqual(['build', 'deploy']);
    expect(k.if).toBe('${{ !cancelled() }}');
    const step = k.steps[1];
    expect(step['continue-on-error']).toBe(true);
    expect(step.run).toContain('git log -1 --format=%ct');
    expect(step.run).toContain('-lt 30');
    expect(step.run).toContain('.github/keepalive.txt');
    expect(step.run).toContain('git config user.name "github-actions[bot]"');
    expect(step.run).toContain('41898282+github-actions[bot]@users.noreply.github.com');
    expect(step.run).toMatch(/git push [^\n]*\|\| warn/);
    expect(step.run).toContain('::warning');
    expect(text).not.toMatch(/keepalive-workflow/);
    for (const [name, job] of Object.entries(wf.jobs)) {
      if (name !== 'keepalive') expect(JSON.stringify(job.permissions ?? {})).not.toContain('"contents":"write"');
    }
  });

  it('aucun secret en clair, actions officielles uniquement', () => {
    expect(text).not.toMatch(/Ocp-Apim|bmc-partner-key/i);
    const all = Object.keys(wf.jobs).flatMap(uses) as string[];
    for (const u of all) expect(u).toMatch(/^actions\/[a-z-]+(\/[a-z-]+)?@v\d+$/);
  });
});

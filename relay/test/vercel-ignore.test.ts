/**
 * scripts/vercel-ignore.sh (vercel.json > ignoreCommand) : 0 = Vercel ignore le commit, 1 = Vercel déploie.
 * Dépôts git temporaires : premier commit, commit hors relay/, commit dans relay/, poussée de plusieurs commits.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../scripts/vercel-ignore.sh', import.meta.url));
const dirs: string[] = [];
const ENV = { PATH: process.env.PATH ?? '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', LANG: 'C' };

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'quai-ignore-'));
  dirs.push(dir);
  const git = (...args: string[]) => {
    const r = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, env: { ...ENV, HOME: dir }, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} : ${r.stderr}`);
    return r.stdout.trim();
  };
  git('init', '-q', '-b', 'main');
  mkdirSync(join(dir, 'relay'));
  mkdirSync(join(dir, '.github'));
  const commit = (file: string, content: string, message = `maj ${file}`) => {
    writeFileSync(join(dir, file), content);
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  /** Lance le script depuis relay/ (Root Directory), comme Vercel. */
  const ignore = (env: Record<string, string> = {}) => {
    const r = spawnSync('sh', [SCRIPT], { cwd: join(dir, 'relay'), env: { ...ENV, HOME: dir, ...env }, encoding: 'utf8' });
    return r.status;
  };
  return { dir, commit, ignore };
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('ignoreCommand Vercel (scripts/vercel-ignore.sh)', () => {
  it('premier commit (pas de HEAD^) : déploie', () => {
    const r = repo();
    r.commit('relay/a.txt', '1');
    expect(r.ignore()).toBe(1);
    expect(r.ignore({ VERCEL: '1' })).toBe(1);
  });

  it('commit automatique hors relay/ (keepalive .github/) : ignoré', () => {
    const r = repo();
    const c1 = r.commit('relay/a.txt', '1');
    r.commit('.github/keepalive.txt', 'x');
    expect(r.ignore()).toBe(0);
    expect(r.ignore({ VERCEL: '1', VERCEL_GIT_PREVIOUS_SHA: c1 })).toBe(0);
  });

  it('changement dans relay/ : déploie', () => {
    const r = repo();
    r.commit('relay/a.txt', '1');
    const c2 = r.commit('.github/keepalive.txt', 'x');
    r.commit('relay/a.txt', '2');
    expect(r.ignore()).toBe(1);
    expect(r.ignore({ VERCEL: '1', VERCEL_GIT_PREVIOUS_SHA: c2 })).toBe(1);
  });

  it('poussée de plusieurs commits : comparaison avec le dernier déploiement, pas seulement HEAD^', () => {
    const r = repo();
    const c1 = r.commit('relay/a.txt', '1');
    r.commit('relay/a.txt', '2');
    r.commit('.github/keepalive.txt', 'x');
    expect(r.ignore()).toBe(0); // hors Vercel : HEAD^ seulement
    expect(r.ignore({ VERCEL: '1', VERCEL_GIT_PREVIOUS_SHA: c1 })).toBe(1);
  });

  it('sur Vercel sans déploiement précédent connu ou introuvable dans le clone : déploie', () => {
    const r = repo();
    r.commit('relay/a.txt', '1');
    r.commit('.github/keepalive.txt', 'x');
    expect(r.ignore({ VERCEL: '1' })).toBe(1);
    expect(r.ignore({ VERCEL: '1', VERCEL_GIT_PREVIOUS_SHA: 'deadbeef'.repeat(5) })).toBe(1);
  });

  it('message de commit « [deploy relay] » : déploie même sans changement dans relay/', () => {
    const r = repo();
    const c1 = r.commit('relay/a.txt', '1');
    r.commit('.github/keepalive.txt', 'x', 'nouvelle clé BMC [deploy relay]');
    expect(r.ignore()).toBe(1);
    expect(r.ignore({ VERCEL: '1', VERCEL_GIT_PREVIOUS_SHA: c1 })).toBe(1);
    expect(r.ignore({ VERCEL: '1', VERCEL_GIT_PREVIOUS_SHA: c1, VERCEL_GIT_COMMIT_MESSAGE: 'autre message' })).toBe(0);
  });

  it('hors dépôt git : déploie', () => {
    const dir = mkdtempSync(join(tmpdir(), 'quai-nogit-'));
    dirs.push(dir);
    const r = spawnSync('sh', [SCRIPT], { cwd: dir, env: { ...ENV, HOME: dir, GIT_CEILING_DIRECTORIES: tmpdir() }, encoding: 'utf8' });
    expect(r.status).toBe(1);
  });
});

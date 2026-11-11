/** Rapport de taille des fichiers produits. */
import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

export interface SizeReport {
  files: number;
  bytes: number;
  biggest: { path: string; bytes: number }[];
  /** Par dossier de premier niveau (areas/{op} et lines/{op} détaillés). */
  groups: { name: string; files: number; bytes: number }[];
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

export async function sizeReport(dir: string, top = 10): Promise<SizeReport> {
  const all: { path: string; bytes: number }[] = [];
  const groups = new Map<string, { files: number; bytes: number }>();
  for await (const p of walk(dir)) {
    const rel = relative(dir, p).split(sep).join('/');
    const bytes = (await stat(p)).size;
    all.push({ path: rel, bytes });
    const parts = rel.split('/');
    const g = parts.length === 1 ? '(racine)' : (parts[0] === 'areas' || parts[0] === 'lines') && parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0];
    const cur = groups.get(g) ?? { files: 0, bytes: 0 };
    cur.files++;
    cur.bytes += bytes;
    groups.set(g, cur);
  }
  all.sort((a, b) => b.bytes - a.bytes || (a.path < b.path ? -1 : 1));
  return {
    files: all.length,
    bytes: all.reduce((s, f) => s + f.bytes, 0),
    biggest: all.slice(0, top),
    groups: [...groups.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => (a.name < b.name ? -1 : 1)),
  };
}

export function mb(bytes: number): string {
  return (bytes / 1048576).toFixed(bytes < 1048576 ? 3 : 1).replace('.', ',') + ' Mo';
}

export function formatReport(r: SizeReport): string[] {
  const lines = [`Taille : ${r.files} fichiers, ${mb(r.bytes)} au total`];
  for (const g of r.groups) lines.push(`  ${g.name.padEnd(14)} ${String(g.files).padStart(7)} fichiers  ${mb(g.bytes)}`);
  lines.push('Plus gros fichiers :');
  for (const f of r.biggest) lines.push(`  ${mb(f.bytes).padStart(11)}  ${f.path}`);
  return lines;
}

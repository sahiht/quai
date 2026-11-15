/**
 * 1.2.10 (PRD-1.2.10 § 3.9) : images du guidage rendues en 16 niveaux de vert (glasses/images.ts) : tailles, valeurs,
 * déterminisme, miroir gauche-droite, chiffres et lettres distincts, rien hors du cadre, flèches pleines et épaisses.
 */
import { describe, expect, it } from 'vitest';
import type { TurnKind } from '../../src/core/guide-types';
import { describeImage, flipH, IMAGE_LEVEL, imageKey, normDeg, renderImage, SIGN, sinCosDeg } from '../../src/glasses/images';
import type { ImageKind, ImageSpec } from '../../src/glasses/types';

const spec = (image: ImageKind, w = 144, h = 144): ImageSpec => ({ id: 20, name: 'img', x: 28, y: 33, w, h, image });
const px = (image: ImageKind, w = 144, h = 144) => renderImage(spec(image, w, h));
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const lit = (p: Uint8Array) => p.reduce((n, v) => n + (v > 0 ? 1 : 0), 0);
const TURNS: TurnKind[] = ['left', 'right', 'slightLeft', 'slightRight', 'sharpLeft', 'sharpRight', 'uturn', 'straight'];

describe('trigonométrie reproductible', () => {
  it('valeurs exactes aux angles droits, précises ailleurs, angle ramené au degré', () => {
    expect(sinCosDeg(0)).toEqual([0, 1]);
    expect(sinCosDeg(90)[0]).toBe(1);
    expect(Math.abs(sinCosDeg(90)[1])).toBe(0);
    expect(sinCosDeg(180)[1]).toBe(-1);
    expect(sinCosDeg(270)[0]).toBe(-1);
    expect(sinCosDeg(360)).toEqual(sinCosDeg(0));
    for (let d = -720; d <= 720; d += 7) {
      const [s, c] = sinCosDeg(d);
      expect(Math.abs(s - Math.sin((d * Math.PI) / 180))).toBeLessThan(1e-12);
      expect(Math.abs(c - Math.cos((d * Math.PI) / 180))).toBeLessThan(1e-12);
    }
    expect(sinCosDeg(29.6)).toEqual(sinCosDeg(30));
    expect(sinCosDeg(Number.NaN)).toEqual([0, 1]);
    expect(normDeg(-90)).toBe(270);
    expect(normDeg(725.4)).toBe(5);
    expect(normDeg(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('tailles et valeurs', () => {
  const kinds: ImageKind[] = [
    ...TURNS.map((turn): ImageKind => ({ kind: 'turn', turn })),
    { kind: 'sign', label: 'bus', value: '6' },
    { kind: 'sign', label: 'à pied', value: '12', foot: 'min' },
    { kind: 'bearing', deg: 37 },
  ];

  it('w × h octets, de 0 à 15, pour chaque sorte et plusieurs tailles (20 × 20 à 288 × 144)', () => {
    for (const [w, h] of [
      [144, 144],
      [100, 60],
      [288, 144],
      [20, 20],
      [61, 143],
    ]) {
      for (const k of kinds) {
        const p = px(k, w, h);
        expect(p).toBeInstanceOf(Uint8Array);
        expect(p.length).toBe(w * h);
        expect(Math.max(...p)).toBeLessThanOrEqual(15);
        expect(lit(p)).toBeGreaterThan(0);
      }
    }
  });

  it('contrôle usager du 15/11 : la ponctuation des voies se dessine (« 10-11 » n’est pas « 1011 », « 1/2 », « 2.1 », « 3+ »)', () => {
    const sign = (value: string) => px({ kind: 'sign', label: 'voie', value });
    expect(same(sign('10-11'), sign('1011'))).toBe(false);
    expect(same(sign('1/2'), sign('12'))).toBe(false);
    expect(same(sign('2.1'), sign('21'))).toBe(false);
    expect(same(sign('3+'), sign('3'))).toBe(false);
    expect(lit(sign('-'))).toBeGreaterThan(0);
  });

  it('taille impossible bornée, sorte ou virage inconnus : image vide (rien de trompeur)', () => {
    expect(renderImage(spec({ kind: 'turn', turn: 'left' }, 0, -3)).length).toBe(1);
    expect(renderImage(spec({ kind: 'turn', turn: 'left' }, Number.NaN, 10)).length).toBe(10);
    expect(renderImage(spec({ kind: 'turn', turn: 'left' }, 9999, 9999)).length).toBe(576 * 288);
    expect(lit(px({ kind: 'turn', turn: 'zigzag' as TurnKind }))).toBe(0);
    expect(lit(px({ kind: 'mystère' } as unknown as ImageKind))).toBe(0);
    expect(lit(renderImage({ id: 1, name: 'x', x: 0, y: 0, w: 30, h: 30 } as unknown as ImageSpec))).toBe(0);
  });

  it('déterministe ; chaque appel rend sa propre copie (le cache ne se corrompt pas)', () => {
    const a = px({ kind: 'sign', label: 'voie', value: '3' });
    a.fill(15);
    const b = px({ kind: 'sign', label: 'voie', value: '3' });
    expect(same(a, b)).toBe(false);
    expect(same(b, px({ kind: 'sign', label: 'voie', value: '3' }))).toBe(true);
    expect(imageKey(spec({ kind: 'turn', turn: 'left' }))).toBe(imageKey(spec({ kind: 'turn', turn: 'left' })));
    expect(imageKey(spec({ kind: 'turn', turn: 'left' }))).not.toBe(imageKey(spec({ kind: 'turn', turn: 'right' })));
    expect(imageKey(spec({ kind: 'turn', turn: 'left' }, 144, 144))).not.toBe(imageKey(spec({ kind: 'turn', turn: 'left' }, 100, 100)));
  });

  it('rendu rapide (un panneau 144 × 144 en moins de 150 ms)', () => {
    const t0 = performance.now();
    px({ kind: 'sign', label: 'métro', value: '27', foot: 'min' });
    expect(performance.now() - t0).toBeLessThan(150);
  });
});

describe('flèches des virages', () => {
  it('à droite = miroir exact de à gauche (normal, légèrement, franchement) ; tout droit symétrique', () => {
    for (const [l, r] of [
      ['left', 'right'],
      ['slightLeft', 'slightRight'],
      ['sharpLeft', 'sharpRight'],
    ] as const) {
      for (const [w, h] of [
        [144, 144],
        [101, 77],
      ]) {
        expect(same(px({ kind: 'turn', turn: r }, w, h), flipH(px({ kind: 'turn', turn: l }, w, h), w, h))).toBe(true);
      }
    }
    const s = px({ kind: 'turn', turn: 'straight' });
    expect(same(s, flipH(s, 144, 144))).toBe(true);
  });

  it('huit flèches toutes différentes, chacune pleine et au plus clair', () => {
    const imgs = TURNS.map((turn) => px({ kind: 'turn', turn }));
    for (let i = 0; i < imgs.length; i++) {
      expect(Math.max(...imgs[i])).toBe(IMAGE_LEVEL.strong);
      for (let j = i + 1; j < imgs.length; j++) expect(same(imgs[i], imgs[j]), `${TURNS[i]} ≠ ${TURNS[j]}`).toBe(false);
    }
  });

  it('trait épais d’environ 16 px ; pointe à gauche pour « à gauche », en haut pour « tout droit »', () => {
    const s = px({ kind: 'turn', turn: 'straight' });
    // tige de « tout droit » : une ligne horizontale coupe 16 pixels allumés (± 1 pour l'anticrénelage)
    const row = Array.from({ length: 144 }, (_, x) => s[100 * 144 + x]);
    const on = row.filter((v) => v >= 8).length;
    expect(on).toBeGreaterThanOrEqual(15);
    expect(on).toBeLessThanOrEqual(17);
    expect(row.filter((v) => v === 15).length).toBeGreaterThanOrEqual(14);
    // pleine : le centre de la tête est allumé au plus clair
    expect(s[40 * 144 + 72]).toBe(15);
    const l = px({ kind: 'turn', turn: 'left' });
    const lit0 = (p: Uint8Array, x: number) => Array.from({ length: 144 }, (_, y) => p[y * 144 + x]).some((v) => v > 0);
    // « à gauche » : la pointe touche le quart gauche, rien dans le quart droit extrême
    expect(lit0(l, 14)).toBe(true);
    expect(lit0(l, 130)).toBe(false);
    const r = px({ kind: 'turn', turn: 'right' });
    expect(lit0(r, 129)).toBe(true);
    expect(lit0(r, 13)).toBe(false);
  });

  it('rien sur les deux pixels du bord (la flèche n’est jamais coupée)', () => {
    for (const turn of TURNS) {
      for (const [w, h] of [
        [144, 144],
        [288, 144],
        [80, 120],
      ]) {
        const p = px({ kind: 'turn', turn }, w, h);
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) expect(p[y * w + x], `${turn} ${w}×${h} (${x}, ${y})`).toBe(0);
      }
    }
  });
});

describe('flèche à vol d’oiseau', () => {
  it('miroir : 300° = miroir de 60° ; 0° et 180° symétriques ; 360° = 0° ; rien sur le bord', () => {
    for (const d of [1, 30, 60, 90, 135, 179]) expect(same(px({ kind: 'bearing', deg: 360 - d }), flipH(px({ kind: 'bearing', deg: d }), 144, 144))).toBe(true);
    for (const d of [0, 180]) {
      const p = px({ kind: 'bearing', deg: d });
      expect(same(p, flipH(p, 144, 144))).toBe(true);
    }
    expect(same(px({ kind: 'bearing', deg: 360 }), px({ kind: 'bearing', deg: 0 }))).toBe(true);
    expect(same(px({ kind: 'bearing', deg: -90 }), px({ kind: 'bearing', deg: 270 }))).toBe(true);
    for (let d = 0; d < 360; d += 15) {
      const p = px({ kind: 'bearing', deg: d });
      for (let i = 0; i < 144; i++) {
        expect(p[i]).toBe(0);
        expect(p[143 * 144 + i]).toBe(0);
        expect(p[i * 144]).toBe(0);
        expect(p[i * 144 + 143]).toBe(0);
      }
    }
  });

  it('la pointe va du bon côté : 90° à droite, 270° à gauche, 0° en haut, 180° en bas', () => {
    const half = (p: Uint8Array, f: (x: number, y: number) => boolean) => {
      let n = 0;
      for (let y = 0; y < 144; y++) for (let x = 0; x < 144; x++) if (f(x, y)) n += p[y * 144 + x];
      return n;
    };
    const e = px({ kind: 'bearing', deg: 90 });
    // la tête (triangle large) pèse plus que la queue (trait) du côté où elle pointe
    expect(half(e, (x) => x > 100)).toBeGreaterThan(half(e, (x) => x < 44));
    const w = px({ kind: 'bearing', deg: 270 });
    expect(half(w, (x) => x < 44)).toBeGreaterThan(half(w, (x) => x > 100));
    const n = px({ kind: 'bearing', deg: 0 });
    expect(half(n, (_x, y) => y < 44)).toBeGreaterThan(half(n, (_x, y) => y > 100));
    const s = px({ kind: 'bearing', deg: 180 });
    expect(half(s, (_x, y) => y > 100)).toBeGreaterThan(half(s, (_x, y) => y < 44));
  });
});

describe('panneau : cadre arrondi au plus clair, petits mots pâles, grand chiffre au plus clair', () => {
  const frameOnly = px({ kind: 'sign', label: '', value: '' });

  it('cadre au plus clair, coins arrondis, et rien d’autre sans texte', () => {
    const f = SIGN.frame;
    // milieu de chaque côté : allumé au plus clair
    expect(frameOnly[(f.y + 2) * 144 + 72]).toBe(15);
    expect(frameOnly[72 * 144 + f.x + 2]).toBe(15);
    expect(frameOnly[(f.y + f.h - 3) * 144 + 72]).toBe(15);
    expect(frameOnly[72 * 144 + f.x + f.w - 3]).toBe(15);
    // coin arrondi : l'angle du rectangle reste éteint
    expect(frameOnly[(f.y + 1) * 144 + f.x + 1]).toBe(0);
    // intérieur vide (hors des coins arrondis, qui appartiennent au cadre)
    for (let y = 12; y < 132; y++) for (let x = 24; x < 120; x++) expect(frameOnly[y * 144 + x]).toBe(0);
    for (let y = 24; y < 120; y++) for (let x = 12; x < 132; x++) expect(frameOnly[y * 144 + x]).toBe(0);
  });

  it('petit mot pâle (niveau 10 au plus), grand chiffre au plus clair', () => {
    const p = px({ kind: 'sign', label: 'bus', value: '6' });
    const label = Array.from({ length: 30 }, (_, i) => i + 9).flatMap((y) => Array.from({ length: 100 }, (_, i) => p[y * 144 + 22 + i]));
    expect(Math.max(...label)).toBe(IMAGE_LEVEL.pale);
    const value = Array.from({ length: 50 }, (_, i) => i + 50).flatMap((y) => Array.from({ length: 80 }, (_, i) => p[y * 144 + 32 + i]));
    expect(Math.max(...value)).toBe(IMAGE_LEVEL.strong);
    // « à pied » / 5 / « min » : le mot du bas est pâle aussi
    const q = px({ kind: 'sign', label: 'à pied', value: '5', foot: 'min' });
    const foot = Array.from({ length: 16 }, (_, i) => i + 112).flatMap((y) => Array.from({ length: 100 }, (_, i) => q[y * 144 + 22 + i]));
    expect(Math.max(...foot)).toBe(IMAGE_LEVEL.pale);
  });

  it('chiffres 0 à 9 distincts, à un ou deux chiffres ; lettres A à Z et a à z distinctes ; accents et « ~ » dessinés', () => {
    const digits = '0123456789'.split('').map((d) => px({ kind: 'sign', label: 'voie', value: d }));
    for (let i = 0; i < 10; i++) {
      expect(lit(digits[i]) - lit(px({ kind: 'sign', label: 'voie', value: '' }))).toBeGreaterThan(150);
      for (let j = i + 1; j < 10; j++) expect(same(digits[i], digits[j]), `${i} ≠ ${j}`).toBe(false);
    }
    const pairs = ['10', '11', '17', '71', '12', '21'].map((v) => px({ kind: 'sign', label: 'bus', value: v }));
    for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) expect(same(pairs[i], pairs[j])).toBe(false);
    const letters = (abc: string) => abc.split('').map((c) => px({ kind: 'sign', label: '', value: c }));
    for (const set of [letters('ABCDEFGHIJKLMNOPQRSTUVWXYZ'), letters('abcdefghijklmnopqrstuvwxyz')]) {
      for (let i = 0; i < set.length; i++) {
        expect(lit(set[i])).toBeGreaterThan(lit(frameOnly));
        for (let j = i + 1; j < set.length; j++) expect(same(set[i], set[j])).toBe(false);
      }
    }
    // accents : « à » ≠ « a », « é » ≠ « è » ≠ « ê » ≠ « e », « ô », « û », « ç », « ~ »
    const label = (t: string) => px({ kind: 'sign', label: t, value: '1' });
    const words = ['a', 'à', 'e', 'é', 'è', 'ê', 'o', 'ô', 'u', 'û', 'c', 'ç', '~', 'î', 'ï'];
    const imgs = words.map(label);
    for (let i = 0; i < imgs.length; i++) for (let j = i + 1; j < imgs.length; j++) expect(same(imgs[i], imgs[j]), `${words[i]} ≠ ${words[j]}`).toBe(false);
    // forme composée ou décomposée : même image ; espace insécable = espace
    expect(same(label('à pied'), label('à pied'))).toBe(true);
    expect(same(label('à pied'), label('à pied'))).toBe(true);
  });

  it('rien hors du cadre : textes longs réduits pour tenir, toujours à l’intérieur, jamais sur le cadre', () => {
    const f = SIGN.frame;
    const cases: Extract<ImageKind, { kind: 'sign' }>[] = [
      { kind: 'sign', label: 'bus', value: '6' },
      { kind: 'sign', label: 'à pied', value: '120', foot: 'min' },
      { kind: 'sign', label: 'abcdefghijklmnopqrstuvwxyz', value: 'MMMMMMMMMM', foot: 'WWWWWWWWWWWWWWWW' },
      { kind: 'sign', label: 'train', value: 'ICE' },
      { kind: 'sign', label: 'métro', value: 'jgpqy', foot: 'çÉÀ' },
      { kind: 'sign', label: '', value: '~12' },
    ];
    for (const c of cases) {
      const p = px(c);
      for (let y = 0; y < 144; y++) {
        for (let x = 0; x < 144; x++) {
          const v = p[y * 144 + x];
          // hors du rectangle du cadre : éteint
          if (x < f.x || y < f.y || x >= f.x + f.w || y >= f.y + f.h) expect(v, `${JSON.stringify(c)} (${x}, ${y})`).toBe(0);
          // texte (ce que le cadre seul n'allume pas) : à l'intérieur, à 1 px au moins du bord intérieur du cadre
          if (v !== frameOnly[y * 144 + x]) {
            expect(x, `${JSON.stringify(c)} x`).toBeGreaterThan(SIGN.inner.x0);
            expect(x).toBeLessThan(SIGN.inner.x1 - 1);
            expect(y, `${JSON.stringify(c)} y`).toBeGreaterThan(SIGN.inner.y0);
            expect(y).toBeLessThan(SIGN.inner.y1 - 1);
          }
        }
      }
    }
  });

  it('chiffre réduit pour tenir en largeur : toujours centré en hauteur ; caractères inconnus ignorés sans erreur', () => {
    const rows = (p: Uint8Array) => {
      const ys = [] as number[];
      for (let y = 40; y < 104; y++) if (Array.from({ length: 100 }, (_, i) => p[y * 144 + 22 + i]).some((v) => v === 15)) ys.push(y);
      return (ys[0] + ys[ys.length - 1]) / 2;
    };
    const one = rows(px({ kind: 'sign', label: 'bus', value: '8', foot: 'min' }));
    const four = rows(px({ kind: 'sign', label: 'bus', value: '8888', foot: 'min' }));
    expect(Math.abs(one - four)).toBeLessThanOrEqual(2);
    expect(() => px({ kind: 'sign', label: 'bus 🚌 !?', value: '6€', foot: '«»' })).not.toThrow();
    expect(same(px({ kind: 'sign', label: 'bus 🚌', value: '6' }), px({ kind: 'sign', label: 'bus ', value: '6' }))).toBe(true);
  });
});

describe('description en mots (lecteurs d’écran, journal)', () => {
  it('flèches, panneaux, direction', () => {
    expect(describeImage({ kind: 'turn', turn: 'left' })).toBe('flèche à gauche');
    expect(describeImage({ kind: 'turn', turn: 'sharpRight' })).toBe('flèche franchement à droite');
    expect(describeImage({ kind: 'turn', turn: 'uturn' })).toBe('flèche demi-tour');
    expect(describeImage({ kind: 'sign', label: 'à pied', value: '5', foot: 'min' })).toBe('panneau à pied 5 min');
    expect(describeImage({ kind: 'sign', label: 'bus', value: '6' })).toBe('panneau bus 6');
    expect(describeImage({ kind: 'bearing', deg: 0 })).toBe('flèche droit devant');
    expect(describeImage({ kind: 'bearing', deg: 45 })).toBe('flèche 45° à droite');
    expect(describeImage({ kind: 'bearing', deg: -30 })).toBe('flèche 30° à gauche');
    expect(describeImage({ kind: 'bearing', deg: 180 })).toBe('flèche derrière toi');
    expect(describeImage(undefined)).toBe('image');
    for (const t of TURNS) expect(describeImage({ kind: 'turn', turn: t })).not.toMatch(/[—–]/);
  });
});

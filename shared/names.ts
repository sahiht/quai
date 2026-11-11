/**
 * Quai : mise en forme des noms d'arrêts et recherche.
 * Utilisé par le pipeline (noms statiques), l'appli (destinations STIB en direct, recherche) et les tests.
 * Aucune dépendance. Ne pas modifier sans mettre SPEC.md à jour.
 */

const KEEP_UPPER = /^(?:[ivx]{1,4}|[a-z])$/; // chiffres romains (Léopold II) et lettres isolées ((P), quai A)
const LOWER_WORDS = new Set([
  // français
  'de', 'du', 'des', 'la', 'le', 'les', 'au', 'aux', 'à', 'et', 'en', 'sur', 'sous', 'lez', 'lès',
  // néerlandais
  'het', 'van', 'der', 'den', 'ter', 'te', 'op', 'aan', 'bij', 'in', 'tot', 'voor',
]);

/** Sigles avec voyelle gardés en majuscules (« ULB », « UZ-VUB », « CPAS »), écrits ici en minuscules. */
export const ACRONYMS: ReadonlySet<string> = new Set([
  'ulb', 'vub', 'uz', 'chu', 'chr', 'cpas', 'ocmw', 'vrt', 'rtbf', 'stib', 'mivb', 'sncb', 'nmbs', 'tec', 'otan', 'nato',
]);

/**
 * Vrai pour un sigle à garder en majuscules : liste ACRONYMS, ou mot de 3 lettres ou plus sans voyelle (« WTC »).
 * `abbrev` : le mot est suivi d'un point (« MGR. ») ; c'est une abréviation, pas un sigle.
 */
function isAcronym(p: string, abbrev: boolean): boolean {
  if (ACRONYMS.has(p)) return true;
  if (abbrev || p.length < 3 || !/^[a-z]+$/.test(p)) return false;
  return !/[aeiouy]/.test(p);
}

function capPart(p: string, abbrev = false): string {
  if (!p) return p;
  if (KEEP_UPPER.test(p) || isAcronym(p, abbrev)) return p.toUpperCase();
  return p.charAt(0).toUpperCase() + p.slice(1);
}

function capWord(w: string, first: boolean): string {
  // garde la ponctuation autour : "(p)" -> "(P)"
  const m = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u.exec(w);
  if (!m) return w;
  const [, pre, core, post] = m;
  if (!core) return w;
  if (!first && LOWER_WORDS.has(core)) return pre + core + post;
  // l'esplanade -> L'Esplanade (en tête) ; d'ieteren -> d'Ieteren (ailleurs)
  const apos = /^([ldjmnst])['’](.+)$/u.exec(core);
  if (apos) return pre + (first ? apos[1].toUpperCase() : apos[1]) + '’' + capWord(apos[2], true) + post;
  const parts = core.split('-');
  return pre + parts.map((p, i) => capPart(p, i === parts.length - 1 && post.startsWith('.'))).join('-') + post;
}

/**
 * Remet en casse normale un nom écrit tout en majuscules (STIB : « GARE DU NORD » → « Gare du Nord »).
 * Les sigles restent en majuscules (« WTC », « ULB », « UZ-VUB » ; voir ACRONYMS).
 * Les noms déjà en casse mixte sont seulement nettoyés (espaces).
 */
export function prettyName(s: string): string {
  const t = (s ?? '').trim().replace(/\s+/g, ' ');
  if (!t) return t;
  const letters = t.replace(/[^\p{L}]/gu, '');
  if (!letters || letters !== letters.toUpperCase()) return t;
  return t.toLowerCase().split(' ').map((w, i) => capWord(w, i === 0)).join(' ');
}

/** Communes : nom néerlandais → nom français usuel (exonymes). */
export const MUNI_FR: Record<string, string> = {
  'Brussel': 'Bruxelles', 'Antwerpen': 'Anvers', 'Gent': 'Gand', 'Brugge': 'Bruges', 'Leuven': 'Louvain',
  'Mechelen': 'Malines', 'Kortrijk': 'Courtrai', 'Aalst': 'Alost', 'Ieper': 'Ypres', 'Vilvoorde': 'Vilvorde',
  'Halle': 'Hal', 'Tienen': 'Tirlemont', 'Sint-Niklaas': 'Saint-Nicolas', 'Oudenaarde': 'Audenarde',
  'Ronse': 'Renaix', 'Tongeren': 'Tongres', 'Lier': 'Lierre', 'Dendermonde': 'Termonde', 'Zoutleeuw': 'Léau',
  'Geraardsbergen': 'Grammont', 'Veurne': 'Furnes', 'Diksmuide': 'Dixmude', 'Menen': 'Menin',
  'Roeselare': 'Roulers', 'Oostende': 'Ostende', 'Nieuwpoort': 'Nieuport', 'Torhout': 'Thourout',
  'Sint-Truiden': 'Saint-Trond', 'Geel': 'Gheel', 'Grimbergen': 'Grimberghe', 'Kraainem': 'Crainhem',
  'Sint-Pieters-Leeuw': 'Leeuw-Saint-Pierre', 'Sint-Genesius-Rode': 'Rhode-Saint-Genèse', 'Voeren': 'Fourons',
  'Scherpenheuvel-Zichem': 'Montaigu-Zichem', 'Galmaarden': 'Gammerages', 'Bever': 'Biévène',
  'Zaventem': 'Saventhem', 'Poperinge': 'Poperinghe', 'Blankenberge': 'Blankenberghe', 'Bilzen': 'Bilsen',
  // communes bruxelloises (De Lijn les nomme en néerlandais)
  'Elsene': 'Ixelles', 'Oudergem': 'Auderghem', 'Schaarbeek': 'Schaerbeek', 'Sint-Agatha-Berchem': 'Berchem-Sainte-Agathe',
  'Sint-Gillis': 'Saint-Gilles', 'Sint-Jans-Molenbeek': 'Molenbeek-Saint-Jean', 'Molenbeek': 'Molenbeek',
  'Sint-Joost-ten-Node': 'Saint-Josse-ten-Noode', 'Sint-Lambrechts-Woluwe': 'Woluwe-Saint-Lambert',
  'Sint-Pieters-Woluwe': 'Woluwe-Saint-Pierre', 'Ukkel': 'Uccle', 'Vorst': 'Forest',
  'Watermaal-Bosvoorde': 'Watermael-Boitsfort', 'Laken': 'Laeken',
  // Wallonie (rare dans les données De Lijn, utile pour les destinations)
  'Luik': 'Liège', 'Namen': 'Namur', 'Bergen': 'Mons', 'Doornik': 'Tournai', 'Nijvel': 'Nivelles',
  'Waver': 'Wavre', 'Edingen': 'Enghien', 'Aat': 'Ath', 'Hoei': 'Huy', 'Moeskroen': 'Mouscron', 'Komen': 'Comines',
  // 1.1 : communes wallonnes desservies par De Lijn (« Terhulpen » → « La Hulpe ») et quelques exonymes flamands
  'Terhulpen': 'La Hulpe', 'Eigenbrakel': 'Braine-l’Alleud', 'Kasteelbrakel': 'Braine-le-Château', 'Tubeke': 'Tubize',
  'Itter': 'Ittre', 'Geldenaken': 'Jodoigne', 'Hannuit': 'Hannut', 'Borgworm': 'Waremme', 'Lijsem': 'Lincent',
  'Graven': 'Grez-Doiceau', 'Bevekom': 'Beauvechain', 'Lessen': 'Lessines', 'Zinnik': 'Soignies', 'Opzullik': 'Silly',
  'Genepiën': 'Genappe', 'Aarlen': 'Arlon', 'Bastenaken': 'Bastogne',
  'Leopoldsburg': 'Bourg-Léopold', 'Wervik': 'Wervicq', 'Mesen': 'Messines',
  'Spiere-Helkijn': 'Espierres-Helchin',
};

/** Noms complets bien connus (néerlandais → français), prioritaires sur les règles. Clés comparées sans casse ni accents. */
export const NAME_FR: Record<string, string> = {
  'Brussel Noord': 'Bruxelles-Nord', 'Brussel-Noord': 'Bruxelles-Nord', 'Brussel Noordstation': 'Bruxelles-Nord',
  'Brussel Centraal': 'Bruxelles-Central', 'Brussel-Centraal': 'Bruxelles-Central', 'Brussel Centraal Station': 'Bruxelles-Central',
  'Brussel Zuid': 'Bruxelles-Midi', 'Brussel-Zuid': 'Bruxelles-Midi', 'Brussel Zuidstation': 'Bruxelles-Midi',
  'Brussel-Luxemburg': 'Bruxelles-Luxembourg', 'Brussel-Schuman': 'Bruxelles-Schuman',
  'Brussel-Kapellekerk': 'Bruxelles-Chapelle', 'Brussel-Congres': 'Bruxelles-Congrès',
  'Brussels Airport': 'Brussels Airport', 'Brussels Airport-Zaventem': 'Brussels Airport',
  'Gent Sint-Pietersstation': 'Gand-Saint-Pierre', 'Gent-Sint-Pieters': 'Gand-Saint-Pierre',
  'Gent Dampoort': 'Gand-Dampoort', 'Gent-Dampoort': 'Gand-Dampoort',
  'Antwerpen Centraal': 'Anvers-Central', 'Antwerpen-Centraal': 'Anvers-Central', 'Antwerpen Centraal Station': 'Anvers-Central',
  'Antwerpen-Berchem': 'Anvers-Berchem', 'Leuven Station': 'Louvain', 'Mechelen Station': 'Malines',
};

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const NAME_FR_FOLDED = new Map(Object.entries(NAME_FR).map(([k, v]) => [fold(k), v]));
const MUNI_KEYS = Object.keys(MUNI_FR).sort((a, b) => b.length - a.length); // plus long d'abord

const VOWEL = /^[aeiouyhàâéèêëîïôöûü]/i;
const gareDe = (place: string) => (VOWEL.test(place) ? 'Gare d’' : 'Gare de ') + place;

/**
 * Nom français à partir d'un nom néerlandais (De Lijn, destinations), quand aucune traduction officielle n'existe.
 *  1. table NAME_FR (noms complets connus) ;
 *  2. « X Station » → « Gare de X » (X traduit si exonyme) ;
 *  3. nom = commune → exonyme (« Vilvoorde » → « Vilvorde ») ;
 *  4. « Commune Reste » avec exonyme → « Reste, Exonyme » (« Gent Korenmarkt » → « Korenmarkt, Gand ») ;
 *  5. sinon inchangé.
 */
export function frName(nl: string): string {
  const name = (nl ?? '').trim().replace(/\s+/g, ' ');
  if (!name) return name;
  const known = NAME_FR_FOLDED.get(fold(name));
  if (known) return known;
  const st = /^(.+?)\s+station$/i.exec(name);
  if (st) {
    const base = st[1];
    const muni = MUNI_KEYS.find((k) => fold(k) === fold(base));
    return gareDe(muni ? MUNI_FR[muni] : base);
  }
  for (const k of MUNI_KEYS) {
    const fk = fold(k);
    const fn = fold(name);
    if (fn === fk) return MUNI_FR[k];
    if (fn.startsWith(fk + ' ')) {
      const rest = name.slice(k.length).trim();
      if (rest) return `${rest}, ${MUNI_FR[k]}`;
    }
  }
  return name;
}

/** Nom français d'un nom néerlandais complet bien connu (table NAME_FR), sinon undefined. */
export function knownFrName(nl: string): string | undefined {
  return NAME_FR_FOLDED.get(fold(nl ?? ''));
}

/** Nom français d'une commune néerlandophone (exonyme de MUNI_FR), sinon le nom tel quel. */
export function communeFr(nl: string): string {
  const name = (nl ?? '').trim();
  const k = MUNI_KEYS.find((m) => fold(m) === fold(name));
  return k ? MUNI_FR[k] : name;
}

/* ------------------------------ noms TEC (1.1) ------------------------------ */

/** Particules en minuscules à l'intérieur d'un nom composé (« Braine-le-Comte », « Saint-Josse-ten-Noode »). */
const COMPOUND_LOWER = new Set([
  'la', 'le', 'les', 'de', 'du', 'des', 'en', 'sur', 'sous', 'lez', 'lès', 'aux', 'au', 'à', 'a', 'et',
  'ten', 'ter', 'te', 'op', 'den', 'der', 'van', 'het', 'aan', 'bij',
]);

function casePart(p: string, initial: boolean, inner: boolean, abbrev: boolean): string {
  if (!p) return p;
  // élision : « l'alleud » → « l’Alleud » dans un nom composé, « L’Esplanade » en tête
  const el = /^([ldjmnst])['’](.+)$/u.exec(p);
  if (el) return (initial ? el[1].toUpperCase() : el[1]) + '’' + casePart(el[2], true, false, abbrev);
  if (inner && COMPOUND_LOWER.has(p)) return p;
  if (KEEP_UPPER.test(p) || isAcronym(p, abbrev)) return p.toUpperCase();
  return p.charAt(0).toUpperCase() + p.slice(1);
}

/** Un mot écrit en capitales remis en casse, noms composés compris (« BRAINE-L'ALLEUD » → « Braine-l’Alleud »). */
function caseWord(w: string, first: boolean): string {
  const m = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u.exec(w);
  if (!m || !m[2]) return w;
  const [, pre, core, post] = m;
  const lower = core.toLowerCase();
  if (!first && LOWER_WORDS.has(lower)) return pre + lower + post;
  if (lower === 's' && /['’]$/.test(pre)) return pre + lower + post; // article néerlandais : « 's Gravenvoeren »
  const parts = lower.split('-');
  return pre + parts.map((p, i) => casePart(p, first && i === 0, i > 0, i === parts.length - 1 && post.startsWith('.'))).join('-') + post;
}

const isUpperWord = (w: string): boolean => {
  const letters = w.replace(/[^\p{L}]/gu, '');
  return letters.length > 0 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
};

/**
 * Noms TEC (arrêts et destinations) : la commune écrite en capitales en tête est remise en casse
 * (« WATERLOO Eglise » → « Waterloo Eglise », « BRAINE-L'ALLEUD Gare » → « Braine-l’Alleud Gare »), et retirée
 * quand elle est répétée juste après (« LIEGE Liège Expo » → « Liège Expo »). Aucun accent n'est ajouté
 * (« LIEGE Gare » → « Liege Gare »). Les sigles restent en capitales (« LIEGE CHU Sart-Tilman » → « Liege CHU
 * Sart-Tilman »). Un nom tout en capitales est entièrement remis en casse ; les autres noms sont inchangés.
 */
export function tecName(s: string): string {
  const t = (s ?? '').trim().replace(/\s+/g, ' ');
  if (!t) return t;
  const words = t.split(' ');
  let k = 0;
  while (k < words.length && isUpperWord(words[k])) k++;
  if (k === 0) return t;
  if (k === words.length) return words.map((w, i) => caseWord(w, i === 0)).join(' ');
  const rest = words.slice(k);
  if (rest.length >= k && normalizeForSearch(rest.slice(0, k).join(' ')) === normalizeForSearch(words.slice(0, k).join(' '))) {
    return rest.join(' ');
  }
  return [...words.slice(0, k).map((w, i) => caseWord(w, i === 0)), ...rest].join(' ');
}

/**
 * Nom court d'une ligne sans le préfixe de mode déjà écrit dans le GTFS : « T2 » d'un tram devient « 2 »,
 * « M3 » d'un métro devient « 3 » (l'appli ajoute elle-même T et M, sinon « TT2 », « MM3 »).
 * `mode` : 'train', 'metro', 'tram' ou 'bus' ; les autres noms sont seulement nettoyés (espaces).
 */
export function lineName(short: string, mode: string): string {
  const s = (short ?? '').trim().replace(/\s+/g, ' ');
  const prefix = mode === 'tram' ? 't' : mode === 'metro' ? 'm' : '';
  if (!prefix) return s;
  const m = /^([A-Za-z])\s?(\d.*)$/.exec(s);
  return m && m[1].toLowerCase() === prefix ? m[2] : s;
}

/** Forme normalisée pour comparer et chercher : sans accents, minuscules, ponctuation remplacée par des espaces. */
export function normalizeForSearch(s: string): string {
  return (s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const STOP_WORDS = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'het', 'van', 'der', 'den', 'ter', 'te', 'op', 'aux', 'au', 'et', 'en']);

/** Mots indexés pour la recherche (2 caractères ou plus, hors mots vides), sans doublon. */
export function searchWords(...names: string[]): string[] {
  const out = new Set<string>();
  for (const n of names) {
    for (const w of normalizeForSearch(n).split(' ')) {
      if (w.length >= 2 && !STOP_WORDS.has(w)) out.add(w);
    }
  }
  return [...out];
}

/** Clé de fichier de recherche d'un mot : ses deux premiers caractères. */
export function searchKey(word: string): string {
  return normalizeForSearch(word).replace(/ /g, '').slice(0, 2);
}

/** Vrai si chaque mot de la requête est le début d'un mot de l'un des noms. */
export function matchesQuery(query: string, ...names: string[]): boolean {
  const q = normalizeForSearch(query).split(' ').filter(Boolean);
  if (!q.length) return false;
  const words = names.flatMap((n) => normalizeForSearch(n).split(' '));
  return q.every((t) => words.some((w) => w.startsWith(t)));
}

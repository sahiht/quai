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

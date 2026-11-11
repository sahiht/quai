/**
 * Aiguillage des adresses vers une Région (design-routing.md § 6.4 point 2) : code postal, sinon nom de commune
 * reconnu en fin de texte, sinon rien (les trois services en parallèle).
 *
 * Table embarquée nom → Région, volontairement petite (environ 9 Ko) :
 *  - Bruxelles : les 19 communes (noms français et néerlandais officiels), formes courtes usuelles, Laeken, Haren,
 *    Neder-Over-Heembeek ;
 *  - Wallonie : les 261 communes de la liste officielle du service ICAR lui-même
 *    (geoservices.wallonie.be/geocodeWS/geolist?city=*, relevée le 11/11/2026), noms allemands et néerlandais usuels,
 *    quelques sections connues (Louvain-la-Neuve, Jambes, Marcinelle…) ;
 *  - Flandre : les 285 communes de la liste officielle (vlaanderen.be, « Overzicht van Vlaamse steden en gemeenten »,
 *    état après les fusions de 2025), anciens noms des communes fusionnées (toujours des localités postales), noms
 *    français usuels, quelques districts et sections (Berchem, Borgerhout, Ledeberg…).
 * Un nom présent dans deux Régions (Berchem, Saint-Nicolas) mène aux deux.
 */
import { PARTICLES, tokens } from './text.js';
import type { GeoId } from '../config.js';

/** Région, désignée par l'identifiant de son service d'adresses. */
export type Region = GeoId;

const BRU = [
  'Anderlecht|Auderghem|Oudergem|Berchem-Sainte-Agathe|Sint-Agatha-Berchem|Berchem|Bruxelles|Brussel|Brussels|Brüssel',
  'Bruxelles-Ville|Etterbeek|Evere|Forest|Vorst|Ganshoren|Ixelles|Elsene|Jette|Koekelberg|Molenbeek-Saint-Jean',
  'Sint-Jans-Molenbeek|Molenbeek|Saint-Gilles|Sint-Gillis|Saint-Josse-ten-Noode|Sint-Joost-ten-Node|Saint-Josse',
  'Sint-Joost|Schaerbeek|Schaarbeek|Uccle|Ukkel|Watermael-Boitsfort|Watermaal-Bosvoorde|Watermael|Boitsfort',
  'Bosvoorde|Woluwe-Saint-Lambert|Sint-Lambrechts-Woluwe|Woluwe-Saint-Pierre|Sint-Pieters-Woluwe|Woluwe|Laeken',
  'Laken|Neder-Over-Heembeek|Haren',
].join('|');

const WAL = [
  // 261 communes (liste officielle du service ICAR)
  'Aiseau-Presles|Amay|Amel|Andenne|Anderlues|Anhée|Ans|Anthisnes|Antoing|Arlon|Assesse|Ath|Attert|Aubange|Aubel',
  'Awans|Aywaille|Baelen|Bassenge|Bastogne|Beaumont|Beauraing|Beauvechain|Beloeil|Berloz|Bernissart|Bertrix',
  'Beyne-Heusay|Bièvre|Binche|Blegny|Bouillon|Boussu|Braine-l\'Alleud|Braine-le-Château|Braine-le-Comte|Braives',
  'Brugelette|Brunehaut|Büllingen|Burdinne|Burg-Reuland|Bütgenbach|Celles|Cerfontaine|Chapelle-lez-Herlaimont',
  'Charleroi|Chastre|Châtelet|Chaudfontaine|Chaumont-Gistoux|Chièvres|Chimay|Chiny|Ciney|Clavier|Colfontaine',
  'Comblain-au-Pont|Comines-Warneton|Courcelles|Court-Saint-Etienne|Couvin|Crisnée|Dalhem|Daverdisse|Dinant|Dison',
  'Doische|Donceel|Dour|Durbuy|Ecaussinnes|Eghezée|Ellezelles|Enghien|Engis|Erezée|Erquelinnes|Esneux|Estaimpuis',
  'Estinnes|Etalle|Eupen|Faimes|Farciennes|Fauvillers|Fernelmont|Ferrières|Fexhe-le-Haut-Clocher|Flémalle|Fléron',
  'Fleurus|Flobecq|Floreffe|Florennes|Florenville|Fontaine-l\'Evêque|Fosses-la-Ville|Frameries|Frasnes-lez-Anvaing',
  'Froidchapelle|Gedinne|Geer|Gembloux|Genappe|Gerpinnes|Gesves|Gouvy|Grâce-Hollogne|Grez-Doiceau|Habay|Hamoir',
  'Hamois|Ham-sur-Heure-Nalinnes|Hannut|Hastière|Havelange|Hélécine|Hensies|Herbeumont|Héron|Herstal|Herve',
  'Honnelles|Hotton|Houffalize|Houyet|Huy|Incourt|Ittre|Jalhay|Jemeppe-sur-Sambre|Jodoigne|Juprelle|Jurbise|Kelmis',
  'La Bruyère|La Hulpe|La Louvière|La Roche-en-Ardenne|Lasne|Léglise|Lens|Le Roeulx|Les Bons Villers|Lessines',
  'Leuze-en-Hainaut|Libin|Libramont-Chevigny|Liège|Lierneux|Limbourg|Lincent|Lobbes|Lontzen|Malmedy|Manage|Manhay',
  'Marche-en-Famenne|Marchin|Martelange|Meix-devant-Virton|Merbes-le-Château|Messancy|Mettet|Modave|Momignies|Mons',
  'Mont-de-l\'Enclus|Montigny-le-Tilleul|Mont-Saint-Guibert|Morlanwelz|Mouscron|Musson|Namur|Nandrin|Nassogne',
  'Neufchâteau|Neupré|Nivelles|Ohey|Olne|Onhaye|Oreye|Orp-Jauche|Ottignies-Louvain-la-Neuve|Ouffet|Oupeye|Paliseul',
  'Pecq|Pepinster|Péruwelz|Perwez|Philippeville|Plombières|Pont-à-Celles|Profondeville|Quaregnon|Quévy|Quiévrain',
  'Raeren|Ramillies|Rebecq|Remicourt|Rendeux|Rixensart|Rochefort|Rouvroy|Rumes|Sainte-Ode|Saint-Georges-sur-Meuse',
  'Saint-Ghislain|Saint-Hubert|Saint-Léger|Saint-Nicolas|Sambreville|Sankt Vith|Seneffe|Seraing|Silly|Sivry-Rance',
  'Soignies|Sombreffe|Somme-Leuze|Soumagne|Spa|Sprimont|Stavelot|Stoumont|Tellin|Tenneville|Theux|Thimister-Clermont',
  'Thuin|Tinlot|Tintigny|Tournai|Trois-Ponts|Trooz|Tubize|Vaux-sur-Sûre|Verlaine|Verviers|Vielsalm|Villers-la-Ville',
  'Villers-le-Bouillet|Viroinval|Virton|Visé|Vresse-sur-Semois|Waimes|Walcourt|Walhain|Wanze|Waremme|Wasseiges',
  'Waterloo|Wavre|Welkenraedt|Wellin|Yvoir',
  // noms allemands, français et néerlandais usuels
  'Amblève|Bullange|Butgenbach|La Calamine|Saint-Vith|Sankt-Vith|Weismes|Luik|Lüttich|Namen|Bergen|Doornik|Nijvel',
  'Waver|Aat|Hoei|Aarlen|Bastenaken|Borgworm|Geldenaken|Hannuit|Zinnik|Eigenbrakel|Kasteelbrakel|\'s-Gravenbrakel',
  'Terhulpen|Bevekom|Tubeke|Opzullik|Elzele|Vloesberg|Edingen|Moeskroen|Komen-Waasten',
  // sections connues
  'Louvain-la-Neuve|Ottignies|Jambes|Wépion|Marcinelle|Gosselies|Jumet|Gilly|Marchienne-au-Pont|Montignies-sur-Sambre',
  'Couillet|Mont-sur-Marchienne|Angleur|Chênée|Grivegnée|Jupille-sur-Meuse|Bressoux|Ougrée|Jemappes|Cuesmes|Hornu',
  'Limal|Bierges|Mont-Saint-Jean',
].join('|');

const VLA = [
  // 285 communes (liste officielle, 2025)
  'Aartselaar|Antwerpen|Arendonk|Baarle-Hertog|Balen|Beerse|Berlaar|Boechout|Bonheiden|Boom|Bornem|Brasschaat|Brecht',
  'Dessel|Duffel|Edegem|Essen|Geel|Grobbendonk|Heist-op-den-Berg|Hemiksem|Herentals|Herenthout|Herselt|Hoogstraten',
  'Hove|Hulshout|Kalmthout|Kapellen|Kasterlee|Kontich|Laakdal|Lier|Lille|Lint|Malle|Mechelen|Meerhout|Merksplas|Mol',
  'Mortsel|Niel|Nijlen|Olen|Oud-Turnhout|Putte|Puurs-Sint-Amands|Ranst|Ravels|Retie|Rijkevorsel|Rumst|Schelle',
  'Schilde|Schoten|Sint-Katelijne-Waver|Stabroek|Turnhout|Vorselaar|Vosselaar|Westerlo|Wijnegem|Willebroek',
  'Wommelgem|Wuustwezel|Zandhoven|Zoersel',
  'Alken|As|Beringen|Bilzen-Hoeselt|Bocholt|Bree|Diepenbeek|Dilsen-Stokkem|Genk|Gingelom|Halen|Hamont-Achel|Hasselt',
  'Hechtel-Eksel|Heers|Herk-de-Stad|Herstappe|Heusden-Zolder|Houthalen-Helchteren|Kinrooi|Lanaken|Leopoldsburg',
  'Lommel|Lummen|Maaseik|Maasmechelen|Nieuwerkerken|Oudsbergen|Peer|Pelt|Riemst|Sint-Truiden|Tessenderlo-Ham',
  'Tongeren-Borgloon|Voeren|Wellen|Zonhoven|Zutendaal',
  'Aalst|Aalter|Assenede|Berlare|Beveren-Kruibeke-Zwijndrecht|Brakel|Buggenhout|Deinze|Denderleeuw|Dendermonde',
  'Destelbergen|Eeklo|Erpe-Mere|Evergem|Gavere|Gent|Geraardsbergen|Haaltert|Hamme|Herzele|Horebeke|Kaprijke',
  'Kluisbergen|Kruisem|Laarne|Lebbeke|Lede|Lierde|Lievegem|Lochristi|Lokeren|Maarkedal|Maldegem|Merelbeke-Melle',
  'Nazareth-De Pinte|Ninove|Oosterzele|Oudenaarde|Ronse|Sint-Gillis-Waas|Sint-Laureins|Sint-Lievens-Houtem',
  'Sint-Martens-Latem|Sint-Niklaas|Stekene|Temse|Waasmunster|Wetteren|Wichelen|Wortegem-Petegem|Zele|Zelzate',
  'Zottegem|Zulte|Zwalm',
  'Aarschot|Affligem|Asse|Beersel|Begijnendijk|Bekkevoort|Bertem|Bever|Bierbeek|Boortmeerbeek|Boutersem|Diest|Dilbeek',
  'Drogenbos|Geetbets|Glabbeek|Grimbergen|Haacht|Halle|Herent|Hoegaarden|Hoeilaart|Holsbeek|Huldenberg|Kampenhout',
  'Kapelle-op-den-Bos|Keerbergen|Kortenaken|Kortenberg|Kraainem|Landen|Lennik|Leuven|Liedekerke|Linkebeek|Linter',
  'Londerzeel|Lubbeek|Machelen|Meise|Merchtem|Opwijk|Oud-Heverlee|Overijse|Pajottegem|Pepingen|Roosdaal|Rotselaar',
  'Scherpenheuvel-Zichem|Sint-Genesius-Rode|Sint-Pieters-Leeuw|Steenokkerzeel|Ternat|Tervuren|Tielt-Winge|Tienen',
  'Tremelo|Vilvoorde|Wemmel|Wezembeek-Oppem|Zaventem|Zemst|Zoutleeuw',
  'Alveringem|Anzegem|Ardooie|Avelgem|Beernem|Blankenberge|Bredene|Brugge|Damme|De Haan|De Panne|Deerlijk|Dentergem',
  'Diksmuide|Gistel|Harelbeke|Heuvelland|Hooglede|Houthulst|Ichtegem|Ieper|Ingelmunster|Izegem|Jabbeke|Knokke-Heist',
  'Koekelare|Koksijde|Kortemark|Kortrijk|Kuurne|Langemark-Poelkapelle|Ledegem|Lendelede|Lichtervelde|Lo-Reninge',
  'Menen|Mesen|Middelkerke|Moorslede|Nieuwpoort|Oostende|Oostkamp|Oostrozebeke|Oudenburg|Pittem|Poperinge|Roeselare',
  'Spiere-Helkijn|Staden|Tielt|Torhout|Veurne|Vleteren|Waregem|Wervik|Wevelgem|Wielsbeke|Wingene|Zedelgem|Zonnebeke',
  'Zuienkerke|Zwevegem',
  // anciennes communes fusionnées (localités postales)
  'Beveren|Kruibeke|Zwijndrecht|Bilzen|Hoeselt|Tongeren|Borgloon|Ham|Tessenderlo|Kortessem|Merelbeke|Melle|Nazareth',
  'De Pinte|Galmaarden|Gooik|Herne|Moerbeke|Wachtebeke|Ruiselede|Meulebeke|Lovendegem|Zomergem|Waarschoot|Nevele',
  'Knesselare|Kruishoutem|Zingem|Puurs|Sint-Amands|Meeuwen-Gruitrode|Opglabbeek|Overpelt|Neerpelt|Knokke|Heist',
  // noms français, anglais et allemands usuels
  'Anvers|Antwerp|Gand|Ghent|Bruges|Brügge|Louvain|Löwen|Malines|Courtrai|Ostende|Alost|Termonde|Saint-Nicolas|Hal',
  'Vilvorde|Tirlemont|Ypres|Audenarde|Renaix|Grammont|Furnes|Dixmude|Menin|Tongres|Saint-Trond|Lierre|Roulers',
  'Nieuport|La Panne|Coxyde|Wervicq|Messines|Rhode-Saint-Genèse|Leeuw-Saint-Pierre|Crainhem|Fourons',
  'Saint-Gilles-Waes|Tamise|Léau|Biévène|Espierres-Helchin',
  // districts et sections connus
  'Berchem|Borgerhout|Deurne|Merksem|Hoboken|Wilrijk|Ekeren|Berendrecht|Zandvliet|Ledeberg|Gentbrugge',
  'Sint-Amandsberg|Mariakerke|Drongen|Wondelgem|Oostakker|Zwijnaarde|Sint-Denijs-Westrem|Sint-Andries',
  'Sint-Michiels|Assebroek|Sint-Kruis|Zeebrugge|Heverlee|Kessel-Lo|Wilsele',
].join('|');

const LISTS: Readonly<Record<Region, string>> = { bru: BRU, vla: VLA, wal: WAL };

let index: Map<string, Region[]> | null = null;
let maxWords = 1;

const keyOf = (name: string) => tokens(name).join(' ');

function table(): Map<string, Region[]> {
  if (index) return index;
  const m = new Map<string, Region[]>();
  for (const region of ['bru', 'vla', 'wal'] as const) {
    for (const name of LISTS[region].split('|')) {
      const k = keyOf(name);
      if (!k) continue;
      const list = m.get(k) ?? [];
      if (!list.includes(region)) list.push(region);
      m.set(k, list);
      maxWords = Math.max(maxWords, k.split(' ').length);
    }
  }
  index = m;
  return m;
}

/** Nombre de noms de la table (contrôle des tests). */
export function communeCount(region: Region): number {
  return LISTS[region].split('|').length;
}

/** Régions d'un nom de commune connu (null sinon). */
export function regionsOfName(name: string): Region[] | null {
  return table().get(keyOf(name)) ?? null;
}

/**
 * Commune nommée à la fin du texte (plus long nom connu qui finit au dernier jeton), sauf si elle suit un petit
 * mot (« chaussée de Bruxelles », « steenweg op Brussel » : un nom de rue, pas la commune).
 */
export function communeAtEnd(toks: readonly string[]): Region[] | null {
  const t = table();
  for (let n = Math.min(maxWords, toks.length); n >= 1; n--) {
    const start = toks.length - n;
    const regions = t.get(toks.slice(start).join(' '));
    if (!regions) continue;
    const before = toks[start - 1];
    return before !== undefined && PARTICLES.has(before) ? null : regions;
  }
  return null;
}

/**
 * Sépare un nom « rue + commune » sans code postal (« Rue Yolande de Namur Namur ») : plus long suffixe (en mots)
 * qui soit une commune connue, en laissant au moins un mot à la rue.
 */
export function splitMunicipalitySuffix(name: string): { street: string; municipality: string } | null {
  const words = name.trim().split(/\s+/);
  const t = table();
  for (let n = Math.min(words.length - 1, maxWords); n >= 1; n--) {
    const suffix = words.slice(words.length - n).join(' ');
    if (t.has(keyOf(suffix))) return { street: words.slice(0, words.length - n).join(' '), municipality: suffix };
  }
  return null;
}

/** Région d'un code postal belge (1000 à 1299 Bruxelles ; 1300 à 1499 et 4000 à 7999 Wallonie ; le reste Flandre). */
export function regionOfPostcode(cp: string | number | undefined): Region | null {
  const n = typeof cp === 'number' ? cp : /^\d{4}$/.test(String(cp ?? '').trim()) ? Number(String(cp).trim()) : NaN;
  if (!Number.isInteger(n) || n < 1000 || n > 9999) return null;
  if (n <= 1299) return 'bru';
  if (n <= 1499 || (n >= 4000 && n <= 7999)) return 'wal';
  return 'vla';
}

export interface Routing {
  /** Régions à interroger ; null : aucune indication, les trois services. */
  regions: Region[] | null;
  /** Code postal reconnu dans le texte. */
  postcode?: string;
  /** Pour le journal : ce qui a décidé. */
  by: 'code postal' | 'commune' | 'code postal et commune' | 'aucun';
}

/**
 * Aiguillage d'un texte déjà découpé en jetons. Un code postal est un nombre de 4 chiffres suivi d'un mot
 * (« 5000 Namur ») : un numéro de maison à 4 chiffres en fin de texte n'est pas pris pour un code postal.
 * Code postal et commune de Régions différentes : les deux Régions.
 */
export function routeQuery(toks: readonly string[]): Routing {
  let postcode: string | undefined;
  for (let i = 0; i < toks.length - 1; i++) {
    if (/^\d{4}$/.test(toks[i]) && regionOfPostcode(toks[i]) && /[a-z]/.test(toks[i + 1])) postcode = toks[i];
  }
  const fromCp = postcode ? regionOfPostcode(postcode) : null;
  const fromName = communeAtEnd(toks);
  if (fromCp && fromName) {
    const regions = fromName.includes(fromCp) ? [fromCp] : [fromCp, ...fromName.filter((r) => r !== fromCp)];
    return { regions, postcode, by: 'code postal et commune' };
  }
  if (fromCp) return { regions: [fromCp], postcode, by: 'code postal' };
  if (fromName) return { regions: fromName, by: 'commune' };
  return { regions: null, by: 'aucun' };
}

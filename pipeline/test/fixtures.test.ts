/** Les zips committés correspondent à network.json et contiennent bien les particularités voulues. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildFeeds, feedZip, FIXTURE_OPS, loadNetwork } from '../../fixtures/pipeline/make-gtfs.ts';
import { openGtfsZip } from '../src/zip.ts';
import { FIXTURE_ZIPS } from './helpers.ts';

const feeds = buildFeeds(loadNetwork());

async function unzipText(op: string, file: string): Promise<string> {
  const zip = await openGtfsZip(join(FIXTURE_ZIPS, `${op}.zip`));
  try {
    const chunks: Buffer[] = [];
    for await (const c of await zip.open(file)) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    zip.close();
  }
}

describe('zips de test', () => {
  it('sont à jour : regénérés depuis network.json, octet pour octet (npm run make-fixtures)', () => {
    for (const op of FIXTURE_OPS) {
      const committed = readFileSync(join(FIXTURE_ZIPS, `${op}.zip`));
      expect(feedZip(feeds[op]).equals(committed), `${op}.zip périmé : lancer npm run make-fixtures`).toBe(true);
    }
  });

  it('se lisent avec le lecteur du pipeline (yauzl)', async () => {
    for (const op of FIXTURE_OPS) {
      const zip = await openGtfsZip(join(FIXTURE_ZIPS, `${op}.zip`));
      expect(zip.files).toEqual(expect.arrayContaining(['agency.txt', 'stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt', 'calendar.txt', 'calendar_dates.txt', 'feed_info.txt']));
      zip.close();
    }
  });

  it('SNCB : parents S<uic>, arrêt gare, quais avec platform_code, translations field_value fr/nl/de/en, route_type 109, 24:01', async () => {
    const stops = await unzipText('sncb', 'stops.txt');
    expect(stops).toContain('"S8812005","","Brussel-Noord/Bruxelles-Nord","","50.860500","4.361200","","","1","",""');
    expect(stops).toContain('"8812005","","Brussel-Noord/Bruxelles-Nord","","50.860500","4.361200","","","0","S8812005",""');
    expect(stops).toMatch(/"8812005_9",.*"0","S8812005","9"/);
    const tr = await unzipText('sncb', 'translations.txt');
    expect(tr.split('\n')[0]).toBe('"table_name","field_name","language","translation","record_id","record_sub_id","field_value"');
    for (const lang of ['fr', 'nl', 'de', 'en']) expect(tr).toContain(`"stops","stop_name","${lang}",`);
    expect(tr).toContain('"trips","trip_headsign","fr","Bruxelles-Midi","","","Brussel-Zuid/Bruxelles-Midi"');
    expect(await unzipText('sncb', 'routes.txt')).toContain('"S1","NMBS/SNCB","S1","S1 Anvers - Nivelles","109"');
    expect(await unzipText('sncb', 'stop_times.txt')).toContain('"24:01:00"');
  });

  it('STIB : CRLF partout, noms en majuscules, translations record_id (arrêts) et field_value (destinations)', async () => {
    for (const f of Object.keys(feeds.stib)) {
      const text = feeds.stib[f];
      expect(text.split('\n').length - 1, f).toBe(text.split('\r\n').length - 1);
    }
    expect(await unzipText('stib', 'stops.txt')).toContain('6357F,,GARE DU NORD,');
    const tr = await unzipText('stib', 'translations.txt');
    expect(tr).toContain('stops,stop_name,nl,NOORDSTATION,6357F,,\r\n');
    expect(tr).toContain('trips,trip_headsign,nl,ZUIDSTATION,,,GARE DU MIDI\r\n');
  });

  it('De Lijn : « perron N », colonnes de stop_times dans un ordre non standard, colonne en trop, route_type 700', async () => {
    expect(await unzipText('delijn', 'stops.txt')).toContain('308611,08611,Brussel Noordstation perron 4,');
    expect((await unzipText('delijn', 'stop_times.txt')).split('\n')[0]).toBe('stop_sequence,stop_id,trip_id,departure_time,arrival_time,pickup_type,drop_off_type,timepoint,shape_dist_traveled');
    expect((await unzipText('delijn', 'trips.txt')).split('\n')[0]).toContain(',exceptional');
    expect(await unzipText('delijn', 'routes.txt')).toContain('270,DL,270,Brussel - Kortenberg,700,');
  });

  it('TEC : BOM, champ entre guillemets avec virgule et guillemets doublés, « quai X », heures sans zéro, 24:10', async () => {
    const raw = feeds.tec['stops.txt'];
    expect(raw.charCodeAt(0)).toBe(0xfeff);
    expect(raw).toContain('N508aga,N508AGA,"Namur, gare des bus",Namur Gare quai A,');
    expect(raw).toContain('"Quai ""B"", côté gare"');
    const st = await unzipText('tec', 'stop_times.txt');
    expect(st).toContain('N4-0600,6:00:00,6:00:00,N508aga,1');
    expect(st).toContain('N4-2410,24:10:00,24:10:00,N508aga,1');
  });

  it('tous : calendrier WEEK retiré et HOLI ajouté le 2026-11-11, feed_info avec feed_version', async () => {
    for (const op of FIXTURE_OPS) {
      const cd = (await unzipText(op, 'calendar_dates.txt')).replace(/"/g, '');
      expect(cd).toMatch(/WEEK,20261111,2/);
      expect(cd).toMatch(/HOLI,20261111,1/);
      expect((await unzipText(op, 'feed_info.txt')).replace(/"/g, '').split(/\r?\n/)[0]).toContain('feed_version');
    }
  });
});

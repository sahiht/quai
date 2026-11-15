/**
 * Quai 1.3.0, contrôle technique indépendant (PRD-1.3.0 § 6.3, § 6.4) : ce que le guidage écrit dans le journal de trajet
 * pendant une vérification qui dure (position perdue une heure, batterie qui baisse). Logique pure de
 * glasses/reminder.ts (GuideTrail), journal en mémoire. Lieux publics seulement.
 */
import { describe, expect, it } from 'vitest';
import type { CheckIssue, GuideMemory, GuideState } from '../../src/core/guide-types';
import type { JournalEvent, TripJournal } from '../../src/core/journal-types';
import { GuideTrail } from '../../src/glasses/reminder';
import { NOW, door } from './controller-guide-kit';
import { MIN, nb } from './helpers';

function memoryJournal() {
  const events: JournalEvent[] = [];
  const journal: TripJournal = {
    begin: () => 't1',
    add: (_id, e) => void events.push(structuredClone(e)),
    end: () => undefined,
    list: () => [],
    text: () => '',
    clear: () => undefined,
  };
  return { journal, events };
}

const j = door('j-qa', NOW + 4 * MIN, NOW + 70 * MIN);
const mem: GuideMemory = { shown: {}, dismissed: [] } as unknown as GuideMemory;
const state = (issues: CheckIssue[]): GuideState =>
  ({ kind: 'trip', journeyId: j.id, phase: { kind: 'ride', leg: 1 }, moment: null, where: {}, location: 'medium', wakeAt: NOW + MIN, ended: false, ...(issues.length ? { issues } : {}) }) as unknown as GuideState;

describe('journal : une vérification qui dure n’écrit pas une ligne par minute', () => {
  it('position perdue pendant une heure, batterie qui baisse : une ligne quand les problèmes changent, pas à chaque minute ni à chaque pour cent', () => {
    let t = NOW;
    const { journal, events } = memoryJournal();
    const trail = new GuideTrail(journal, 't1', () => t);
    // position perdue depuis 3 min, puis 4, 5… 62 min (un pas du moteur par minute)
    for (let m = 3; m <= 62; m++) {
      t += MIN;
      trail.step(state([{ kind: 'positionLost', minutes: m }]), mem, mem, j, 'fr');
    }
    // la batterie passe sous 20 % : un problème de plus, puis elle baisse d'un pour cent à la fois
    for (let level = 19; level >= 12; level--) {
      t += MIN;
      trail.step(state([{ kind: 'battery', level }, { kind: 'positionLost', minutes: 62 + (20 - level) }]), mem, mem, j, 'fr');
    }
    // la position revient : il ne reste que la batterie
    t += MIN;
    trail.step(state([{ kind: 'battery', level: 12 }]), mem, mem, j, 'fr');
    const checks = events.filter((e) => e.k === 'check').map((e) => nb(String(e.d?.issues)));
    expect(checks).toEqual(['Position perdue depuis 3 min', 'Lunettes : 19 % de batterie ; Position perdue depuis 63 min', 'Lunettes : 12 % de batterie']);
  });
});

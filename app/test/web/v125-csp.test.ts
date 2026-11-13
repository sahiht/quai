/**
 * Quai 1.2.5 (docs/v1.2.5/PRD-1.2.5.md § 9) : Quai Web publiée avec une politique de sécurité du contenu (ses propres
 * fichiers, et seulement les adresses des données et du relais) et sans référent.
 */
import { describe, expect, it } from 'vitest';
import { webSecurityMeta } from '../../vite.web.config';

const csp = (m: string): Record<string, string> =>
  Object.fromEntries(
    m
      .match(/content="([^"]+)"/)![1]
      .split(';')
      .map((x) => x.trim().split(/\s+/))
      .map(([k, ...v]) => [k, v.join(' ')]),
  );

describe('PRD-1.2.5 § 9 : sécurité de Quai Web', () => {
  it('ses fichiers seulement ; le réseau vers les données et le relais ; ni objet, ni formulaire ; aucun référent', () => {
    const m = webSecurityMeta('https://sahiht.github.io/quai/data', 'https://quai-relay.vercel.app/');
    const p = csp(m);
    expect(p['default-src']).toBe("'self'");
    expect(p['script-src']).toBe("'self'");
    expect(p['connect-src']).toBe("'self' https://sahiht.github.io https://quai-relay.vercel.app");
    expect(p['object-src']).toBe("'none'");
    expect(p['form-action']).toBe("'none'");
    expect(p['base-uri']).toBe("'self'");
    expect(m).not.toMatch(/unsafe-eval|\*\.|https?:\/\/\*/);
    expect(m).toContain('<meta name="referrer" content="no-referrer" />');
  });

  it('essais de bout en bout seulement : aussi les serveurs de la machine ; une adresse illisible est ignorée', () => {
    expect(csp(webSecurityMeta('http://127.0.0.1:8787/data', 'http://127.0.0.1:8788', true))['connect-src']).toBe("'self' http://127.0.0.1:8787 http://127.0.0.1:8788 http://127.0.0.1:* http://localhost:*");
    expect(csp(webSecurityMeta('pas une adresse', 'https://quai-relay.vercel.app'))['connect-src']).toBe("'self' https://quai-relay.vercel.app");
  });
});

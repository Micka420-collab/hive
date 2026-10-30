// @vitest-environment happy-dom
//
// La page de la porte, SCRIPT EXÉCUTÉ dans un navigateur de banc.
//
// Elle est produite par `pagePorte` telle que la Reine la sert (les routes
// sont éprouvées dans `porte-routes.test.ts`, sous Node — la Reine ne se charge
// pas sous happy-dom, voir `session-expiree-ecran.test.tsx`). Ce qu'on prouve :
// la page lit le fragment et refuse ce qui n'est pas SON billet, compose la
// commande à l'octet près comme la ruche, pose le lien profond, lit l'état
// avec le secret et jamais sans, attend, puis voit la machine entrer.

import { describe, expect, it, vi } from 'vitest';
import { pagePorte } from '../src/orchestrator/porte-page.js';
import { encoderBillet, tirerSecret, type Billet } from '../src/shared/acces.js';
import { commandeEntree } from '../src/shared/commande-entree.js';

const id = 'bil-0f3c7e2a-9b1d-4c6e-8a5f-1234567890ab';
const billet: Billet = {
  url: 'wss://ruche.exemple.org/ws',
  id,
  secret: tirerSecret(),
  label: 'Ruche de Micka',
};
const billetEncode = encoderBillet(billet);
const HTML = pagePorte({
  id,
  nonce: 'nonce-de-banc',
  systeme: 'windows',
  releases: 'https://github.com/Micka420-collab/hive/releases/latest',
  version: '0.5.0',
});

describe('LA PAGE DE LA PORTE', () => {
  describe('LA PAGE, OUVERTE DANS UN NAVIGATEUR DE BANC', () => {
    /** Monte la page et exécute son script. Rend `fetch` espionné. */
    async function ouvrir(fragment: string, reponsesEtat: object[]) {
      const html = HTML;
      document.documentElement.innerHTML = html
        .replace(/^[\s\S]*?<html[^>]*>/, '')
        .replace(/<\/html>[\s\S]*$/, '');
      location.hash = fragment;
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (X11; Linux x86_64)',
        configurable: true,
      });
      const file = [...reponsesEtat];
      const espion = vi.fn(async () => {
        const corps = file.length > 1 ? file.shift()! : (file[0] ?? {});
        return new Response(JSON.stringify(corps), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });
      vi.stubGlobal('fetch', espion);
      const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html)![1]!;
      new Function(script)();
      // Le premier `lire()` est asynchrone : on laisse les promesses s'écouler.
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      return espion;
    }

    it('lit le fragment, nomme la ruche, pose le lien profond et compose LA commande de la ruche', async () => {
      const espion = await ouvrir(billetEncode, [
        {
          etat: 'vivant',
          label: 'Ruche de Micka',
          expiresAt: Date.now() + 3_600_000,
          usesLeft: 1,
          usesTotal: 1,
          arrivees: [],
        },
      ]);
      expect(document.getElementById('titre')!.textContent).toBe('Rejoindre « Ruche de Micka »');
      expect(document.getElementById('app')!.getAttribute('href')).toBe(
        `hive://rejoindre/${billetEncode}`,
      );
      expect(document.getElementById('os-nom')!.textContent).toBe('Linux');
      // Linux : la commande POSIX, puis Windows au clic — les deux identiques à la ruche.
      expect(document.getElementById('cmd')!.textContent).toBe(
        commandeEntree(billetEncode, 'posix'),
      );
      (document.querySelector('.os button[data-os="windows"]') as HTMLButtonElement).click();
      expect(document.getElementById('cmd')!.textContent).toBe(
        commandeEntree(billetEncode, 'windows'),
      );
      // L'état a été lu AVEC le secret, par POST, vers la route de la ruche.
      expect(espion).toHaveBeenCalledTimes(1);
      const [url, init] = espion.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(`/api/billets/${id}/etat`);
      expect(init.method).toBe('POST');
      expect(JSON.parse(String(init.body))).toEqual({ secret: billet.secret });
      expect(document.getElementById('etat')!.className).toBe('etat vivant');
      expect(document.getElementById('etat-texte')!.textContent).toMatch(
        /valable jusqu’au .* une place/,
      );
    });

    it('un fragment ABSENT ou TRONQUÉ : la page le dit, et ne propose aucun geste', async () => {
      const espion = await ouvrir('hive2_tronque', []);
      expect(document.getElementById('etat-texte')!.textContent).toMatch(/incomplet/);
      expect(document.getElementById('geste')!.classList.contains('cache')).toBe(true);
      expect(espion).not.toHaveBeenCalled();
    });

    it('un fragment d’un AUTRE billet (chemin ≠ fragment) est refusé comme incomplet', async () => {
      const autre = encoderBillet({ ...billet, id: 'bil-autre' });
      const espion = await ouvrir(autre, []);
      expect(document.getElementById('etat-texte')!.textContent).toMatch(/incomplet/);
      expect(espion).not.toHaveBeenCalled();
    });

    it('après le clic, la page ATTEND puis voit la machine entrer — et l’alvéole se remplit', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
      try {
        const vivant = {
          etat: 'vivant',
          label: 'Ruche de Micka',
          expiresAt: Date.now() + 3_600_000,
          usesLeft: 1,
          usesTotal: 1,
          arrivees: [],
        };
        const entree = {
          ...vivant,
          etat: 'epuise',
          usesLeft: 0,
          arrivees: [{ label: 'PC-Léa', quand: Date.now() + 5_000 }],
        };
        const espion = await ouvrir(billetEncode, [vivant, vivant, entree]);
        expect(document.querySelector('.alv.attend')).not.toBeNull();
        const app = document.getElementById('app')!;
        app.addEventListener('click', (e) => e.preventDefault());
        app.click();
        expect(document.getElementById('etat')!.className).toBe('etat attente');
        await vi.advanceTimersByTimeAsync(4_100);
        expect(espion).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(4_100);
        expect(espion).toHaveBeenCalledTimes(3);
        expect(document.getElementById('etat')!.className).toBe('etat entre');
        expect(document.getElementById('etat-texte')!.textContent).toContain(
          '« PC-Léa » est entrée',
        );
        expect(document.querySelector('.alv.pleine')).not.toBeNull();
        expect(document.querySelector('.alv.attend')).toBeNull();
        // Plus aucune relecture : la boucle est arrêtée.
        await vi.advanceTimersByTimeAsync(10_000);
        expect(espion).toHaveBeenCalledTimes(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it('un lien ÉPUISÉ ou EXPIRÉ cache les gestes et dit quoi faire', async () => {
      await ouvrir(billetEncode, [
        {
          etat: 'epuise',
          expiresAt: Date.now() + 1000,
          usesLeft: 0,
          usesTotal: 1,
          arrivees: [{ label: 'Mac', quand: Date.now() - 60_000 }],
        },
      ]);
      expect(document.getElementById('etat-texte')!.textContent).toMatch(/déjà servi.*« Mac »/);
      expect(document.getElementById('geste')!.classList.contains('cache')).toBe(true);
      await ouvrir(billetEncode, [
        { etat: 'expire', expiresAt: Date.now() - 1000, usesLeft: 1, usesTotal: 1, arrivees: [] },
      ]);
      expect(document.getElementById('etat-texte')!.textContent).toMatch(/expiré/);
    });

    it('un téléphone est renvoyé vers un ordinateur', async () => {
      const html = HTML;
      document.documentElement.innerHTML = html
        .replace(/^[\s\S]*?<html[^>]*>/, '')
        .replace(/<\/html>[\s\S]*$/, '');
      location.hash = billetEncode;
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Mobile',
        configurable: true,
      });
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('{}', { status: 200 })),
      );
      new Function(/<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html)![1]!)();
      expect(document.getElementById('note-app')!.textContent).toMatch(/téléphone ou une tablette/);
    });
  });
});

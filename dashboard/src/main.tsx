import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { getPartage, savePartage } from './api';
import './styles.css';

const Partage = lazy(() => import('./views/Partage'));

/**
 * L'aiguillage du porteur de lien — AVANT `App`, et c'est délibéré.
 *
 * ─── POURQUOI PAS UNE BRANCHE DANS `App` ─────────────────────────────────────
 *
 * `App` ouvre le flux WebSocket avec le jeton de RUCHE dès son montage, tient
 * l'instantané de l'essaim, sonde le pouls, hydrate les revues. Un porteur de
 * lien n'a rien de tout ça : sa connexion serait refusée en boucle, et chaque
 * relevé partirait pour recevoir 401. Une branche à l'intérieur ne l'éviterait
 * pas — les hooks se déclenchent avant qu'on ait fini de choisir quoi afficher.
 *
 * Le lien fabriqué par le serveur a cette forme :
 *
 *     https://<tunnel>/#/rayon/<projectId>?partage=hive3_…
 *
 * Le jeton vit APRÈS le `#` : le fragment ne quitte jamais le navigateur, donc
 * il n'apparaît dans aucun journal d'accès de serveur ou de mandataire. On le
 * range, puis on le RETIRE de la barre d'adresse — une capture d'écran de la
 * page ne doit pas suffire à refaire le lien.
 */
function racine(): { partage: true; projectId: string } | { partage: false } {
  const brut = location.hash.replace(/^#\/?/, '');
  const [chemin, requete] = brut.split('?');
  const jeton = new URLSearchParams(requete ?? '').get('partage');
  const parts = (chemin ?? '').split('/');
  const projectId = parts[1] ? decodeURIComponent(parts[1]) : '';

  if (jeton) {
    savePartage(jeton);
    // Le jeton ne reste pas dans la barre d'adresse.
    history.replaceState(null, '', `#/${chemin}`);
  }
  const enMemoire = getPartage();
  // Un jeton sans projet dans l'URL ne mène nulle part : on repart en ruche
  // ordinaire plutôt que d'afficher un écran vide qu'on ne sait pas expliquer.
  if (enMemoire && projectId !== '') return { partage: true, projectId };
  return { partage: false };
}

const r = racine();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    {r.partage ? (
      <Suspense fallback={null}>
        <Partage projectId={r.projectId} />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);

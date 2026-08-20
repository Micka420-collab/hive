// Bureau de recette — allumage depuis la Reine. Un seul bouton, pas un second
// cockpit. L'isolement des tâches n'est pas ici : c'est l'écran où l'agent voit.

import { useEffect, useState } from 'react';
import { arreterAtelier, demarrerAtelier, fetchAtelier } from './api';
import type { EtatAtelier } from './api';
import { useT } from './i18n';

export function AtelierRecette() {
  const t = useT();
  const [etat, setEtat] = useState<EtatAtelier | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const rafraichir = () => {
    void fetchAtelier()
      .then(setEtat)
      .catch(() => setEtat(null));
  };

  useEffect(() => {
    rafraichir();
  }, []);

  const agir = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      rafraichir();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!etat) return null;

  return (
    <section className="card ruche-depart" style={{ margin: '0 0 12px', maxWidth: 'none' }}>
      <span className="marque" aria-hidden="true" />
      <h2>{t('Atelier de recette', 'Acceptance studio')}</h2>
      <p>
        {etat.actif
          ? t(
              'Bureau allumé sur la machine de la ruche. L’agent y voit sa page, clique, lit un PDF — la recette se joue ici, pas sur votre portable.',
              'Desktop running on the hive computer. The agent can see its page, click, read a PDF — acceptance runs here, not on your laptop.',
            )
          : t(
              'Bureau de recette sur l’ordinateur de la ruche : l’agent teste comme un humain. HIVE_ATELIER=auto pour l’allumer.',
              'Acceptance desktop on the hive computer: the agent tests like a human. Set HIVE_ATELIER=auto to start it.',
            )}
      </p>
      {etat.mode !== 'off' && (
        <button
          className="btn primary"
          disabled={busy}
          onClick={() => void agir(etat.actif ? arreterAtelier : demarrerAtelier)}
        >
          {etat.actif ? t('Éteindre', 'Stop') : t('Allumer l’atelier', 'Start the studio')}
        </button>
      )}
      {err && <p className="muted-text">{err}</p>}
    </section>
  );
}

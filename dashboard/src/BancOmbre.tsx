// Le panneau du banc d'ombre — comparer deux modèles sur la même petite tâche.
//
// PARTI PRIS D'INTERFACE, comme le Garde-Fous : ce panneau ne montre pas un
// simple interrupteur. Allumer le banc, c'est faire payer à l'hôte de vrais
// appels de modèle ; le BUDGET est donc sous les yeux au moment du geste
// (exécutions et coût déclaré par 24 h glissantes), avec ce qui a déjà été
// dépensé et, s'il y en a un, ce qui arrête le banc maintenant. Le serveur
// exige ce budget à chaque réglage : l'écran le propose, jamais ne l'invente.
//
// Ce que le banc a MESURÉ ne se lit pas ici mais dans le registre Genome
// (section « Banc d'ombre ») : le projet règle, l'Essaim montre.

import { useCallback, useEffect, useState } from 'react';
import { fetchBancOmbre, reglerBancOmbre } from './api';
import type { EtatBancOmbreUi } from './api';
import { direMotifOmbre } from './banc-ombre-rendu';
import { useLang, useT } from './i18n';
import { direUsd, StatusBadge } from './ui';

/** Le budget bouge à chaque ombre : relu comme le Garde-Fous. */
const PERIODE_MS = 5_000;

/** Ce que les trois champs tiennent, en texte : un champ vidé n'est pas un zéro. */
interface Brouillon {
  pourcent: string;
  executions: string;
  plafond: string;
}

function brouillonDe(etat: EtatBancOmbreUi): Brouillon {
  const r = etat.reglage ?? etat.propose;
  return {
    pourcent: String(r.tauxPourMille / 10),
    executions: String(r.executionsParJour),
    plafond: String(r.plafondCoutUsd),
  };
}

/**
 * Le brouillon, lu et borné comme le serveur le bornera — ou le champ fautif.
 * Refuser ICI, avec le nom du champ, vaut mieux qu'un 400 de schéma que
 * personne ne sait relier à ce qu'il a tapé.
 */
export function lireBrouillon(
  b: Brouillon,
  bornes: EtatBancOmbreUi['bornes'],
):
  | { ok: true; tauxPourMille: number; executionsParJour: number; plafondCoutUsd: number }
  | { ok: false; champ: 'pourcent' | 'executions' | 'plafond' } {
  const tauxPourMille = Math.round(Number(b.pourcent) * 10);
  const executionsParJour = Number(b.executions);
  const plafondCoutUsd = Number(b.plafond);
  if (
    b.pourcent.trim() === '' ||
    !Number.isInteger(tauxPourMille) ||
    tauxPourMille < bornes.tauxPourMille.min ||
    tauxPourMille > bornes.tauxPourMille.max
  ) {
    return { ok: false, champ: 'pourcent' };
  }
  if (
    b.executions.trim() === '' ||
    !Number.isInteger(executionsParJour) ||
    executionsParJour < bornes.executionsParJour.min ||
    executionsParJour > bornes.executionsParJour.max
  ) {
    return { ok: false, champ: 'executions' };
  }
  if (
    b.plafond.trim() === '' ||
    !Number.isFinite(plafondCoutUsd) ||
    plafondCoutUsd <= 0 ||
    plafondCoutUsd > bornes.plafondCoutUsd.max
  ) {
    return { ok: false, champ: 'plafond' };
  }
  return { ok: true, tauxPourMille, executionsParJour, plafondCoutUsd };
}

export function BancOmbre({ projectId }: { projectId: string }) {
  const t = useT();
  const lang = useLang();
  const [etat, setEtat] = useState<EtatBancOmbreUi | null>(null);
  const [brouillon, setBrouillon] = useState<Brouillon | null>(null);
  const [erreur, setErreur] = useState('');
  const [occupe, setOccupe] = useState(false);

  const recharger = useCallback(async () => {
    try {
      const lu = await fetchBancOmbre(projectId);
      setEtat(lu);
      // Le brouillon n'est posé qu'une fois : le relire toutes les 5 s
      // effacerait ce que l'humain est en train de taper.
      setBrouillon((b) => b ?? brouillonDe(lu));
      setErreur('');
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  }, [projectId]);

  useEffect(() => {
    void recharger();
    const id = setInterval(() => void recharger(), PERIODE_MS);
    return () => clearInterval(id);
  }, [recharger]);

  if (!etat || !brouillon) {
    return (
      <section className="essaim-panneau banc-ombre" aria-busy="true">
        <h3>{t('Banc d’ombre', 'Shadow bench')}</h3>
        <p className="essaim-vide">{erreur || t('Chargement…', 'Loading…')}</p>
      </section>
    );
  }

  const appliquer = async (actif: boolean): Promise<void> => {
    const lu = lireBrouillon(brouillon, etat.bornes);
    if (!lu.ok) {
      setErreur(
        lu.champ === 'pourcent'
          ? t(
              `Échantillon : entre ${etat.bornes.tauxPourMille.min / 10} et ${etat.bornes.tauxPourMille.max / 10} %, au dixième près.`,
              `Sample: between ${etat.bornes.tauxPourMille.min / 10} and ${etat.bornes.tauxPourMille.max / 10}%, to the tenth.`,
            )
          : lu.champ === 'executions'
            ? t(
                `Exécutions : un entier entre ${etat.bornes.executionsParJour.min} et ${etat.bornes.executionsParJour.max}.`,
                `Runs: a whole number between ${etat.bornes.executionsParJour.min} and ${etat.bornes.executionsParJour.max}.`,
              )
            : t(
                `Plafond : plus de 0 $ et au plus ${etat.bornes.plafondCoutUsd.max} $.`,
                `Cap: more than $0 and at most $${etat.bornes.plafondCoutUsd.max}.`,
              ),
      );
      return;
    }
    setOccupe(true);
    try {
      setEtat(
        await reglerBancOmbre(projectId, {
          actif,
          tauxPourMille: lu.tauxPourMille,
          executionsParJour: lu.executionsParJour,
          plafondCoutUsd: lu.plafondCoutUsd,
        }),
      );
      setErreur('');
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupe(false);
    }
  };

  const champ = (cle: keyof Brouillon, libelle: string, pas: string) => (
    <label className="banc-ombre-champ">
      <span>{libelle}</span>
      <input
        type="number"
        inputMode="decimal"
        step={pas}
        min="0"
        value={brouillon[cle]}
        disabled={occupe}
        onChange={(e) => setBrouillon({ ...brouillon, [cle]: e.target.value })}
      />
    </label>
  );

  const b = etat.budget;
  const plafond = etat.reglage?.plafondCoutUsd ?? null;
  return (
    <section className="essaim-panneau banc-ombre" data-testid="banc-ombre">
      <h3>
        <span className="marque" aria-hidden="true" /> {t('Banc d’ombre', 'Shadow bench')}
      </h3>
      <p className="essaim-intro">
        {t(
          'La ruche fait refaire une petite tâche testable par un second modèle, dans son propre atelier, et compare les deux sur les tests du projet. L’ombre ne se livre jamais, et ses comparaisons ne changent pas encore le routing : elles se lisent dans le registre Genome.',
          'The hive has a second model redo a small testable task in its own workspace, and compares both on the project’s tests. The shadow is never delivered, and its comparisons do not change routing yet: read them in the Genome register.',
        )}
      </p>

      <label className="garde-fou-optin">
        <input
          type="checkbox"
          checked={etat.actif}
          disabled={occupe}
          onChange={() => void appliquer(!etat.actif)}
        />
        {etat.actif
          ? t(
              'Actif — une part des tâches est rejouée, dans le budget ci-dessous.',
              'Active — a share of tasks is replayed, within the budget below.',
            )
          : t('Éteint — aucune tâche n’est rejouée.', 'Off — no task is replayed.')}
      </label>

      <div className="banc-ombre-reglage">
        {champ('pourcent', t('Échantillon (%)', 'Sample (%)'), '0.1')}
        {champ('executions', t('Ombres / 24 h', 'Shadows / 24 h'), '1')}
        {champ('plafond', t('Coût déclaré max / 24 h ($)', 'Max declared cost / 24 h ($)'), '0.1')}
        <button type="button" disabled={occupe} onClick={() => void appliquer(etat.actif)}>
          {t('Appliquer', 'Apply')}
        </button>
      </div>

      <p className="banc-ombre-budget" data-testid="banc-ombre-budget">
        <span className="essaim-etiquette">{t('Dernières 24 h', 'Last 24 h')}</span>
        {t(
          `${b.executions}${etat.reglage ? `/${etat.reglage.executionsParJour}` : ''} ombre(s) · ${direUsd(b.coutDeclareUsd, lang)}${plafond === null ? '' : ` / ${direUsd(plafond, lang)}`} déclarés · ${b.enVol} en vol`,
          `${b.executions}${etat.reglage ? `/${etat.reglage.executionsParJour}` : ''} shadow(s) · ${direUsd(b.coutDeclareUsd, lang)}${plafond === null ? '' : ` / ${direUsd(plafond, lang)}`} declared · ${b.enVol} in flight`,
        )}
        {b.executionsMuettes > 0 && (
          <span className="banc-ombre-muettes">
            {t(
              ` · ${b.executionsMuettes} exécution(s) sans coût déclaré — le plafond ne les voit pas, le nombre d’ombres les borne`,
              ` · ${b.executionsMuettes} run(s) declared no cost — the cap cannot see them, the shadow count bounds them`,
            )}
          </span>
        )}
      </p>
      {etat.actif && b.arret && (
        <p className="banc-ombre-arret" data-testid="banc-ombre-arret">
          {t('Arrêté : ', 'Stopped: ')}
          {direMotifOmbre(b.arret, t)}
        </p>
      )}

      {etat.ombres.length > 0 && (
        <ul className="banc-ombre-liste" aria-label={t('Dernières ombres', 'Recent shadows')}>
          {etat.ombres.map((o) => (
            <li key={o.tacheOmbre}>
              {o.statut ? <StatusBadge status={o.statut} /> : t('élaguée', 'pruned')}{' '}
              {o.titre ?? o.tacheOmbre.slice(0, 8)} — {t('ombre', 'shadow')}{' '}
              <span className="banc-ombre-modeles">{o.modeleOmbre}</span> ·{' '}
              {t('originale', 'original')}{' '}
              <span className="banc-ombre-modeles">{o.modeleOriginal}</span>
            </li>
          ))}
        </ul>
      )}

      {erreur && <p className="garde-fou-erreur">{erreur}</p>}
    </section>
  );
}

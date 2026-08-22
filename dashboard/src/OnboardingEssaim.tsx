// Wizard onboarding — Projets → checklist interactive jusqu’au premier cycle runner.

import { useCallback, useEffect, useState } from 'react';
import { fetchEssaim, fetchEssaimCycles } from './api';
import type { CycleEssaimUi, EtatEssaimUi, PretEssaimUi } from './api';
import { useT } from './i18n';
import './onboarding.css';

const PERIODE_MS = 4_000;

function pretComplet(p: PretEssaimUi): boolean {
  return (
    p.runner &&
    p.gouvernantes &&
    p.noeudsEnLigne &&
    p.agentsReels &&
    p.depot &&
    p.derive &&
    p.plafond &&
    p.repo
  );
}

interface Etape {
  id: string;
  ok: boolean;
  fr: string;
  en: string;
  hintFr: string;
  hintEn: string;
}

function etapes(pret: PretEssaimUi): Etape[] {
  return [
    {
      id: 'noeuds',
      ok: pret.noeudsEnLigne && pret.agentsReels,
      fr: 'Lancer des nœuds réels (pas shell)',
      en: 'Start real nodes (not shell)',
      hintFr: 'Sur chaque machine : npm run node — agents claude-code/codex détectés.',
      hintEn: 'On each machine: npm run node — claude-code/codex agents detected.',
    },
    {
      id: 'runner',
      ok: pret.runner,
      fr: 'Activer HIVE_RUNNER=on sur la Queen',
      en: 'Enable HIVE_RUNNER=on on the Queen',
      hintFr: 'Variable d’environnement orchestrateur, puis redémarrer la ruche.',
      hintEn: 'Orchestrator env var, then restart the hive.',
    },
    {
      id: 'gouv',
      ok: pret.gouvernantes,
      fr: 'Nommer assez de Gouvernantes',
      en: 'Appoint enough Governesses',
      hintFr: 'Chambre → baptiser et assigner des rôles de gouvernance.',
      hintEn: 'Chamber → baptize and assign governance roles.',
    },
    {
      id: 'repo',
      ok: pret.repo && pret.depot,
      fr: 'Lier le dépôt GitHub (si fusion autonome)',
      en: 'Link GitHub repo (if auto-merge)',
      hintFr: 'Projets → repo URL + inscrire le dépôt dans Plein Essaim.',
      hintEn: 'Projects → repo URL + enroll depot in Full Swarm panel.',
    },
    {
      id: 'sante',
      ok: pret.derive && pret.plafond,
      fr: 'Santé et plafond OK',
      en: 'Health and spend cap OK',
      hintFr: 'Résoudre la dérive dégradée et débloquer le plafond Balance si besoin.',
      hintEn: 'Fix degraded drift and unblock Balance cap if needed.',
    },
  ];
}

export function OnboardingEssaim({ projectId }: { projectId: string }) {
  const t = useT();
  const [etat, setEtat] = useState<EtatEssaimUi | null>(null);
  const [cycles, setCycles] = useState<CycleEssaimUi[]>([]);
  const [ferme, setFerme] = useState(false);

  const charger = useCallback(async () => {
    try {
      const [e, c] = await Promise.all([
        fetchEssaim(projectId),
        fetchEssaimCycles(projectId).catch(() => ({ cycles: [] as CycleEssaimUi[] })),
      ]);
      setEtat(e);
      setCycles(c.cycles);
    } catch {
      setEtat(null);
    }
  }, [projectId]);

  useEffect(() => {
    void charger();
    const id = setInterval(() => void charger(), PERIODE_MS);
    return () => clearInterval(id);
  }, [charger]);

  if (ferme || !etat?.pret) return null;
  if (etat.niveau !== 'off' && cycles.length > 0) return null;
  if (pretComplet(etat.pret) && cycles.length > 0) return null;

  const steps = etapes(etat.pret);
  const done = steps.filter((s) => s.ok).length;
  const actif = steps.find((s) => !s.ok) ?? steps[steps.length - 1]!;

  return (
    <section className="onboarding-essaim" aria-label={t('Premier cycle autonome', 'First autonomous cycle')}>
      <header className="onboarding-entete">
        <h3>{t('Chemin vers le premier cycle', 'Path to the first cycle')}</h3>
        <button type="button" className="btn ghost btn-sm" onClick={() => setFerme(true)}>
          {t('Masquer', 'Hide')}
        </button>
      </header>
      <p className="muted-text">
        {t(
          `${done}/${steps.length} prérequis — puis passez le niveau d’autonomie sous « Plein Essaim ».`,
          `${done}/${steps.length} prerequisites — then raise autonomy under « Full Swarm ».`,
        )}
      </p>
      <ol className="onboarding-etapes">
        {steps.map((s) => (
          <li key={s.id} className={s.ok ? 'onboarding-ok' : s.id === actif.id ? 'onboarding-actif' : ''}>
            <span className="onboarding-puce">{s.ok ? '✓' : '○'}</span>
            <div>
              <strong>{t(s.fr, s.en)}</strong>
              {(!s.ok && s.id === actif.id) && (
                <p className="onboarding-hint">{t(s.hintFr, s.hintEn)}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
      {pretComplet(etat.pret) && (
        <p className="onboarding-pret">
          {t(
            '✔ Checklist complète — choisissez « propose » ou « gouverne » dans Plein Essaim pour lancer le runner.',
            '✔ Checklist complete — pick « propose » or « govern » in Full Swarm to start the runner.',
          )}
        </p>
      )}
    </section>
  );
}

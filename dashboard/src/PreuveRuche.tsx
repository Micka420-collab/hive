// LA PREUVE, dans le cockpit — ce que la ruche fait qu'un agent seul ne fait pas,
// compté sur le journal réel (`src/orchestrator/preuve.ts`, `GET /api/preuve`).
//
// Quatre mesures, une ligne chacune : relue par une autre famille, validée
// dans un bac, coût déclaré, désaccords tranchés par un humain. Chaque mesure
// est une FRACTION de ce qui a été produit — jamais un score, jamais une
// moyenne — et la phrase sous le chiffre dit ce qu'il compte. Un journal
// élagué le dit en tête : les nombres portent sur ce qui reste.
//
// Pas de « vs un agent seul » : personne n'a fait tourner l'agent seul ici.
// Ce que la carte montre, c'est ce que la ruche a FAIT de ses productions.

import type { Preuve } from './api';
import { useLang, useT } from './i18n';
import { EchecSondage } from './views/shared';
import type { Poll } from './views/shared';

interface Props {
  preuve: Poll<Preuve>;
}

/** `n sur total`, et la part en pourcent arrondi — `null` sans dénominateur. */
export function part(n: number, total: number): { texte: string; pct: number | null } {
  if (total <= 0) return { texte: `${n}`, pct: null };
  return { texte: `${n} / ${total}`, pct: Math.round((n / total) * 100) };
}

function usd(v: number, lang: 'fr' | 'en'): string {
  return new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'fr-FR', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: v < 1 ? 3 : 2,
  }).format(v);
}

export function PreuveRuche({ preuve }: Props) {
  const t = useT();
  const lang = useLang();
  const p = preuve.data;

  return (
    <section
      className="preuve-ruche card"
      aria-labelledby="preuve-titre"
      data-testid="preuve-ruche"
    >
      <header className="preuve-tete">
        <h3 id="preuve-titre">{t('Ce que la ruche prouve', 'What the hive proves')}</h3>
        <p className="preuve-sous">
          {t(
            'Compté sur le journal, production par production. Rien d’estimé.',
            'Counted from the journal, production by production. Nothing estimated.',
          )}
          {p?.fenetre.elague && (
            <>
              {' '}
              <span className="preuve-elague">
                {t(
                  'Le journal a été élagué : ces nombres portent sur ce qui reste.',
                  'The journal was pruned: these numbers cover what remains.',
                )}
              </span>
            </>
          )}
        </p>
      </header>

      <EchecSondage sondage={preuve} avant={t('Preuve indisponible :', 'Evidence unavailable:')} />

      {p && p.productions.rendues === 0 && (
        <p className="preuve-vide">
          {t(
            'Aucune production rendue dans la fenêtre du journal. La preuve commence à la première tâche terminée.',
            'No production delivered within the journal window. Evidence starts with the first completed task.',
          )}
        </p>
      )}

      {p && p.productions.rendues > 0 && (
        <ul className="preuve-mesures">
          <Mesure
            testid="preuve-relecture"
            valeur={part(p.productions.reluesParAutreFamille, p.productions.rendues)}
            libelle={t('relues par une autre famille d’agent', 'reviewed by another agent family')}
            detail={
              [
                p.productions.contestees > 0
                  ? t(
                      `${p.productions.contestees} contestée(s)`,
                      `${p.productions.contestees} contested`,
                    )
                  : null,
                p.productions.reprisesApresRelecture > 0
                  ? t(
                      `${p.productions.reprisesApresRelecture} reprise(s) après relecture`,
                      `${p.productions.reprisesApresRelecture} reworked after review`,
                    )
                  : null,
                p.productions.reluesParMemeFamille > 0
                  ? t(
                      `${p.productions.reluesParMemeFamille} relue(s) par la même famille`,
                      `${p.productions.reluesParMemeFamille} reviewed by the same family`,
                    )
                  : null,
                p.productions.relectureImpossible > 0
                  ? t(
                      `${p.productions.relectureImpossible} relecture(s) impossible(s) — une seule famille en ligne`,
                      `${p.productions.relectureImpossible} review(s) impossible — one family online`,
                    )
                  : null,
                p.familles.length > 0
                  ? t(`familles : ${p.familles.join(', ')}`, `families: ${p.familles.join(', ')}`)
                  : null,
              ]
                .filter((x): x is string => x !== null)
                .join(' · ') || null
            }
          />
          <Mesure
            testid="preuve-bac"
            valeur={part(p.bac.validees, p.productions.rendues)}
            libelle={t(
              'validées dans un bac (tests, types, build, lint)',
              'validated in a sandbox (tests, types, build, lint)',
            )}
            detail={
              [
                p.bac.toutPasse > 0
                  ? t(`${p.bac.toutPasse} tout vert`, `${p.bac.toutPasse} all green`)
                  : null,
                p.bac.unEchec > 0
                  ? t(
                      `${p.bac.unEchec} avec un contrôle rouge — vu avant la livraison`,
                      `${p.bac.unEchec} with a red check — caught before delivery`,
                    )
                  : null,
                p.noeuds.total > 0
                  ? t(
                      `${p.noeuds.isoles}/${p.noeuds.total} nœud(s) isolé(s)${p.noeuds.conteneur > 0 ? `, ${p.noeuds.conteneur} en conteneur` : ''}`,
                      `${p.noeuds.isoles}/${p.noeuds.total} node(s) isolated${p.noeuds.conteneur > 0 ? `, ${p.noeuds.conteneur} in a container` : ''}`,
                    )
                  : null,
              ]
                .filter((x): x is string => x !== null)
                .join(' · ') || null
            }
          />
          <Mesure
            testid="preuve-cout"
            valeur={part(p.cout.declarees, p.cout.declarees + p.cout.inconnues)}
            libelle={t(
              'tentatives au coût déclaré par le CLI',
              'attempts with a CLI-declared cost',
            )}
            detail={
              p.cout.declarees > 0
                ? t(
                    `${usd(p.cout.totalUsd, lang)} déclarés · ${p.cout.inconnues} inconnue(s), jamais estimée(s)`,
                    `${usd(p.cout.totalUsd, lang)} declared · ${p.cout.inconnues} unknown, never estimated`,
                  )
                : t(
                    'aucun coût déclaré — inconnu, jamais estimé',
                    'no cost declared — unknown, never estimated',
                  )
            }
          />
          <Mesure
            testid="preuve-humain"
            valeur={{ texte: `${p.decisionsHumaines}`, pct: null }}
            libelle={t(
              'désaccord(s) entre IA tranché(s) par un humain',
              'disagreement(s) between AIs settled by a human',
            )}
            detail={
              p.bac.portes > 0
                ? t(
                    `${p.bac.portes} porte(s) de sécurité enregistrée(s)`,
                    `${p.bac.portes} security gate(s) recorded`,
                  )
                : null
            }
          />
        </ul>
      )}
    </section>
  );
}

function Mesure({
  testid,
  valeur,
  libelle,
  detail,
}: {
  testid: string;
  valeur: { texte: string; pct: number | null };
  libelle: string;
  detail: string | null;
}) {
  return (
    <li className="preuve-mesure" data-testid={testid}>
      <div className="preuve-chiffre">
        <strong>{valeur.texte}</strong>
        {valeur.pct !== null && <span className="preuve-pct">{valeur.pct} %</span>}
      </div>
      <div className="preuve-texte">
        <span className="preuve-libelle">{libelle}</span>
        {detail && <span className="preuve-detail">{detail}</span>}
      </div>
      {valeur.pct !== null && (
        <div className="preuve-jauge" aria-hidden="true">
          <span style={{ width: `${valeur.pct}%` }} />
        </div>
      )}
    </li>
  );
}

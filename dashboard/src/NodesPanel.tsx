// Panneau des nœuds : une carte par machine membre, avec charge, agent — et
// la MACHINE elle-même (🪟/🍎/🐧), déclarée par le nœud à l'inscription.
//
// ─── LA FICHE COÉQUIPIÈRE (mission « Le Poste », lot 2) ──────────────────────
//
// Chaque ouvrière se présente comme une COÉQUIPIÈRE, pas comme une ligne de
// monitoring : cliquer sa carte ouvre sa fiche — qui elle est (machine, agent,
// hôte), ce qu'elle porte (charge), et SES MISSIONS — les tâches qu'elle a
// butinées ou qu'elle butine, cliquables vers le tiroir de tâche, qui montre
// le diff et les logs. C'est l'entrée par ouvrière vers ce que la ruche sait
// déjà montrer par tâche.
//
// La fiche ne s'offre que si l'appelant fournit les tâches et le geste
// d'ouverture : les rendus qui n'ont que les nœuds gardent le panneau d'avant.

import { useEffect, useState } from 'react';
import { PICTO_PLATEFORME } from '../../src/shared/machine';
import type { HiveNode, Task } from '../../src/shared/types';
import { fetchChambre, fetchWaggle } from './api';
import type { NodeNectar } from './api';
import { useLang, useT } from './i18n';
import { libelleAgent } from '../../src/shared/agent-libelle';
import { direNiveau } from '../../src/shared/catalogue-outils';
import {
  combienPilotables,
  commandeAAfficher,
  direOutil,
  outilsDuNoeud,
} from '../../src/shared/outils-du-noeud';
import { copierTexte } from './copier';
import { activateProps, ProgressBar, STATUS_ICON, useDialog, Voile } from './ui';
import { useBaptemes } from './useBaptemes';

const AGENT_ICON: Record<string, string> = {
  shell: '○',
  'claude-code': '✦',
  codex: '⌗',
};

/**
 * La commande d'installation d'un outil, à COPIER — jamais à lancer.
 *
 * ─── CE QUE CE BOUTON NE FAIT PAS, ET POURQUOI ──────────────────────────────
 *
 * Il ne déclenche RIEN sur la machine du membre. Un tableau de bord qui lance
 * `npm install -g` à distance sur le poste de quelqu'un est une surface
 * d'attaque, pas une commodité : il suffit d'un accès à l'écran d'admin pour
 * faire installer un paquet arbitraire sur toutes les machines de l'essaim.
 *
 * La ruche montre donc la commande, et c'est l'humain qui la colle dans SON
 * terminal, après l'avoir lue. La différence tient en un geste, et ce geste
 * est le consentement.
 */
function CommandeACopier({ commande }: { commande: string }) {
  const t = useT();
  const [copie, setCopie] = useState(false);
  const [rate, setRate] = useState(false);
  return (
    <span className="fo-outil-pose">
      <code className="fo-outil-commande" data-testid="fo-outil-commande">
        {commande}
      </code>{' '}
      <button
        type="button"
        className="copy-btn"
        data-testid="fo-outil-copier"
        onClick={() => {
          void copierTexte(commande).then((ok) => {
            setCopie(ok);
            setRate(!ok);
            if (ok) setTimeout(() => setCopie(false), 1500);
          });
        }}
      >
        {copie ? t('copié', 'copied') : t('copier', 'copy')}
      </button>
      {rate && (
        <span className="fo-outil-rate" data-testid="fo-outil-copie-ratee">
          {' '}
          {t(
            'copie impossible — sélectionnez la commande à la main.',
            'copy failed — select the command by hand.',
          )}
        </span>
      )}
    </span>
  );
}

function initials(name: string): string {
  return name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * Les missions d'UNE ouvrière : celles qu'elle porte (assignées/en cours) et
 * celles qu'elle a rendues (le résultat porte son nom, même si la tâche a été
 * réassignée depuis). Les plus récentes d'abord.
 */
function missionsDe(noeud: HiveNode, tasks: Task[]): Task[] {
  return tasks
    .filter((t) => t.assignedNodeId === noeud.id || t.result?.nodeId === noeud.id)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function FicheOuvriere({
  noeud,
  tasks,
  onOpenTask,
  onOuvrirPoste,
  onClose,
}: {
  noeud: HiveNode;
  tasks: Task[];
  onOpenTask: (id: string) => void;
  onOuvrirPoste?: (nodeId: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const missions = missionsDe(noeud, tasks);
  const butinees = missions.filter((m) => m.status === 'done').length;
  const echouees = missions.filter((m) => m.status === 'failed').length;

  // Le nectar de CETTE ouvrière — sa ligne du Waggle Board. UN relevé à
  // l'ouverture de la fiche, pas une sonde de plus qui battrait pour rien :
  // la fiche est éphémère, le classement bouge à l'échelle de la tâche.
  // En panne, la fiche reste utile : le nectar se tait, il ne bloque rien.
  // ─── LA FICHE SE FERME AU CLAVIER, COMME SES CINQ SŒURS ───────────────────
  //
  // DÉFAUT MESURÉ : elle se déclarait `role="dialog" aria-modal="true"` — donc
  // `modalOpen()` la voyait et neutralisait les raccourcis de la coquille ET
  // ceux du Time-Lapse — sans rien qui la ferme au clavier. Elle prenait le
  // clavier à tout le monde et n'en rendait rien : ouverte, on ne pouvait plus
  // ni naviguer par les chiffres, ni la refermer autrement qu'à la souris.
  //
  // `useDialog` apporte les trois gestes d'un dialogue : Échap ferme, le focus
  // entre à l'ouverture, et il RETOURNE à la carte qu'on a cliquée en sortant.
  const dialogRef = useDialog<HTMLDivElement>(onClose);
  const [nectar, setNectar] = useState<NodeNectar | null>(null);
  /** Baptême constaté — null = silence (pas le name technique inventé en titre). */
  const [bapteme, setBapteme] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let vivant = true;
    fetchWaggle()
      .then((w) => {
        if (vivant) setNectar(w.nodes.find((n) => n.nodeId === noeud.id) ?? null);
      })
      .catch(() => {
        /* classement injoignable : la fiche vit sans lui */
      });
    fetchChambre(noeud.id)
      .then((p) => {
        if (vivant) setBapteme(p.bapteme?.nom ?? null);
      })
      .catch(() => {
        /* Panne API ≠ « Pas encore baptisée » — garder le nom technique. */
      });
    return () => {
      vivant = false;
    };
  }, [noeud.id]);

  const titreAffiche =
    bapteme === undefined ? noeud.name : (bapteme ?? t('Pas encore baptisée', 'Not baptised yet'));

  return (
    <Voile onClose={onClose}>
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fiche-ouvriere-titre"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2 id="fiche-ouvriere-titre">
            {AGENT_ICON[noeud.agentType] ?? '•'}{' '}
            <span className={bapteme ? undefined : 'muted-text'}>{titreAffiche}</span>
          </h2>
          <button className="modal-close" onClick={onClose} aria-label={t('Fermer', 'Close')}>
            ×
          </button>
        </header>

        <p className="fo-identite">
          {t('Chez', 'At')} {noeud.ownerName} · {libelleAgent(noeud.agentType, lang === 'en')}
          {noeud.plateforme && (
            <span className="node-plateforme" title={noeud.plateforme}>
              {' '}
              · {PICTO_PLATEFORME[noeud.plateforme]} {noeud.plateforme}
            </span>
          )}
          {' · '}
          {noeud.status === 'online' ? t('en ligne', 'online') : t('hors ligne', 'offline')} ·{' '}
          {noeud.running}/{noeud.maxConcurrency} {t('en vol', 'in flight')}
        </p>
        {bapteme !== undefined && (
          <p className="fo-technique muted-text">
            {t('Technique', 'Technical')} · {noeud.name}
          </p>
        )}

        {nectar && (
          <p className="fo-nectar">
            {nectar.score} {t('nectar', 'nectar')} · {Math.round(nectar.successRate * 100)} %{' '}
            {t('de réussite', 'success')}
            {nectar.raceWins > 0 && (
              <span className="fo-victoires">
                {' '}
                · ◇ {nectar.raceWins} {t('victoire(s) de course', 'race win(s)')}
              </span>
            )}
          </p>
        )}

        {/* ─── SES OUTILS IA ────────────────────────────────────────────
         *
         * Le nœud a CONSTATÉ ce que porte sa machine ; le catalogue dit
         * jusqu'où la ruche va avec chacun. On affiche les DEUX, parce que
         * l'un sans l'autre ment :
         *
         *   · « Windsurf ✓ » seul laisse croire qu'il travaille pour la ruche ;
         *   · « Windsurf : détecté seulement » seul laisse croire qu'il n'est
         *     pas installé.
         *
         * `outils` ABSENT n'est pas une liste vide : c'est un nœud d'avant
         * cette version, qui n'a jamais rien déclaré. On le DIT, au lieu de
         * dessiner une machine nue qui ne l'est pas.
         */}
        <h3 className="fo-sous-titre">
          {t('Ses outils IA', 'Their AI tools')}{' '}
          {noeud.outils !== undefined && (
            <span className="panel-count" data-testid="fo-outils-compte">
              {combienPilotables(outilsDuNoeud(noeud.outils))}{' '}
              {t('pilotable(s) par la ruche', 'drivable by the hive')}
            </span>
          )}
        </h3>
        {noeud.outils === undefined ? (
          <p className="muted-text" data-testid="fo-outils-inconnus">
            {t(
              'Ce nœud n’a rien déclaré — il tourne une version antérieure. La ruche ne sait donc pas ce que sa machine porte.',
              'This node declared nothing — it runs an older version. The hive therefore does not know what its machine carries.',
            )}
          </p>
        ) : (
          <ul className="queue fo-outils" data-testid="fo-outils">
            {outilsDuNoeud(noeud.outils).map((o) => (
              <li
                key={o.id}
                className={o.pilotable ? 'fo-outil fo-outil-pilotable' : 'fo-outil'}
                data-testid={`fo-outil-${o.id}`}
              >
                <span aria-hidden="true">{o.pilotable ? '✦' : '·'}</span> {o.nom}
                <span className="fo-outil-etat">
                  {' '}
                  — {direOutil(o, lang === 'en' ? 'en' : 'fr')}
                </span>
                <span className="fo-outil-niveau muted-text">
                  {' · '}
                  {t('la ruche', 'the hive')}{' '}
                  {o.niveau === null
                    ? t('ne sait rien de cet outil', 'knows nothing about this tool')
                    : direNiveau(o.niveau, lang === 'en' ? 'en' : 'fr')}
                </span>
                {o.limite !== null && <span className="fo-outil-limite"> ({o.limite})</span>}
                {/* La commande n'apparaît QUE si la suivre règle tout en un
                    geste — la règle vit dans le module pur, pas ici. */}
                {commandeAAfficher(o) !== null && (
                  <CommandeACopier commande={commandeAAfficher(o)!} />
                )}
              </li>
            ))}
          </ul>
        )}

        <h3 className="fo-sous-titre">
          {t('Ses missions', 'Their missions')}{' '}
          <span className="panel-count">
            ✔ {butinees} · ✘ {echouees}
          </span>
        </h3>
        {missions.length === 0 ? (
          <p className="muted-text">
            {t(
              'Aucune mission encore — cette ouvrière n’a rien butiné pour l’instant.',
              'No mission yet — this worker has not foraged anything so far.',
            )}
          </p>
        ) : (
          <ul className="queue fo-missions">
            {missions.slice(0, 8).map((m) => (
              <li key={m.id} className="fo-mission" {...activateProps(() => onOpenTask(m.id))}>
                <span aria-hidden="true">{STATUS_ICON[m.status]}</span> {m.title}
              </li>
            ))}
          </ul>
        )}

        {onOuvrirPoste && (
          <footer className="fo-actions" style={{ marginTop: 14 }}>
            <button
              type="button"
              className="btn primary"
              data-testid="fiche-ouvrir-chambre"
              onClick={() => {
                const id = noeud.id;
                onClose();
                onOuvrirPoste(id);
              }}
            >
              {bapteme
                ? t(`Ouvrir la Chambre · ${bapteme}`, `Open the Chambre · ${bapteme}`)
                : t('Ouvrir la Chambre', 'Open the Chambre')}
            </button>
          </footer>
        )}
      </div>
    </Voile>
  );
}

export function NodesPanel({
  nodes,
  tasks,
  onOpenTask,
  onOuvrirPoste,
}: {
  nodes: HiveNode[];
  /** Fournies : les cartes deviennent cliquables et ouvrent la fiche. */
  tasks?: Task[];
  onOpenTask?: (id: string) => void;
  /** Chambre (ADR 0010) — ouvre `#/chambre/<nodeId>`. */
  onOuvrirPoste?: (nodeId: string) => void;
}) {
  const t = useT();
  const lang = useLang();
  const online = nodes.filter((n) => n.status === 'online').length;
  const [ouverte, setOuverte] = useState<string | null>(null);
  const fiche =
    tasks && onOpenTask && ouverte ? (nodes.find((n) => n.id === ouverte) ?? null) : null;
  const nodeIdsKey = nodes.map((n) => n.id).join(',');
  const baptemes = useBaptemes(nodeIdsKey);
  const shellNodes = nodes.filter((n) => n.agentType === 'shell' || n.agentType === 'sim');

  return (
    <section className="card panel">
      <header className="panel-head">
        <h2>{t('Nœuds', 'Nodes')}</h2>
        <span className="panel-count">
          {online}/{nodes.length} {t('en ligne', 'online')}
        </span>
      </header>
      {shellNodes.length > 0 && (
        <p className="node-shell-avert">
          {t(
            `${shellNodes.length} nœud(s) en mode shell/simulation — les diffs ne viennent pas d’un agent de codage réel. Installez Claude Code, Codex ou un agent compatible pour une autonomie crédible.`,
            `${shellNodes.length} node(s) in shell/simulation mode — diffs do not come from a real coding agent. Install Claude Code, Codex, or a compatible agent for credible autonomy.`,
          )}
        </p>
      )}
      <ul className="node-list">
        {nodes.map((n) => {
          const bapt = baptemes ? (baptemes[n.id] ?? null) : undefined;
          const label = bapt || n.name;
          return (
            <li
              key={n.id}
              className={`node-card ${n.status}`}
              aria-label={t(`Fiche · ${label}`, `Sheet · ${label}`)}
              {...(tasks && onOpenTask ? activateProps(() => setOuverte(n.id)) : {})}
            >
              <div className="node-avatar" title={libelleAgent(n.agentType, lang === 'en')}>
                {initials(label)}
                <span className="node-agent">{AGENT_ICON[n.agentType] ?? '•'}</span>
              </div>
              <div className="node-body">
                <div className="nc-name">
                  <span className={bapt ? undefined : bapt === null ? 'muted-text' : undefined}>
                    {bapt === null ? t('Pas encore baptisée', 'Not baptised yet') : label}
                  </span>
                  <span
                    className={`dot ${n.status}`}
                    title={
                      n.status === 'online' ? t('en ligne', 'online') : t('hors ligne', 'offline')
                    }
                  />
                </div>
                <div className="node-meta">
                  {(bapt || bapt === null) && (
                    <>
                      <span className="muted-text">
                        {t('Technique', 'Technical')} · {n.name}
                      </span>
                      {' · '}
                    </>
                  )}
                  {n.ownerName} · {libelleAgent(n.agentType, lang === 'en')}
                  {n.plateforme && (
                    <span className="node-plateforme" title={n.plateforme}>
                      {' '}
                      · {PICTO_PLATEFORME[n.plateforme]} {n.plateforme}
                    </span>
                  )}
                </div>
                <ProgressBar value={n.running} max={Math.max(n.maxConcurrency, 1)} />
              </div>
              <div className="node-load">
                {n.running}/{n.maxConcurrency}
              </div>
            </li>
          );
        })}
        {nodes.length === 0 && (
          <li className="empty">
            {t(
              'Aucun nœud pour l’instant. Lancez un nœud sur cette machine, ou invitez un ami quand vous voulez.',
              'No nodes yet. Start a node on this machine, or invite a friend when you want.',
            )}
          </li>
        )}
      </ul>

      {fiche && tasks && onOpenTask && (
        <FicheOuvriere
          noeud={fiche}
          tasks={tasks}
          onOpenTask={(id) => {
            // Ouvrir le tiroir FERME la fiche : deux surfaces modales empilées
            // se disputeraient le clavier et l'attention.
            setOuverte(null);
            onOpenTask(id);
          }}
          onOuvrirPoste={onOuvrirPoste}
          onClose={() => setOuverte(null)}
        />
      )}
    </section>
  );
}

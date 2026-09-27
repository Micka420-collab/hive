// LE COMPAGNON DE MISSION CONTROL — un petit animal dans la barre, qui dit
// d'un coup d'œil ce que fait la ruche.
//
// ─── CE QU'IL EST, ET CE QU'IL N'EST PAS ────────────────────────────────────
//
// Il RÉSUME : au repos, au travail sur n tâches, en alerte quand un humain est
// attendu, en fête quand une livraison vient d'être acceptée, et « inconnu »
// quand le flux est coupé (`compagnon-etat.ts` décide, ce fichier peint). Il ne
// remplace aucun écran, ne porte aucun geste sur la ruche et n'ajoute aucune
// donnée : il relit les comptes que la barre affiche déjà.
//
// ─── IL NE COUVRE JAMAIS LE CONTENU ─────────────────────────────────────────
//
// Il habite la BARRE, entre la navigation et le pouls — pas un calque flottant
// au-dessus des vues. Un animal posé sur le coin d'un tableau finit toujours
// par masquer la ligne qu'on cherchait. Dans la barre, la navigation défile
// (`.mc-nav` a son propre défilement) : il ne prend la place de rien.
//
// ─── RANGEABLE, SOBRE, SANS MOUVEMENT FORCÉ ─────────────────────────────────
//
// Un clic ouvre ses réglages (choisir, apporter le sien, le ranger). Rangé, il
// laisse une alvéole de 14 px pour le rappeler — rien de plus. Sous
// `prefers-reduced-motion`, il ne s'anime PAS du tout : ni battement d'ailes,
// ni planche qui défile — l'humeur se lit à la pastille et à la phrase.
//
// ─── LE COMPAGNON À SOI ─────────────────────────────────────────────────────
//
// Une image PNG ou WebP (fixe, ou planche horizontale de n images), rangée
// dans CE navigateur pour CE compte, affichée par `<img>` seulement. Les règles
// de sûreté sont écrites dans `compagnon-perso.ts`.

import { useEffect, useId, useState } from 'react';
import type { CSSProperties, FormEvent, ReactNode } from 'react';
import type { HiveEvent, Task } from '../../src/shared/types';
import {
  COMPAGNONS_INTEGRES,
  cleDuCompagnon,
  ecrireReglages,
  IMAGES_MAX,
  lireReglages,
  nombreImages,
  nomPropre,
  NOM_MAX,
  PERSO_MAX,
  TAILLE_MAX_OCTETS,
  urlDeDonnees,
  urlImageSure,
  verifierImage,
} from './compagnon-perso';
import type { CompagnonIntegre, CompagnonPerso, ReglagesCompagnon } from './compagnon-perso';
import { etatDuCompagnon, phraseDuCompagnon } from './compagnon-etat';
import type { HumeurCompagnon } from './compagnon-etat';
import { useLang, useT } from './i18n';
import type { Translate } from './i18n';
import { useDialog, Voile } from './ui';
import type { Pastille } from './views/pastille-alertes';
import './compagnon.css';

// ─── Le mouvement réduit, lu par le script ET par la feuille ─────────────────
//
// La garde universelle de `styles.css` écrase déjà les durées. Elle ne suffit
// pas ici : une planche d'images jouée « en 0,01 ms » saute à une image
// arbitraire, et un battement d'ailes réduit à une image reste un sursaut. Le
// compagnon lit donc la préférence lui-même et ne pose AUCUNE classe animée.

const REQUETE_MOUVEMENT = '(prefers-reduced-motion: reduce)';

function lireMouvementReduit(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia(REQUETE_MOUVEMENT).matches;
  } catch {
    return false;
  }
}

function useMouvementReduit(): boolean {
  const [reduit, setReduit] = useState(lireMouvementReduit);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(REQUETE_MOUVEMENT);
    const suivre = () => setReduit(mq.matches);
    mq.addEventListener?.('change', suivre);
    return () => mq.removeEventListener?.('change', suivre);
  }, []);
  return reduit;
}

// ─── Les trois compagnons intégrés — du SVG écrit ici, jamais apporté ────────

const NOMS_INTEGRES: Record<CompagnonIntegre, [string, string]> = {
  abeille: ['Abeille', 'Honeybee'],
  bourdon: ['Bourdon', 'Bumblebee'],
  osmie: ['Osmie', 'Mason bee'],
};

/** Les yeux : ouverts, ou fermés (repos, inconnu) — la feuille choisit. */
function Yeux({ cx, cy }: { cx: number; cy: number }) {
  return (
    <>
      <g className="cp-yeux-ouverts">
        <circle cx={cx} cy={cy} r="2.2" className="cp-blanc" />
        <circle cx={cx + 0.6} cy={cy} r="1.1" className="cp-pupille" />
      </g>
      <path
        className="cp-yeux-fermes"
        d={`M${cx - 2} ${cy} q2 1.8 4 0`}
        fill="none"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </>
  );
}

function Ailes() {
  return (
    <g className="cp-ailes">
      <ellipse
        className="cp-aile"
        cx="19"
        cy="14.5"
        rx="6"
        ry="9.5"
        transform="rotate(-22 19 14.5)"
      />
      <ellipse
        className="cp-aile"
        cx="27"
        cy="13.5"
        rx="5.5"
        ry="9"
        transform="rotate(14 27 13.5)"
      />
    </g>
  );
}

function Antennes({ x, y }: { x: number; y: number }) {
  return (
    <path
      className="cp-trait"
      d={`M${x} ${y} q0.5 -5 -2.5 -7.5 M${x + 3} ${y + 0.5} q2 -4.5 0.5 -8`}
      fill="none"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  );
}

function Abeille() {
  return (
    <>
      <Ailes />
      <path className="cp-trait" d="M10.5 29 6 30.6l4.5 1.5" strokeWidth="1.2" />
      <ellipse className="cp-miel" cx="23" cy="29" rx="13" ry="10" />
      <rect className="cp-bande" x="16.5" y="20" width="3.2" height="18" rx="1.6" />
      <rect className="cp-bande" x="23.2" y="19.2" width="3.2" height="19.6" rx="1.6" />
      <circle className="cp-tete" cx="36.5" cy="26.5" r="6.8" />
      <Antennes x={35.5} y={20.5} />
      <Yeux cx={38.6} cy={25.4} />
      <path className="cp-sourire" d="M38.5 29.6q1.6 1.4 3.2 0" fill="none" strokeWidth="1.2" />
    </>
  );
}

function Bourdon({ id }: { id: string }) {
  return (
    <>
      <Ailes />
      <defs>
        <clipPath id={id}>
          <circle cx="22.5" cy="29" r="12.5" />
        </clipPath>
      </defs>
      <circle className="cp-duvet" cx="22.5" cy="29" r="12.5" />
      <g clipPath={`url(#${id})`}>
        <rect className="cp-miel" x="9" y="15" width="30" height="30" />
        <rect className="cp-bande" x="15.5" y="15" width="8" height="30" />
        <rect className="cp-queue" x="9" y="15" width="6.5" height="30" />
      </g>
      <circle className="cp-tete" cx="36" cy="27.5" r="6.4" />
      <Antennes x={35} y={21.8} />
      <Yeux cx={38} cy={26.6} />
      <path className="cp-sourire" d="M37.8 30.6q1.5 1.3 3 0" fill="none" strokeWidth="1.2" />
    </>
  );
}

function Osmie() {
  return (
    <>
      <Ailes />
      <ellipse className="cp-rousse" cx="21" cy="30" rx="11.5" ry="8.5" />
      <path
        className="cp-trait"
        d="M13 25.5q-1.5 4.5 0 9M18 22.5q-1.6 7.5 0 15"
        fill="none"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <ellipse className="cp-metal" cx="31.5" cy="28" rx="5" ry="5.8" />
      <circle className="cp-metal" cx="38" cy="26" r="5.4" />
      <Antennes x={37} y={20.8} />
      <Yeux cx={39.8} cy={25} />
      <path className="cp-sourire" d="M39.4 28.8q1.4 1.2 2.8 0" fill="none" strokeWidth="1.1" />
    </>
  );
}

/** Le dessin d'un compagnon intégré. `useId` : chaque instance a SON masque. */
function DessinIntegre({ quel }: { quel: CompagnonIntegre }) {
  // Un `id` d'élément SVG cité dans `url(#…)` : on n'y garde que ce qu'une URL
  // de fragment accepte sans échappement.
  const masque = `cp-masque-${useId().replace(/[^\w-]/g, '')}`;
  // Cadré sur le dessin (dard à gauche, ailes en haut) et non sur la grille
  // de 48 : dans une fenêtre de 44 px, chaque unité perdue en marge rapetisse
  // l'animal.
  return (
    <svg className="cp-svg" viewBox="4 2 42 42" aria-hidden="true" focusable="false">
      {quel === 'abeille' && <Abeille />}
      {quel === 'bourdon' && <Bourdon id={masque} />}
      {quel === 'osmie' && <Osmie />}
    </svg>
  );
}

/**
 * Un compagnon personnel : UNIQUEMENT un `<img>`, source revérifiée au rendu.
 * Une planche de n images est posée n fois plus large que sa fenêtre, et
 * décalée d'une image à la fois (`steps`) — sans animation, on voit la première.
 */
function DessinPerso({ perso }: { perso: CompagnonPerso }) {
  if (!urlImageSure(perso.image)) return null;
  return (
    <span
      className={`cp-planche${perso.images > 1 ? ' cp-planche-multiple' : ''}`}
      style={{ '--compagnon-images': perso.images } as CSSProperties}
    >
      <img src={perso.image} alt="" draggable={false} />
    </span>
  );
}

function Dessin({ choix, perso }: { choix: string; perso: CompagnonPerso[] }) {
  const lePerso = perso.find((p) => p.id === choix);
  if (lePerso) return <DessinPerso perso={lePerso} />;
  const integre = (COMPAGNONS_INTEGRES as readonly string[]).includes(choix)
    ? (choix as CompagnonIntegre)
    : 'abeille';
  return <DessinIntegre quel={integre} />;
}

/** Ce que le compagnon porte à côté de lui : le nombre, « ! », « ? », ou des étincelles. */
function Insigne({ humeur, enCours }: { humeur: HumeurCompagnon; enCours: number }) {
  if (humeur === 'occupe') {
    return <span className="cp-pastille">{enCours > 99 ? '99+' : enCours}</span>;
  }
  if (humeur === 'alerte') return <span className="cp-pastille cp-pastille-alerte">!</span>;
  if (humeur === 'inconnu') return <span className="cp-pastille cp-pastille-inconnu">?</span>;
  if (humeur === 'fete') {
    return (
      <svg className="cp-etincelles" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        <path d="M8 8l1.2 3 3 1.2-3 1.2L8 16.4l-1.2-3-3-1.2 3-1.2z" />
        <path d="M40 5l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9z" />
        <path d="M43 36l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
      </svg>
    );
  }
  return null;
}

// ─── Les réglages ────────────────────────────────────────────────────────────

type ErreurAjout =
  'aucun_fichier' | 'vide' | 'trop_lourd' | 'format' | 'nom' | 'images' | 'plein' | 'lecture';

function phraseErreur(e: ErreurAjout, t: Translate): string {
  switch (e) {
    case 'aucun_fichier':
      return t('Choisissez une image.', 'Pick an image.');
    case 'vide':
      return t('Ce fichier est vide.', 'This file is empty.');
    case 'trop_lourd':
      return t('Trop lourd : 150 Kio au plus.', 'Too large: 150 KiB at most.');
    case 'format':
      return t(
        'Seules les images PNG ou WebP sont acceptées — ni SVG ni HTML, quel que soit le nom du fichier.',
        'Only PNG or WebP images are accepted — no SVG or HTML, whatever the file name.',
      );
    case 'nom':
      return t('Donnez-lui un nom.', 'Give it a name.');
    case 'images':
      return t(
        `Nombre d’images : un entier de 1 à ${IMAGES_MAX}.`,
        `Frame count: a whole number from 1 to ${IMAGES_MAX}.`,
      );
    case 'plein':
      return t(
        `${PERSO_MAX} compagnons à vous au plus — retirez-en un d’abord.`,
        `${PERSO_MAX} companions of your own at most — remove one first.`,
      );
    case 'lecture':
      return t(
        'Le navigateur n’a pas pu lire ce fichier.',
        'The browser could not read this file.',
      );
  }
}

function CadreReglages({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const ref = useDialog<HTMLDivElement>(onClose);
  return (
    <div
      ref={ref}
      className="modal cp-reglages"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cp-reglages-titre"
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

interface PropsReglages {
  reglages: ReglagesCompagnon;
  nonGarde: boolean;
  onChanger: (r: ReglagesCompagnon) => void;
  onClose: () => void;
}

function ReglagesDuCompagnon({ reglages, nonGarde, onChanger, onClose }: PropsReglages) {
  const t = useT();
  const lang = useLang();
  const [fichier, setFichier] = useState<File | null>(null);
  const [nom, setNom] = useState('');
  const [images, setImages] = useState('1');
  const [erreur, setErreur] = useState<ErreurAjout | null>(null);
  const [envoi, setEnvoi] = useState(false);
  // Remonte le formulaire après un ajout : le champ fichier n'est pas
  // contrôlable par React, et garderait sinon le nom du fichier déjà ajouté.
  const [formulaire, setFormulaire] = useState(0);

  const ajouter = async (e: FormEvent) => {
    e.preventDefault();
    setErreur(null);
    if (reglages.perso.length >= PERSO_MAX) return setErreur('plein');
    if (!fichier) return setErreur('aucun_fichier');
    const lenom = nomPropre(nom);
    if (lenom === '') return setErreur('nom');
    const n = nombreImages(images);
    if (n === null) return setErreur('images');
    setEnvoi(true);
    try {
      // La taille se juge AVANT de lire : un fichier de 40 Mo ne doit pas
      // être chargé en mémoire pour apprendre qu'on le refuse. `verifierImage`
      // la rejuge sur les octets lus — `File.size` n'est qu'une annonce.
      if (fichier.size === 0) return setErreur('vide');
      if (fichier.size > TAILLE_MAX_OCTETS) return setErreur('trop_lourd');
      const octets = new Uint8Array(await fichier.arrayBuffer());
      const verdict = verifierImage(octets);
      if (!verdict.ok) return setErreur(verdict.refus);
      const nouveau: CompagnonPerso = {
        id: `perso-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        nom: lenom,
        image: urlDeDonnees(octets, verdict.type),
        images: n,
      };
      onChanger({
        ...reglages,
        choix: nouveau.id,
        range: false,
        perso: [...reglages.perso, nouveau],
      });
      setFichier(null);
      setNom('');
      setImages('1');
      setFormulaire((n) => n + 1);
    } catch {
      setErreur('lecture');
    } finally {
      setEnvoi(false);
    }
  };

  const retirer = (id: string) => {
    const perso = reglages.perso.filter((p) => p.id !== id);
    onChanger({ ...reglages, perso, choix: reglages.choix === id ? 'abeille' : reglages.choix });
  };

  const options: { id: string; nom: string; perso?: CompagnonPerso }[] = [
    ...COMPAGNONS_INTEGRES.map((q) => ({ id: q, nom: NOMS_INTEGRES[q][lang === 'fr' ? 0 : 1] })),
    ...reglages.perso.map((p) => ({ id: p.id, nom: p.nom, perso: p })),
  ];

  return (
    <Voile onClose={onClose}>
      <CadreReglages onClose={onClose}>
        <header className="modal-head">
          <h2 id="cp-reglages-titre">
            <span className="marque" aria-hidden="true" /> {t('Votre compagnon', 'Your companion')}
          </h2>
          <button className="modal-close" onClick={onClose} aria-label={t('Fermer', 'Close')}>
            ×
          </button>
        </header>
        <p className="cp-explication">
          {t(
            'Il reflète la ruche : il se repose, travaille (avec le nombre de tâches en cours), s’agite quand quelque chose attend un humain et fait la fête quand une livraison est acceptée.',
            'It mirrors the hive: it rests, works (with the number of running tasks), fidgets when something waits for a human and celebrates when a delivery is accepted.',
          )}
        </p>
        {nonGarde && (
          <p className="modal-note" role="status">
            {t(
              'Ce navigateur n’a pas gardé le réglage (stockage plein ou bloqué) : il vaut pour cet onglet seulement.',
              'This browser did not keep the setting (storage full or blocked): it applies to this tab only.',
            )}
          </p>
        )}

        <fieldset className="cp-choix">
          <legend>{t('Choisir', 'Choose')}</legend>
          {options.map((o) => (
            <div key={o.id} className="cp-option">
              <label>
                <input
                  type="radio"
                  name="cp-choix"
                  value={o.id}
                  checked={reglages.choix === o.id}
                  onChange={() => onChanger({ ...reglages, choix: o.id, range: false })}
                />
                <span className="cp-apercu" aria-hidden="true">
                  <Dessin choix={o.id} perso={reglages.perso} />
                </span>
                <span className="cp-option-nom">{o.nom}</span>
              </label>
              {o.perso && (
                <button
                  type="button"
                  className="btn ghost cp-retirer"
                  onClick={() => retirer(o.id)}
                  aria-label={`${t('Retirer', 'Remove')} ${o.nom}`}
                >
                  {t('Retirer', 'Remove')}
                </button>
              )}
            </div>
          ))}
        </fieldset>

        <form key={formulaire} className="cp-ajout" onSubmit={(e) => void ajouter(e)} noValidate>
          <h3>{t('Apporter le vôtre', 'Bring your own')}</h3>
          <p className="cp-explication">
            {t(
              `Une image PNG ou WebP de 150 Kio au plus : fixe, ou une planche horizontale d’images de même taille. Elle reste dans ce navigateur, pour ce compte — rien n’est envoyé à la ruche.`,
              `A PNG or WebP image of 150 KiB at most: still, or a horizontal strip of same-size frames. It stays in this browser, for this account — nothing is sent to the hive.`,
            )}
          </p>
          <label className="field">
            <span>{t('Image', 'Image')}</span>
            <input
              type="file"
              accept="image/png,image/webp"
              onChange={(e) => setFichier(e.target.files?.[0] ?? null)}
            />
          </label>
          <label className="field">
            <span>{t('Nom', 'Name')}</span>
            <input
              type="text"
              value={nom}
              maxLength={NOM_MAX}
              onChange={(e) => setNom(e.target.value)}
            />
          </label>
          <label className="field">
            <span>
              {t('Nombre d’images de la planche (facultatif)', 'Frames in the strip (optional)')}
            </span>
            <input
              type="number"
              min={1}
              max={IMAGES_MAX}
              step={1}
              value={images}
              onChange={(e) => setImages(e.target.value)}
            />
          </label>
          {erreur && (
            <p className="modal-error" role="alert">
              {phraseErreur(erreur, t)}
            </p>
          )}
          <div className="modal-actions">
            <button type="submit" className="btn primary" disabled={envoi}>
              {t('Ajouter', 'Add')}
            </button>
          </div>
        </form>

        <div className="modal-actions cp-actions">
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              onChanger({ ...reglages, range: true });
              onClose();
            }}
          >
            {t('Ranger le compagnon', 'Put the companion away')}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            {t('Fermer', 'Close')}
          </button>
        </div>
      </CadreReglages>
    </Voile>
  );
}

// ─── Le compagnon dans la barre ──────────────────────────────────────────────

export interface PropsCompagnon {
  connecte: boolean;
  tasks: readonly Pick<Task, 'status'>[];
  aRevoir: number;
  pastille: Pastille | null;
  events: readonly HiveEvent[];
  /** Le compte connecté ; `null` sans session (clé `anonyme`). */
  userId: string | null;
}

export function Compagnon({ connecte, tasks, aRevoir, pastille, events, userId }: PropsCompagnon) {
  const t = useT();
  const lang = useLang();
  const reduit = useMouvementReduit();
  const cle = cleDuCompagnon(userId);
  const [reglages, setReglages] = useState<ReglagesCompagnon>(() => lireReglages(cle));
  const [nonGarde, setNonGarde] = useState(false);
  const [ouvert, setOuvert] = useState(false);
  // Le tic de fin de fête : un rendu à l'instant où elle finit.
  const [tic, setTic] = useState(0);

  // Changer de compte, c'est changer de compagnon.
  useEffect(() => {
    setReglages(lireReglages(cle));
    setNonGarde(false);
  }, [cle]);

  // Recalculée à CHAQUE rendu, sans mémo : l'humeur dépend de l'heure (la
  // fête a une fin), et le calcul est borné — un filtre sur la fenêtre de
  // tâches, et un parcours du journal qui s'arrête au premier événement trop
  // vieux. Un mémo sur les entrées figerait la fête jusqu'au prochain événement.
  const etat = etatDuCompagnon({ connecte, tasks, aRevoir, pastille, events }, Date.now());

  // La fin de la fête : UN minuteur, qui provoque le rendu où l'humeur redescend.
  useEffect(() => {
    if (etat.finFete === null) return;
    const attente = Math.max(0, etat.finFete - Date.now()) + 50;
    const id = window.setTimeout(() => setTic((n) => n + 1), attente);
    return () => window.clearTimeout(id);
  }, [etat.finFete, tic]);

  const changer = (r: ReglagesCompagnon) => {
    setReglages(r);
    setNonGarde(!ecrireReglages(cle, r));
  };

  const phrase = phraseDuCompagnon(etat, lang);

  return (
    <div
      className={`compagnon${reduit ? '' : ' cp-anime'}${reglages.range ? ' cp-range' : ''}`}
      data-humeur={etat.humeur}
      data-mouvement={reduit ? 'reduit' : 'normal'}
      data-testid="compagnon"
    >
      {reglages.range ? (
        <button
          type="button"
          className="cp-rappel"
          onClick={() => changer({ ...reglages, range: false })}
          aria-label={t('Rappeler le compagnon', 'Bring the companion back')}
          title={t('Rappeler le compagnon', 'Bring the companion back')}
        />
      ) : (
        <button
          type="button"
          className="cp-bouton"
          onClick={() => setOuvert(true)}
          aria-label={`${phrase} — ${t('réglages du compagnon', 'companion settings')}`}
          title={phrase}
        >
          <span className="cp-scene">
            <span className="cp-figure">
              <Dessin choix={reglages.choix} perso={reglages.perso} />
            </span>
            <Insigne humeur={etat.humeur} enCours={etat.enCours} />
          </span>
          <span className="cp-phrase" aria-hidden="true">
            {phrase}
          </span>
        </button>
      )}
      {ouvert && (
        <ReglagesDuCompagnon
          reglages={reglages}
          nonGarde={nonGarde}
          onChanger={changer}
          onClose={() => setOuvert(false)}
        />
      )}
    </div>
  );
}

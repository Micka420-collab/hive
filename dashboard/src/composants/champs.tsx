// LES CHAMPS DE SAISIE — un libellé, une aide, une erreur, toujours reliés.
//
// ─── CE QUI CLOCHAIT ─────────────────────────────────────────────────────────
//
// Chaque formulaire du tableau de bord écrivait son champ à la main : un
// `<label className="field">` ici, un `<span>` posé à côté là, une erreur dans
// un `<p>` que rien ne rattachait au champ. À l'œil, ça se ressemble. Au
// lecteur d'écran, un champ en faute ne disait RIEN de sa faute : l'erreur
// n'était reliée au champ ni par `aria-describedby`, ni par `aria-invalid`.
//
// ─── LE CONTRAT ─────────────────────────────────────────────────────────────
//
//   · un `<label for>` réel — cliquer le libellé donne le focus au champ ;
//   · l'aide ET l'erreur dans `aria-describedby`, dans cet ordre ;
//   · `aria-invalid` posé dès qu'il y a une erreur, retiré sinon ;
//   · la zone d'erreur EXISTE avant l'erreur (`aria-live`) : une région qui
//     apparaît en même temps que son texte n'est pas annoncée par tous les
//     lecteurs d'écran ;
//   · l'erreur ne passe pas que par la couleur : « ⚠ » la précède.
//
// Les contrôles restent NATIFS (`input`, `textarea`, `select`) : le clavier,
// l'autoremplissage, le mode Contraste élevé et les claviers mobiles
// fonctionnent sans rien réimplémenter. Un `<select>` maison serait à réécrire
// tout entier pour le clavier, et le perdrait à la première régression.

import { useId } from 'react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

/** Ce que tout champ porte, en plus de son contrôle. */
export interface ProprietesChamp {
  libelle: ReactNode;
  /** Une phrase qui dit quoi mettre — liée au champ, lue après le libellé. */
  aide?: ReactNode;
  /** La faute, en clair. Présente = champ invalide ; absente = champ valide. */
  erreur?: ReactNode;
  /** Champ obligatoire : `required` sur le contrôle, astérisque sur le libellé. */
  requis?: boolean;
}

/** Les identifiants d'un champ et ce que son contrôle doit porter. */
function useChamp(
  idImpose: string | undefined,
  { aide, erreur }: Pick<ProprietesChamp, 'aide' | 'erreur'>,
) {
  const genere = useId();
  const id = idImpose ?? genere;
  const idAide = `${id}-aide`;
  const idErreur = `${id}-erreur`;
  const decrit = [aide ? idAide : null, erreur ? idErreur : null].filter(Boolean).join(' ');
  return {
    id,
    idAide,
    idErreur,
    controle: {
      id,
      'aria-describedby': decrit === '' ? undefined : decrit,
      'aria-invalid': erreur ? (true as const) : undefined,
    },
  };
}

/** L'aide et la zone d'erreur, communes aux champs et aux groupes. */
function AideEtErreur({
  idAide,
  idErreur,
  aide,
  erreur,
}: {
  idAide: string;
  idErreur: string;
  aide?: ReactNode;
  erreur?: ReactNode;
}) {
  return (
    <>
      {aide && (
        <p id={idAide} className="ds-champ-aide">
          {aide}
        </p>
      )}
      <p id={idErreur} className="ds-champ-erreur" aria-live="polite">
        {erreur ? (
          <>
            <span aria-hidden="true">⚠ </span>
            {erreur}
          </>
        ) : null}
      </p>
    </>
  );
}

function Cadre({
  id,
  idAide,
  idErreur,
  libelle,
  aide,
  erreur,
  requis,
  children,
}: ProprietesChamp & { id: string; idAide: string; idErreur: string; children: ReactNode }) {
  return (
    <div className={`ds-champ${erreur ? ' ds-champ--erreur' : ''}`}>
      <label className="ds-champ-libelle" htmlFor={id}>
        {libelle}
        {requis && (
          <span className="ds-champ-requis" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>
      {children}
      <AideEtErreur idAide={idAide} idErreur={idErreur} aide={aide} erreur={erreur} />
    </div>
  );
}

export function Input({
  libelle,
  aide,
  erreur,
  requis,
  id: idImpose,
  className,
  ...reste
}: ProprietesChamp & ComponentPropsWithoutRef<'input'>) {
  const c = useChamp(idImpose, { aide, erreur });
  return (
    <Cadre {...c} libelle={libelle} aide={aide} erreur={erreur} requis={requis}>
      <input
        {...reste}
        {...c.controle}
        required={requis}
        className={`ds-controle${className ? ` ${className}` : ''}`}
      />
    </Cadre>
  );
}

export function Textarea({
  libelle,
  aide,
  erreur,
  requis,
  id: idImpose,
  className,
  ...reste
}: ProprietesChamp & ComponentPropsWithoutRef<'textarea'>) {
  const c = useChamp(idImpose, { aide, erreur });
  return (
    <Cadre {...c} libelle={libelle} aide={aide} erreur={erreur} requis={requis}>
      <textarea
        {...reste}
        {...c.controle}
        required={requis}
        className={`ds-controle ds-controle--texte${className ? ` ${className}` : ''}`}
      />
    </Cadre>
  );
}

/** Une option d'un `Select`. */
export interface OptionChoix {
  valeur: string;
  libelle: string;
  desactive?: boolean;
}

export function Select({
  libelle,
  aide,
  erreur,
  requis,
  options,
  id: idImpose,
  className,
  ...reste
}: ProprietesChamp & { options: readonly OptionChoix[] } & Omit<
    ComponentPropsWithoutRef<'select'>,
    'children'
  >) {
  const c = useChamp(idImpose, { aide, erreur });
  return (
    <Cadre {...c} libelle={libelle} aide={aide} erreur={erreur} requis={requis}>
      {/* L'enveloppe porte le chevron : un `<select>` n'a pas de pseudo-élément. */}
      <span className="ds-choix">
        <select
          {...reste}
          {...c.controle}
          required={requis}
          className={`ds-controle ds-controle--choix${className ? ` ${className}` : ''}`}
        >
          {options.map((o) => (
            <option key={o.valeur} value={o.valeur} disabled={o.desactive}>
              {o.libelle}
            </option>
          ))}
        </select>
      </span>
    </Cadre>
  );
}

/**
 * Un GROUPE de champs qui répondent à une même question (des cases à cocher,
 * des boutons radio, une adresse en trois parties). `<fieldset>` + `<legend>` :
 * le lecteur d'écran annonce la question en entrant dans le groupe — sans eux,
 * chaque case se lit seule, « Oui », « Non », sans qu'on sache à quoi.
 */
export function Fieldset({
  legende,
  aide,
  erreur,
  children,
}: {
  legende: ReactNode;
  aide?: ReactNode;
  erreur?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  const idAide = `${id}-aide`;
  const idErreur = `${id}-erreur`;
  const decrit = [aide ? idAide : null, erreur ? idErreur : null].filter(Boolean).join(' ');
  return (
    <fieldset
      className={`ds-groupe${erreur ? ' ds-champ--erreur' : ''}`}
      aria-describedby={decrit === '' ? undefined : decrit}
    >
      <legend className="ds-champ-libelle">{legende}</legend>
      {children}
      <AideEtErreur idAide={idAide} idErreur={idErreur} aide={aide} erreur={erreur} />
    </fieldset>
  );
}

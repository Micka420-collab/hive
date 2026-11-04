// Les icônes de Hive Studio — un seul trait (1,75), une seule grille (24), sans emoji.
//
// Toujours décoratives (`aria-hidden`) : le sens est porté par le libellé ou
// l'`aria-label` du bouton qui les contient, jamais par le dessin seul.

const TRACES = {
  accueil: <path d="M4 10.6 12 4l8 6.6V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1v-8.4Z" />,
  projets: (
    <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4.2l1.8 2H19a1.5 1.5 0 0 1 1.5 1.5V17A1.5 1.5 0 0 1 19 18.5H5A1.5 1.5 0 0 1 3.5 17V7.5Z" />
  ),
  missions: (
    <>
      <path d="M12 3.5 20 8l-8 4.5L4 8l8-4.5Z" />
      <path d="m4 12 8 4.5 8-4.5" />
      <path d="m4 16 8 4.5 8-4.5" />
    </>
  ),
  agents: (
    <>
      <rect x="5" y="8" width="14" height="11" rx="3" />
      <path d="M12 8V5M9.5 13h.01M14.5 13h.01M9.5 16.2h5" />
      <circle cx="12" cy="4.2" r="1" />
    </>
  ),
  equipe: (
    <>
      <circle cx="9" cy="9" r="3" />
      <path d="M3.5 19c.9-3 3-4.5 5.5-4.5s4.6 1.5 5.5 4.5" />
      <path d="M15.5 6.4a2.8 2.8 0 0 1 0 5.2M17 14.8c1.7.5 2.9 1.9 3.5 4.2" />
    </>
  ),
  automatisations: (
    <>
      <circle cx="6.5" cy="6.5" r="2.2" />
      <circle cx="17.5" cy="17.5" r="2.2" />
      <path d="M8.7 6.5H14a3 3 0 0 1 3 3v5.8M6.5 8.7v5.8a3 3 0 0 0 3 3h5.8" />
    </>
  ),
  marketplace: (
    <>
      <path d="M4 9.5 5.5 5h13L20 9.5" />
      <path d="M4 9.5h16v1a2.7 2.7 0 0 1-5.3 0 2.7 2.7 0 0 1-5.4 0 2.7 2.7 0 0 1-5.3 0v-1Z" />
      <path d="M5.5 13v6.5h13V13M10 19.5V16h4v3.5" />
    </>
  ),
  recherche: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  cloche: (
    <>
      <path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5l1.5-1.5Z" />
      <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
    </>
  ),
  aide: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.8M12 16.8h.01" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  envoyer: <path d="M5 12 19.5 5 15 19.5l-3.2-6.3L5 12Z" />,
  trombone: (
    <path d="m19 11.5-6.7 6.7a4.5 4.5 0 0 1-6.4-6.4l7.4-7.4a3 3 0 0 1 4.2 4.2l-7.3 7.3a1.5 1.5 0 0 1-2.1-2.1l6.6-6.6" />
  ),
  micro: (
    <>
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M6 11.5a6 6 0 0 0 12 0M12 17.5v3" />
    </>
  ),
  arret: <rect x="6.5" y="6.5" width="11" height="11" rx="2" />,
  chevronBas: <path d="m7 10 5 5 5-5" />,
  chevronDroite: <path d="m10 7 5 5-5 5" />,
  chevronGauche: <path d="m14 7-5 5 5 5" />,
  panneauDroit: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M14.5 4.5v15" />
    </>
  ),
  panneauGauche: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M9.5 4.5v15" />
    </>
  ),
  agrandir: <path d="M14 4.5h5.5V10M10 19.5H4.5V14M19.5 4.5 13.5 10.5M4.5 19.5l6-6" />,
  reduire: <path d="M19.5 9.5H14.5V4.5M4.5 14.5h5v5M14.5 9.5l5-5M9.5 14.5l-5 5" />,
  reglages: (
    <>
      <circle cx="12" cy="12" r="2.8" />
      <path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6" />
    </>
  ),
  etoile: <path d="m12 4 2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6L12 4Z" />,
  coche: <path d="m5 12.5 4.3 4.3L19 7.5" />,
  croix: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  horloge: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  eclair: <path d="M13 3.5 5.5 13.5H12l-1 7 7.5-10H12l1-7Z" />,
  etincelles: (
    <>
      <path d="M10 4.5 11.4 9 16 10.4 11.4 11.8 10 16.3 8.6 11.8 4 10.4 8.6 9 10 4.5Z" />
      <path d="M17.5 14.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z" />
    </>
  ),
  code: <path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4M13.5 5.5l-3 13" />,
  fichier: (
    <>
      <path d="M6.5 3.5h7l4 4V20a.5.5 0 0 1-.5.5H6.5A.5.5 0 0 1 6 20V4a.5.5 0 0 1 .5-.5Z" />
      <path d="M13.5 3.5V8h4" />
    </>
  ),
  dossier: (
    <path d="M3.5 7A1.5 1.5 0 0 1 5 5.5h4l2 2h8A1.5 1.5 0 0 1 20.5 9v8.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5V7Z" />
  ),
  plan: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="m3.5 6 1.2 1.2L7 5M3.5 12l1.2 1.2L7 11" />
      <circle cx="5" cy="18" r="1.3" />
    </>
  ),
  bulle: (
    <path d="M4.5 6.5A2 2 0 0 1 6.5 4.5h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H11l-4.5 3.5V16.5h0a2 2 0 0 1-2-2v-8Z" />
  ),
  resultats: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 15.5V12M12 15.5V8.5M16 15.5v-5" />
    </>
  ),
  activite: <path d="M3.5 12h4l2-5 4 10 2-5h5" />,
  invitation: (
    <>
      <circle cx="9.5" cy="8.5" r="3.2" />
      <path d="M3.5 19c1-3.2 3.3-4.8 6-4.8 1.3 0 2.5.3 3.5 1M17.5 13.5v6M14.5 16.5h6" />
    </>
  ),
  machine: (
    <>
      <rect x="3.5" y="4.5" width="17" height="11.5" rx="1.5" />
      <path d="M8.5 20h7M12 16v4" />
    </>
  ),
  lien: (
    <path d="M10 14a3.5 3.5 0 0 0 5 0l3.5-3.5a3.5 3.5 0 0 0-5-5L12.4 6.6M14 10a3.5 3.5 0 0 0-5 0l-3.5 3.5a3.5 3.5 0 0 0 5 5l1.1-1.1" />
  ),
  menu: <path d="M4.5 7h15M4.5 12h15M4.5 17h15" />,
  plusPoints: (
    <>
      <circle cx="6" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="18" cy="12" r="1.2" />
    </>
  ),
  fleche: <path d="M5 12h14M13 6l6 6-6 6" />,
  compte: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c.9-3.6 3.6-5.5 7-5.5s6.1 1.9 7 5.5" />
    </>
  ),
  sortir: (
    <>
      <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
      <path d="M14 8l4 4-4 4M18 12H9" />
    </>
  ),
  avertissement: (
    <>
      <path d="M12 4 21 19.5H3L12 4Z" />
      <path d="M12 10v4.5M12 17.3h.01" />
    </>
  ),
  deconnecte: (
    <>
      <path d="M4 4l16 16" />
      <path d="M8.5 16.5a5 5 0 0 1 6.6-.4M5.3 13a9 9 0 0 1 4.2-2.3M14.4 10.8A9 9 0 0 1 18.7 13M2 9.5a13 13 0 0 1 4.3-2.6M11 6.5a13 13 0 0 1 11 3" />
    </>
  ),
  diff: (
    <>
      <path d="M6 4v10M6 18.5v1.5M18 4v1.5M18 10v10" />
      <circle cx="6" cy="16.3" r="2.2" />
      <circle cx="18" cy="7.7" r="2.2" />
    </>
  ),
  ruche: <path d="M12 3.2 19.5 7.5v9L12 20.8 4.5 16.5v-9L12 3.2Z" />,
} as const;

export type NomIcone = keyof typeof TRACES;

export function Icone({ nom, taille = 20 }: { nom: NomIcone; taille?: number }) {
  return (
    <svg
      className="hs-icone"
      width={taille}
      height={taille}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {TRACES[nom]}
    </svg>
  );
}

/** La marque Hive Studio : l'alvéole, un H, le cuivre. */
export function MarqueHive({ taille = 36 }: { taille?: number }) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="hs-marque-degrade" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffb25b" />
          <stop offset="1" stopColor="#e2701f" />
        </linearGradient>
      </defs>
      <path
        d="M20 2.6 35.1 11.3v17.4L20 37.4 4.9 28.7V11.3L20 2.6Z"
        fill="none"
        stroke="url(#hs-marque-degrade)"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path
        d="M14.2 12.5v15M25.8 12.5v15M14.2 20h11.6"
        stroke="url(#hs-marque-degrade)"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

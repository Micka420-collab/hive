// L'accueil de l'app : démarrage, reprise d'une ruche existante, erreur.
// Il ne sait rien faire seul — il affiche l'état que le processus principal
// lui pousse (`hiveAccueil.surEtat`) et lui renvoie les choix de la personne.
'use strict';

const $ = (id) => document.getElementById(id);
const api = window.hiveAccueil;

function montrer(section) {
  for (const id of ['demarrage', 'reprise', 'amie', 'erreur']) $(id).hidden = id !== section;
}

/** La ruche amie (la porte) : proposée, en train d'entrer, en ligne, ou tombée. */
function rendreAmie(a, reineEnLigne) {
  montrer('amie');
  $('amie-label').textContent = a.label;
  $('amie-url').textContent = a.url;
  const titres = {
    proposee: 'Rejoindre une ruche ?',
    'en-cours': 'Entrée dans la ruche…',
    'en-ligne': 'Vous butinez pour cette ruche',
    arretee: 'L’ouvrière s’est arrêtée',
  };
  $('sous-titre').textContent = titres[a.etat] || '';
  const etat = $('amie-etat');
  etat.hidden = a.etat === 'proposee';
  etat.className = 'amie-etat ' + a.etat;
  etat.textContent =
    a.etat === 'en-cours'
      ? 'Échange du billet, détection de votre agent, première connexion… une minute au plus.'
      : a.etat === 'en-ligne'
        ? 'Votre ordinateur travaille pour « ' +
          a.label +
          ' ». Vous pouvez fermer cette fenêtre : l’ouvrière continue tant que Hive est ouvert.'
        : a.etat === 'arretee'
          ? (a.detail || 'Sans un mot.').replace(/^✘\s*/, '')
          : '';
  $('amie-rejoindre').hidden = a.etat !== 'proposee';
  $('amie-refuser').hidden = a.etat !== 'proposee';
  $('amie-rejoindre').disabled = false;
  $('amie-quitter').hidden = a.etat === 'proposee';
  $('amie-quitter').textContent = a.etat === 'arretee' ? 'Fermer' : 'Quitter cette ruche';
  $('amie-ecran').hidden = !reineEnLigne || a.etat === 'proposee';
}

function rendre(e) {
  if (!e) return;
  $('session').checked = e.session === true;

  if (e.amie && (e.amie.etat !== 'en-ligne' || !e.erreur)) {
    rendreAmie(e.amie, e.reine === 'en-ligne');
    if (e.amie.etat !== 'en-ligne') return;
  }

  if (e.erreur) {
    montrer('erreur');
    $('sous-titre').textContent = 'La ruche est arrêtée';
    $('erreur-titre').textContent = e.erreur.titre;
    $('erreur-lignes').textContent = e.erreur.lignes.join('\n') || '(aucune ligne)';
    return;
  }

  if (e.reprise) {
    montrer('reprise');
    $('sous-titre').textContent = e.importEnCours ? 'Import en cours…' : 'Une ruche existe déjà';
    $('reprise-dossier').textContent = e.reprise.dossier;
    $('choix-ouvrir').disabled = !e.reprise.repond || e.importEnCours;
    $('choix-ouvrir-detail').textContent = e.reprise.repond
      ? `Sa Reine répond sur le port ${e.reprise.port} : l’app l’affiche sans rien lancer.`
      : `Sa Reine ne répond pas (port ${e.reprise.port}) : lancez-la d’abord, ou importez une copie.`;
    $('choix-importer').disabled = e.importEnCours;
    $('choix-neuve').disabled = e.importEnCours;
    return;
  }

  montrer('demarrage');
  const libelles = {
    demarrage: 'La ruche démarre…',
    relance: 'La Reine redémarre…',
    'en-ligne': 'La Reine est en ligne',
    arretee: 'La ruche est arrêtée',
    externe: 'Ouverture de la ruche…',
  };
  $('sous-titre').textContent = libelles[e.reine] || '';
  $('etape-reine').textContent =
    e.reine === 'en-ligne' ? 'La Reine est en ligne' : 'La Reine démarre…';
  $('etape-reine').className = e.reine === 'en-ligne' ? 'faite' : 'en-cours';

  const liste = $('agents');
  liste.replaceChildren();
  if (e.agents === null) {
    $('etape-agents').className = 'en-cours';
  } else {
    $('etape-agents').className = 'faite';
    const connectes = e.agents.filter((a) => a.nonConnecte === null).length;
    $('etape-agents').textContent =
      connectes === 0
        ? 'Aucun agent de code connecté'
        : `${connectes} agent${connectes > 1 ? 's' : ''} de code connecté${connectes > 1 ? 's' : ''}`;
    for (const a of e.agents) {
      const li = document.createElement('li');
      li.className = a.nonConnecte === null ? 'connecte' : 'non-connecte';
      const nom = document.createElement('strong');
      nom.textContent = a.libelle;
      const detail = document.createElement('span');
      detail.textContent =
        a.nonConnecte === null ? 'connecté — une ouvrière le fera travailler' : a.nonConnecte;
      li.append(nom, detail);
      liste.append(li);
    }
    $('note-simulation').hidden = connectes > 0;
  }
  // L'app ne quitte d'elle-même cet écran que s'il n'a rien à dire : sinon,
  // c'est ce bouton (et la détection se relance ici, pas dans la barre
  // système que certains bureaux cachent).
  $('ouvrir-ecran').hidden = e.reine !== 'en-ligne';
  $('detecter').hidden = e.agents === null || e.reine === 'demarrage' || e.reine === 'externe';
  $('note-port').hidden = e.portChange === null;
  if (e.portChange !== null) {
    $('note-port').textContent =
      `Le port habituel était occupé : la ruche écoute désormais sur ${e.portChange}. ` +
      'L’écran repart sans ses préférences locales (langue, thème).';
  }
}

$('session').addEventListener('change', (ev) => void api.poserSession(ev.target.checked));
$('choix-ouvrir').addEventListener('click', () => void api.choisir('ouvrir'));
$('choix-importer').addEventListener('click', () => void api.choisir('importer'));
$('choix-neuve').addEventListener('click', () => void api.choisir('neuve'));
$('reessayer').addEventListener('click', () => void api.reessayer());
$('amie-rejoindre').addEventListener('click', () => {
  $('amie-rejoindre').disabled = true;
  void api.amie('rejoindre');
});
$('amie-refuser').addEventListener('click', () => void api.amie('refuser'));
$('amie-quitter').addEventListener('click', () => void api.amie('quitter'));
$('amie-ecran').addEventListener('click', () => void api.ouvrirEcran());
$('detecter').addEventListener('click', () => void api.reessayer());
$('ouvrir-ecran').addEventListener('click', () => void api.ouvrirEcran());
$('journaux').addEventListener('click', () => void api.ouvrirJournaux());

api.surEtat(rendre);
void api.etat().then(rendre);

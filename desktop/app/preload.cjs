// LE PRÉCHARGEMENT DE LA FENÊTRE — un seul fichier, deux pages.
//
// La fenêtre de l'app montre tour à tour l'ACCUEIL local (démarrage, reprise,
// erreur) et l'ÉCRAN de la Reine. Un préchargement est fixé à la création
// d'une fenêtre : il n'y en a donc qu'un, qui se règle sur la page où il
// tombe. Le processus principal, lui, revérifie l'origine de CHAQUE appel
// (`senderFrame.url`) : ce fichier n'est pas une frontière de sécurité, il en
// est le premier filtre.
//
// Sandboxé, sans `nodeIntegration` : seuls `contextBridge` et `ipcRenderer`.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'bureau:') {
  // ─── L'ACCUEIL ─────────────────────────────────────────────────────────────
  contextBridge.exposeInMainWorld('hiveAccueil', {
    etat: () => ipcRenderer.invoke('hive:accueil:etat'),
    choisir: (choix) => ipcRenderer.invoke('hive:accueil:choix', String(choix)),
    reessayer: () => ipcRenderer.invoke('hive:accueil:reessayer'),
    ouvrirJournaux: () => ipcRenderer.invoke('hive:accueil:journaux'),
    poserSession: (actif) => ipcRenderer.invoke('hive:accueil:session', actif === true),
    surEtat: (rappel) => {
      ipcRenderer.on('hive:accueil:maj', (_evenement, e) => rappel(e));
    },
  });
} else {
  // ─── L'ÉCRAN DE LA REINE ─────────────────────────────────────────────────
  //
  // Le jeton de la ruche va dans `localStorage['hive.token']` — là où l'écran
  // le lit (AGENTS.md) — AVANT que la page ne s'exécute : l'écran s'ouvre
  // connecté, sans qu'on tape rien. Le processus principal ne le rend qu'à
  // l'origine de SA Reine.
  const info = ipcRenderer.sendSync('hive:ecran');
  if (info && typeof info.jeton === 'string') {
    try {
      if (localStorage.getItem('hive.token') !== info.jeton) {
        localStorage.setItem('hive.token', info.jeton);
      }
    } catch {
      // Stockage refusé : l'écran demandera le jeton, comme dans un navigateur.
    }
    contextBridge.exposeInMainWorld('hiveBureau', { version: info.version, pose: 'bureau' });
  }
  // Toute violation de la CSP est remontée : le banc de fumée en fait un échec.
  window.addEventListener('securitypolicyviolation', (e) => {
    ipcRenderer.send('hive:csp', `${e.violatedDirective} ${e.blockedURI}`.slice(0, 300));
  });
}

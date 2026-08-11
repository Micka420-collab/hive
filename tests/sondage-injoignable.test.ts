// @vitest-environment happy-dom
//
// LA RUCHE INJOIGNABLE NE PARLE PAS ANGLAIS TECHNIQUE
//
// ─── LE DÉFAUT, ET COMMENT IL A ÉTÉ TROUVÉ ───────────────────────────────────
//
// En rendant CHAQUE vue sur une ruche vierge (sonde de mesure, jetée depuis),
// le Waggle Board d'Essaim a affiché ceci, à l'écran, dans une interface
// française :
//
//     Failed to execute "fetch()" on "Window" with URL …
//
// La phrase ne vient pas du dépôt : c'est le NAVIGATEUR qui la jette quand le
// `fetch` n'aboutit pas. `useApiPoll` la rangeait telle quelle (`e.message`) et
// vingt-cinq endroits du tableau de bord rendent `poll.error` sans le relire.
//
// Ce n'est pas un cas de laboratoire : pour une ruche AUTO-HÉBERGÉE, redémarrer
// son propre orchestrateur est le geste le plus banal qui soit, et pendant ces
// quelques secondes c'est exactement ce que voit l'utilisateur. Il ne peut pas
// savoir si sa ruche est morte, si son jeton a expiré, ou s'il a raté une
// étape — la phrase ne dit RIEN à faire.
//
// ─── CE QUE CE BANC GARDE, ET CE QU'IL LAISSE PASSER ─────────────────────────
//
// Il garde le TRI, pas la formulation :
//
//   · panne de transport (`TypeError`, ce que `fetch` rejette par
//     spécification) → une phrase française qui nomme la cause probable ;
//   · refus du serveur (`ApiError`) → SON message, intact : il vient du corps
//     JSON, il est écrit pour un humain, et il nomme souvent le remède ;
//   · toute autre panne → son message d'origine, intact. Un corps JSON
//     illisible jette un `SyntaxError` : la ruche A répondu, et prétendre le
//     contraire enverrait chercher la panne au mauvais endroit.
//
// La troisième branche est celle qu'on oublie en « traduisant tout », et c'est
// pour ça qu'elle a son banc : une correction qui ment sur les cas voisins
// déplace le défaut, elle ne le ferme pas.

import { describe, expect, it } from 'vitest';
import { setLang } from '../dashboard/src/i18n.js';
import { messageDeSondage } from '../dashboard/src/views/sondage.js';

describe('un sondage qui échoue — ce que l’écran a le droit de dire', () => {
  it('une ruche INJOIGNABLE se dit en français, pas en anglais de navigateur', () => {
    setLang('fr');
    // Ce que jette un navigateur quand l'orchestrateur est arrêté : la
    // spécification de `fetch` impose un `TypeError` sur échec de transport.
    const msg = messageDeSondage(new TypeError('Failed to fetch'));
    expect(msg, 'le message brut du navigateur a fui à l’écran').not.toContain('Failed to fetch');
    expect(msg, 'la cause probable n’est pas nommée').toContain('orchestrateur');
  });

  it('…et en anglais quand l’interface est en anglais', () => {
    setLang('en');
    const msg = messageDeSondage(new TypeError('Failed to fetch'));
    expect(msg).toContain('orchestrator');
    expect(msg).not.toContain('Failed to fetch');
    setLang('fr');
  });

  it('un REFUS du serveur garde SON message — il est déjà écrit pour un humain', () => {
    setLang('fr');
    // `api()` tire ce texte du corps JSON de la réponse. Le remplacer par « la
    // ruche n'a pas répondu » serait un mensonge : elle a répondu, et elle a
    // dit pourquoi.
    // `ApiError` (levée par `api()`) étend `Error` : ce qui est éprouvé ici est
    // la RÈGLE — tout ce qui n'est pas une panne de transport garde son texte.
    // On ne l'importe pas : tirer `api.ts` dans la suite Node ferait entrer un
    // module écrit pour la résolution du dashboard.
    const refus = Object.assign(new Error('Jeton de ruche invalide'), { status: 401 });
    const msg = messageDeSondage(refus);
    expect(msg).toBe('Jeton de ruche invalide');
  });

  it('une panne INCONNUE garde son message — on ne devine pas à sa place', () => {
    setLang('fr');
    // Un corps JSON illisible : la ruche a répondu, mal. Dire « elle n'a pas
    // répondu » enverrait chercher la panne du mauvais côté du fil.
    expect(messageDeSondage(new SyntaxError('Unexpected token < in JSON'))).toBe(
      'Unexpected token < in JSON',
    );
    // Et ce qui n'est même pas une erreur ne doit pas faire tomber l'écran. Une
    // valeur PRIMITIVE porte encore quelque chose de lisible : on la montre.
    expect(messageDeSondage('boum')).toBe('boum');
    expect(messageDeSondage(404)).toBe('404');
  });

  it('un OBJET NU ne fait jamais fuir « [object Object] » à l’écran', () => {
    // Débusqué par la loupe : `instanceof Error` muté en `instanceof Object`
    // SURVIVAIT, faute d'un banc passant un objet qui ne soit pas une Error.
    // Le mutant n'était pas équivalent — il changeait le sort de ce cas-ci.
    //
    // `String({})` rend « [object Object] » : du charabia, et le laisser passer
    // trahirait la raison d'être de cette fonction.
    setLang('fr');
    const msg = messageDeSondage({ code: 'ECONNRESET' });
    expect(msg, 'du charabia a fui à l’écran').not.toContain('[object Object]');
    expect(msg).toBe('Panne inattendue de la ruche.');

    setLang('en');
    expect(messageDeSondage({})).toBe('Unexpected hive failure.');
    setLang('fr');
  });
});

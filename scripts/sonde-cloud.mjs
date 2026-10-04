// UN CLIENT DE HIVE CLOUD, VU DE DERRIÈRE CADDY.
//
//     node scripts/sonde-cloud.mjs <acharnee|voisine> --ip <IP de Caddy> \
//       --domaine <nom servi> --ca <racine.crt> [--port 443]
//
// Lancée par `scripts/essai-conteneurs.mjs cloud`, chacune dans SON conteneur,
// sur le réseau de la ruche. Le jeton de ruche, quand il sert, arrive par
// l'environnement (`HIVE_TOKEN`), jamais en argument.
//
// ─── POURQUOI DEUX CONTENEURS, ET PAS DEUX REQUÊTES DEPUIS L'HÔTE ────────────
//
// La promesse à éprouver est celle de `HIVE_TRUST_PROXY=uniquelocal` : chaque
// client garde SON compteur anti-abus, alors que tous arrivent à la Reine par
// Caddy. Il faut donc deux clients qui ont deux ADRESSES. Depuis l'hôte, deux
// requêtes passeraient par la même porte publiée et arriveraient à Caddy avec
// la même IP : l'essai ne pourrait rien distinguer, et passerait quand même.
// Deux conteneurs sur le réseau de la ruche ont chacun la leur, comme deux
// clients sur Internet. La sonde tourne dans l'image de la ruche : Node et
// `ws` y sont déjà, et le seuil qu'elle éprouve est lu dans le code même de
// cette image (`dist/orchestrator/comptes.js`), pas recopié ici.
//
// ─── CE QU'ELLE AFFIRME ──────────────────────────────────────────────────────
//
//   acharnee : `/api/edition` répond `cloud` en HTTPS ; `ECHECS_IP`
//              connexions ratées rendent 401, chacune avec un
//              `X-Forwarded-For` FORGÉ différent, et la suivante rend 429.
//              Caddy a donc remplacé l'en-tête forgé : sinon chaque essai
//              aurait eu « son » IP, et le 429 ne serait jamais tombé.
//   voisine  : lancée APRÈS, une connexion ratée rend 401 et non 429 — son
//              compteur n'est pas celui de l'acharnée —, puis une montée
//              WebSocket par Caddy, avec l'origine du tableau de bord, reçoit
//              l'état de la ruche.
//
// ─── LA RÉSOLUTION DU NOM EST FORCÉE, ET C'EST VOULU ─────────────────────────
//
// On parle au NOM servi (SNI, `Host`, certificat vérifié contre la racine
// interne de Caddy), mais la connexion part vers l'IP donnée : `lookup` est
// remplacé. Aucun `/etc/hosts` à écrire, et aucune dépendance au sort que
// chaque résolveur réserve aux noms en `.localhost`.

import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as minuterie, clearTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const OK = 0;
const ECHEC = 1;
const MAL_APPELE = 64;

/** Une assertion de l'essai qui tombe : un verdict, pas une pile. */
export class SondeRatee extends Error {}

function rate(quoi) {
  throw new SondeRatee(quoi);
}

/**
 * Un `lookup` qui rend toujours la même adresse.
 *
 * Node l'appelle avec `{ all: true }` quand il essaie plusieurs familles
 * (`autoSelectFamily`, actif par défaut) : il attend alors une LISTE. Rendre
 * une adresse seule dans ce cas fait échouer la connexion sur un message sans
 * rapport — d'où les deux formes.
 */
export function versAdresse(ip) {
  const famille = ip.includes(':') ? 6 : 4;
  return (_nom, options, rappel) => {
    if (options?.all) rappel(null, [{ address: ip, family: famille }]);
    else rappel(null, ip, famille);
  };
}

/**
 * Une requête HTTP(S) vers la ruche, au nom servi et à l'adresse donnée.
 *
 * `agent: false` : une connexion par requête. Un agent partagé garderait la
 * connexion ouverte entre deux essais, et la sonde ne rendrait pas la main.
 */
export function requete(cible, { methode = 'GET', chemin, entetes = {}, corps } = {}) {
  const { protocole = 'https', ip, port = protocole === 'https' ? 443 : 80, domaine, ca } = cible;
  const donnees = corps === undefined ? undefined : JSON.stringify(corps);
  const module = protocole === 'https' ? https : http;
  return new Promise((resoudre, rejeter) => {
    const req = module.request(
      {
        host: domaine,
        port,
        method: methode,
        path: chemin,
        lookup: versAdresse(ip),
        agent: false,
        timeout: 15_000,
        ...(protocole === 'https' ? { ca, servername: domaine } : {}),
        headers: {
          ...entetes,
          ...(donnees === undefined
            ? {}
            : {
                'content-type': 'application/json',
                'content-length': String(Buffer.byteLength(donnees)),
              }),
        },
      },
      (res) => {
        let texte = '';
        res.setEncoding('utf8');
        res.on('data', (morceau) => {
          texte += morceau;
        });
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(texte);
          } catch {
            // Pas du JSON (une redirection, une page) : `texte` suffit.
          }
          resoudre({ statut: res.statusCode ?? 0, texte, json, entetes: res.headers });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('aucune réponse en 15 s')));
    // Un certificat refusé, une connexion coupée : un VERDICT lisible — « la
    // racine de Caddy ne signe pas ce qu'on reçoit » —, pas une pile TLS de
    // douze lignes qui fait d'abord soupçonner la sonde.
    req.on('error', (e) =>
      rejeter(
        new SondeRatee(
          `${protocole}://${domaine}:${port}${chemin} — ${e.message}${e.code ? ` (${e.code})` : ''}`,
        ),
      ),
    );
    req.end(donnees);
  });
}

/**
 * Le verdict de l'acharnée, sur la suite des statuts qu'elle a reçus.
 *
 * PUR : c'est ici que se décide ce que « le compteur par client tient » veut
 * dire, et c'est éprouvable sans conteneur. `seuil` est `ECHECS_IP` : les
 * `seuil` premiers essais ratés rendent 401, celui d'après 429.
 *
 * Un 429 AVANT le seuil n'est pas une réussite plus précoce : il dit qu'un
 * autre client a déjà rempli CE compteur — c'est-à-dire que la Reine range
 * plusieurs clients sous la même IP.
 */
export function jugerAcharnee(statuts, seuil) {
  if (statuts.length !== seuil + 1) {
    return `${statuts.length} essais pour un seuil de ${seuil} : il en faut ${seuil + 1}`;
  }
  const avant = statuts.slice(0, seuil);
  const premier429 = avant.indexOf(429);
  if (premier429 !== -1) {
    return (
      `429 dès l'essai ${premier429 + 1} sur ${seuil} : ce compteur était déjà entamé — ` +
      'la Reine range plusieurs clients sous la même adresse'
    );
  }
  const autre = avant.find((s) => s !== 401);
  if (autre !== undefined) return `une connexion ratée a rendu ${autre}, pas 401`;
  const dernier = statuts[seuil];
  if (dernier !== 429) {
    return (
      `l'essai ${seuil + 1} rend ${dernier}, pas 429 : le X-Forwarded-For forgé a donné une ` +
      'nouvelle adresse à chaque essai — Caddy ne l’a pas remplacé, ou la Reine le croit en direct'
    );
  }
  return null;
}

/** Une connexion ratée : un compte qui n'existe pas, un mot de passe quelconque. */
function connexionRatee(cible, numero, entetes = {}) {
  return requete(cible, {
    methode: 'POST',
    chemin: '/api/auth/login',
    entetes,
    // Une adresse DIFFÉRENTE à chaque essai : le verrou par compte (5 échecs)
    // ne doit pas mordre avant celui par IP, qui est l'objet de l'essai.
    corps: { email: `inconnue-${numero}@essai.test`, password: 'pas le bon mot de passe' },
  });
}

async function acharnee(cible) {
  const edition = await requete(cible, { chemin: '/api/edition' });
  if (edition.statut !== 200 || edition.json?.edition !== 'cloud') {
    rate(`/api/edition en HTTPS rend ${edition.statut} ${edition.texte.slice(0, 200)}`);
  }
  if (edition.json.factureHorlogeHote !== true) {
    rate('/api/edition ne dit pas que l’horloge de l’hébergeur facture');
  }
  console.log('✔ acharnée — /api/edition répond « cloud » en HTTPS, derrière Caddy');

  const { ECHECS_IP } = await import('../dist/orchestrator/comptes.js');
  const statuts = [];
  for (let i = 1; i <= ECHECS_IP + 1; i++) {
    // 198.51.100.0/24 : réservée à la documentation (RFC 5737), elle ne
    // désigne personne. Une adresse forgée NEUVE à chaque essai.
    const forge = { 'x-forwarded-for': `198.51.100.${i}` };
    statuts.push((await connexionRatee(cible, i, forge)).statut);
  }
  const verdict = jugerAcharnee(statuts, ECHECS_IP);
  if (verdict !== null) rate(`acharnée — ${verdict} (statuts : ${statuts.join(' ')})`);
  console.log(
    `✔ acharnée — ${ECHECS_IP} connexions ratées sous des X-Forwarded-For forgés rendent 401, ` +
      `la ${ECHECS_IP + 1}e rend 429 : l’en-tête forgé ne change pas d’adresse`,
  );
}

/** Monte en WebSocket par Caddy, s'abonne, et attend l'état de la ruche. */
function abonnement(cible, jeton) {
  const { ip, port = 443, domaine, ca } = cible;
  const suffixe = port === 443 ? '' : `:${port}`;
  const origine = `https://${domaine}${suffixe}`;
  return new Promise((resoudre, rejeter) => {
    const ws = new WebSocket(`wss://${domaine}${suffixe}/ws`, {
      ca,
      servername: domaine,
      lookup: versAdresse(ip),
      // L'origine du tableau de bord servi par ce domaine : c'est elle que
      // `HIVE_CORS_ORIGIN` doit admettre, sans quoi l'écran reçoit 4403.
      origin: origine,
      handshakeTimeout: 15_000,
    });
    const delai = minuterie(() => {
      ws.terminate();
      rejeter(new SondeRatee('WebSocket : aucun état reçu en 15 s après l’abonnement'));
    }, 15_000);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'subscribe', token: jeton })));
    ws.on('message', (brut) => {
      let message;
      try {
        message = JSON.parse(String(brut));
      } catch {
        return; // une trame illisible n'est pas l'état : on attend la suivante
      }
      if (message?.type !== 'state') return;
      clearTimeout(delai);
      ws.close(1000);
      resoudre();
    });
    ws.on('close', (code, raison) => {
      clearTimeout(delai);
      // Après un état reçu, `resoudre` a déjà tranché et ce rejet ne compte pas.
      rejeter(new SondeRatee(`WebSocket fermée avant l’état : ${code} ${String(raison)}`));
    });
    ws.on('error', (e) => {
      clearTimeout(delai);
      rejeter(new SondeRatee(`WebSocket : ${e.message}`));
    });
  });
}

async function voisine(cible, jeton) {
  const essai = await connexionRatee(cible, 'voisine');
  if (essai.statut === 429) {
    rate(
      'voisine — sa PREMIÈRE connexion ratée rend 429 : elle partage le compteur de l’acharnée, ' +
        'la Reine voit l’IP de Caddy pour tout le monde (HIVE_TRUST_PROXY ?)',
    );
  }
  if (essai.statut !== 401) rate(`voisine — une connexion ratée rend ${essai.statut}, pas 401`);
  console.log('✔ voisine — sa connexion ratée rend 401 : son compteur est le sien');

  if (!jeton) rate('voisine — HIVE_TOKEN absent de l’environnement : pas d’abonnement possible');
  await abonnement(cible, jeton);
  console.log('✔ voisine — la montée WebSocket passe par Caddy, et l’état de la ruche arrive');
}

/** `--nom valeur` → { nom: valeur } ; le premier mot nu est le rôle. */
export function lireArguments(argv) {
  const options = {};
  let role = null;
  for (let i = 0; i < argv.length; i++) {
    const mot = argv[i];
    if (mot.startsWith('--')) {
      options[mot.slice(2)] = argv[i + 1];
      i++;
    } else if (role === null) {
      role = mot;
    }
  }
  return { role, options };
}

async function principal(argv) {
  const { role, options } = lireArguments(argv);
  if (!['acharnee', 'voisine'].includes(role) || !options.ip || !options.domaine || !options.ca) {
    console.error(
      'usage : node scripts/sonde-cloud.mjs <acharnee|voisine> --ip <IP> --domaine <nom> --ca <racine.crt> [--port 443]',
    );
    return MAL_APPELE;
  }
  const cible = {
    ip: options.ip,
    domaine: options.domaine,
    port: options.port === undefined ? 443 : Number(options.port),
    ca: readFileSync(options.ca),
  };
  if (role === 'acharnee') await acharnee(cible);
  else await voisine(cible, process.env.HIVE_TOKEN ?? '');
  return OK;
}

// ─── LA GARDE DU POINT D'ENTRÉE ──────────────────────────────────────────────
//
// L'essai IMPORTE ce fichier (pour `requete`), et un banc aussi (pour
// `jugerAcharnee`) : un import ne doit rien lancer. Même garde que
// `compte-tests.mjs`.
const MOI = fileURLToPath(import.meta.url);
const LANCE = process.argv[1] === undefined ? '' : path.resolve(process.argv[1]);
if (MOI === LANCE) {
  try {
    process.exitCode = await principal(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof SondeRatee)) throw e;
    console.error(`✘ ${e.message}`);
    process.exitCode = ECHEC;
  }
}

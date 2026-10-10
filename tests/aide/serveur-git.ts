// Un serveur HTTP Git RÉEL pour les bancs — `git http-backend`, le CGI livré
// avec git — sur la boucle locale.
//
// Né dans `workflow-git.test.ts` (identifiants refusés, transfert coupé), sorti
// ici quand un second banc en a eu besoin : `clone-sans-identifiants.test.ts`
// éprouve un dépôt PRIVÉ qui exige le compte du projet, lecture et poussée.
// Une seule copie de la colle CGI, pour qu'une correction serve aux deux.
//
// Aucun octet ne sort de la machine : un banc qui dépend d'un tiers pour savoir
// quand il finit mesure le tiers, pas le code (docs/ERREURS.md).

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type ModeServeur = 'normal' | 'coupe' | 'identifiants' | 'prive';

/** Octets du pack servis avant de couper la connexion, en mode `coupe`. */
export const COUPURE_OCTETS = 8 * 1024;

/** Le premier paquet de données d'un pack : canal 1, puis la signature `PACK`. */
const SIGNATURE_PACK = Buffer.from('\x01PACK', 'latin1');

/**
 * Les dépôts bare de `racineDepots`, servis en HTTP, avec à la demande :
 *
 *   · `identifiants` : tout est refusé en 401 Basic, comme un dépôt privé
 *     dont on n'a pas la clé ;
 *   · `prive` : seul `compte` passe (Basic) — et lui seul peut POUSSER :
 *     `http-backend` n'ouvre `receive-pack` qu'à une requête authentifiée
 *     (`REMOTE_USER`), sauf `lectureSeule`, qui fait du jeton un jeton de
 *     lecture (la poussée reçoit le 403 du CGI lui-même) ;
 *   · `coupe` : la réponse du pack est tranchée après `COUPURE_OCTETS`, et la
 *     connexion fermée — un réseau qui lâche en plein transfert.
 */
export class ServeurGit {
  mode: ModeServeur = 'normal';
  /** Requêtes reçues AVEC un en-tête `Authorization`, en mode `identifiants`. */
  authentifications = 0;
  /** Toutes les requêtes reçues, quel que soit le mode. */
  requetes = 0;
  /**
   * Les PACKS servis — un `clone` ou un `fetch` qui a reçu des objets ; un
   * `ls-remote`, une négociation sans objet n'en comptent aucun. C'est le coût
   * que l'amont paie par tentative, que G18 (miroir du projet) doit faire
   * tomber à zéro dès la seconde. Lu sur la RÉPONSE : le premier paquet de
   * données du canal 1 commence par la signature `PACK` (protocole 0 avec
   * `side-band-64k`, comme protocole 2).
   */
  packsServis = 0;
  /**
   * Retient chaque pack ce nombre de millisecondes avant son premier octet :
   * un amont lent, dont chaque transfert coûte — sans rien changer à ce que
   * le banc mesure du reste (`ls-remote`, négociation).
   */
  latencePackMs = 0;
  /**
   * Le seul compte que le mode `prive` accepte. Un banc qui change le mot de
   * passe en cours de route a RÉVOQUÉ l'ancien jeton.
   */
  compte = { utilisateur: 'marie', motDePasse: `jeton-${randomBytes(12).toString('hex')}` };
  lectureSeule = false;
  /**
   * Appelé à l'ARRIVÉE de chaque requête, avant toute réponse : le client git
   * — et son assistant de transport — attend encore, vivant. C'est le moment
   * où un banc peut regarder la table des processus (`/proc/<pid>/cmdline`).
   */
  pendantRequete: ((req: IncomingMessage) => void) | null = null;
  private port = 0;
  private readonly http = createHttpServer((req, res) => this.repondre(req, res));

  constructor(private readonly racineDepots: string) {}

  async demarrer(): Promise<void> {
    await new Promise<void>((pret) => this.http.listen(0, '127.0.0.1', () => pret()));
    this.port = (this.http.address() as AddressInfo).port;
  }

  url(nom: string): string {
    return `http://127.0.0.1:${this.port}/${nom}.git`;
  }

  /**
   * L'adresse avec le compte écrit DEDANS — la forme qu'un dépôt privé a dans
   * la ruche. Un mot de passe vide donne la forme de GitHub, le jeton à la
   * place du nom (`http://<jeton>@…`).
   */
  urlAvecCompte(nom: string, motDePasse = this.compte.motDePasse): string {
    const userinfo =
      motDePasse === '' ? this.compte.utilisateur : `${this.compte.utilisateur}:${motDePasse}`;
    return this.url(nom).replace('http://', `http://${userinfo}@`);
  }

  async fermer(): Promise<void> {
    this.http.closeAllConnections();
    await new Promise<void>((fin) => this.http.close(() => fin()));
  }

  private repondre(req: IncomingMessage, res: ServerResponse): void {
    this.requetes += 1;
    this.pendantRequete?.(req);
    if (this.mode === 'identifiants') {
      if (req.headers.authorization) this.authentifications += 1;
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="depot prive"' });
      res.end('identifiants requis');
      return;
    }
    const { utilisateur, motDePasse } = this.compte;
    const attendu = `Basic ${Buffer.from(`${utilisateur}:${motDePasse}`).toString('base64')}`;
    if (this.mode === 'prive' && req.headers.authorization !== attendu) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="depot prive"' });
      res.end('identifiants requis');
      return;
    }
    const authentifie = this.mode === 'prive' && !this.lectureSeule;
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const cgi = spawn('git', ['http-backend'], {
      windowsHide: true,
      env: {
        PATH: process.env.PATH,
        SYSTEMROOT: process.env.SYSTEMROOT,
        SYSTEMDRIVE: process.env.SYSTEMDRIVE,
        GIT_PROJECT_ROOT: this.racineDepots,
        GIT_HTTP_EXPORT_ALL: '1',
        REQUEST_METHOD: req.method ?? 'GET',
        PATH_INFO: url.pathname,
        QUERY_STRING: url.search.slice(1),
        CONTENT_TYPE: req.headers['content-type'] ?? '',
        ...(authentifie ? { REMOTE_USER: utilisateur } : {}),
        ...(req.headers['content-encoding']
          ? { HTTP_CONTENT_ENCODING: req.headers['content-encoding'] }
          : {}),
        ...(req.headers['git-protocol']
          ? { GIT_PROTOCOL: String(req.headers['git-protocol']) }
          : {}),
      },
    });
    cgi.on('error', () => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
    cgi.stdin.on('error', () => {}); // le CGI tué en mode `coupe` ne lit plus
    req.pipe(cgi.stdin);

    const couper = this.mode === 'coupe' && req.method === 'POST';
    let tampon = Buffer.alloc(0);
    let entetesEnvoyes = false;
    let envoyes = 0;
    // Les derniers octets du corps déjà vus : une signature à cheval sur deux
    // morceaux reste vue (`packsServis`).
    let vus: Buffer | null = Buffer.alloc(0);
    // Tout ce qui part au client passe par cette file, dans l'ordre d'arrivée :
    // la latence d'un pack (`latencePackMs`) y retient la suite, fin comprise.
    // Un geste qui échoue n'arrête pas la file : la fin de la réponse part
    // toujours, et aucun client ne reste pendu à un serveur de banc.
    let suite: Promise<void> = Promise.resolve();
    const ensuite = (geste: () => void | Promise<void>): void => {
      suite = suite.then(geste).catch(() => undefined);
    };
    const ecrire = (corps: Buffer): void => {
      if (res.destroyed) return;
      if (!couper) {
        res.write(corps);
        return;
      }
      res.write(corps.subarray(0, Math.max(0, COUPURE_OCTETS - envoyes)));
      envoyes += corps.length;
      if (envoyes >= COUPURE_OCTETS) {
        cgi.kill();
        res.destroy();
      }
    };
    cgi.stdout.on('data', (morceau: Buffer) => {
      let corps = morceau;
      if (!entetesEnvoyes) {
        tampon = Buffer.concat([tampon, morceau]);
        const fin = tampon.indexOf('\r\n\r\n');
        if (fin < 0) return;
        let statut = 200;
        const entetes: Record<string, string> = {};
        for (const ligne of tampon.subarray(0, fin).toString('latin1').split('\r\n')) {
          const deuxPoints = ligne.indexOf(':');
          const nom = ligne.slice(0, deuxPoints).trim();
          const valeur = ligne.slice(deuxPoints + 1).trim();
          if (nom.toLowerCase() === 'status') statut = Number.parseInt(valeur, 10);
          else entetes[nom] = valeur;
        }
        res.writeHead(statut, entetes);
        entetesEnvoyes = true;
        corps = tampon.subarray(fin + 4);
      }
      if (vus !== null) {
        const fenetre = Buffer.concat([vus, corps]);
        if (!fenetre.includes(SIGNATURE_PACK)) {
          vus = fenetre.subarray(-SIGNATURE_PACK.length);
        } else {
          vus = null;
          this.packsServis += 1;
          const ms = this.latencePackMs;
          if (ms > 0) ensuite(() => new Promise<void>((fin) => setTimeout(fin, ms)));
        }
      }
      ensuite(() => ecrire(corps));
    });
    cgi.stdout.on('end', () =>
      ensuite(() => {
        if (!res.destroyed) res.end();
      }),
    );
  }
}

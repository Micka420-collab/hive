// Dashboard web temps réel pour Cyber Hive.
// Interface moderne : affichage en temps réel de l'attaque, des données trouvées,
// du statut anti-traçage, du score de défense, et du rapport téléchargeable.
// Sert une page HTML autonome + une API WebSocket pour le streaming temps réel.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import type { SessionPentest, EtapeAttaque } from './types.js';
import type { ContexteCible } from './autonomous-agent-v2.js';
import type { PostureSecurite } from './defense.js';
import type { ActionAntiForensic } from './anti-trace-v2.js';
import { parserCibleNaturelle } from './natural-language.js';
import { creerAnalyseurDefense } from './defense.js';
import { creerGenerateurRapport } from './report-generator.js';
import { creerGestionnaireAntiTraceV2 } from './anti-trace-v2.js';
import { lancerAgentEnrichi } from './autonomous-agent-v2.js';

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Types internes
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

interface ClientDash {
  ws: WebSocket;
  id: string;
}

interface EtatDashboard {
  session: SessionPentest | null;
  contexte: ContexteCible | null;
  posture: PostureSecurite | null;
  actionsAntiTrace: ActionAntiForensic[];
  statut: 'idle' | 'parsing' | 'attacking' | 'analyzing' | 'done' | 'error';
  log: string[];
}

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Serveur dashboard
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

export class ServeurDashboard {
  private serveurHttp: ReturnType<typeof createServer>;
  private wss: WebSocketServer;
  private clients: Map<string, ClientDash> = new Map();
  private etat: EtatDashboard;
  private port: number;
  private analyseur: ReturnType<typeof creerAnalyseurDefense>;
  private generateur: ReturnType<typeof creerGenerateurRapport>;

  constructor(port = 3000) {
    this.port = port;
    this.analyseur = creerAnalyseurDefense();
    this.generateur = creerGenerateurRapport();
    this.etat = {
      session: null,
      contexte: null,
      posture: null,
      actionsAntiTrace: [],
      statut: 'idle',
      log: [],
    };

    this.serveurHttp = createServer((req, res) => this.gererRequete(req, res));
    this.wss = new WebSocketServer({ server: this.serveurHttp });

    this.wss.on('connection', (ws) => {
      const id = randomUUID();
      this.clients.set(id, { ws, id });
      ws.send(JSON.stringify({ type: 'init', etat: this.serialiserEtat() }));
      ws.on('close', () => this.clients.delete(id));
      ws.on('message', (data) => this.gererMessage(ws, data.toString()));
    });
  }

  /** Démarre le serveur dashboard. */
  demarrer(): Promise<void> {
    return new Promise((resolve) => {
      this.serveurHttp.listen(this.port, () => {
        this.log(`Dashboard démarré sur http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  /** Arrête le serveur. */
  arreter(): void {
    for (const client of this.clients.values()) client.ws.close();
    this.wss.close();
    this.serveurHttp.close();
  }

  // ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
  //  Gestion des requêtes HTTP
  // ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

  private gererRequete(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? '/';

    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(this.genererHTML());
      return;
    }

    if (url === '/api/etat') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.serialiserEtat()));
      return;
    }

    if (url === '/api/rapport/markdown' && this.etat.session) {
      res.writeHead(200, { 'Content-Type': 'text/markdown', 'Content-Disposition': 'attachment; filename="rapport-pentest.md"' });
      res.end(this.generateur.genererMarkdown(this.construireRapport()));
      return;
    }

    if (url === '/api/rapport/html' && this.etat.session) {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Disposition': 'attachment; filename="rapport-pentest.html"' });
      res.end(this.generateur.genererHTML(this.construireRapport()));
      return;
    }

    if (url === '/api/rapport/json' && this.etat.session) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="rapport-pentest.json"' });
      res.end(this.generateur.genererJSON(this.construireRapport()));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  }

  // ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
  //  Gestion des messages WebSocket
  // ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

  private async gererMessage(ws: WebSocket, data: string): Promise<void> {
    try {
      const msg = JSON.parse(data);
      switch (msg.type) {
        case 'lancer-attaque':
          await this.lancerAttaque(msg.cible, ws);
          break;
        case 'reset':
          this.reset();
          break;
      }
    } catch (e) {
      ws.send(JSON.stringify({ type: 'erreur', message: String(e) }));
    }
  }

  // ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
  //  Lancement d'attaque
  // ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

  private async lancerAttaque(entree: string, ws: WebSocket): Promise<void> {
    this.setStatut('parsing');
    this.broadcast({ type: 'statut', statut: 'parsing' });

    // Parser la cible
    const resultat = parserCibleNaturelle(entree);
    this.log(`Cible parsée : ${resultat.explication} (confiance: ${resultat.confiance})`);
    this.broadcast({ type: 'parsing', resultat });

    // Créer la session
    const session: SessionPentest = {
      id: randomUUID(),
      nom: `Pentest ${resultat.cible.hote}`,
      cible: resultat.cible,
      statut: 'en_cours',
      etapes: [],
      creeeAt: Date.now(),
      antiTrace: {
        modeSimulation: true,
        rotationIdentite: true,
        tor: true,
        proxychains: true,
        nettoyageLogs: true,
        conteneursEphemeress: true,
      },
    };
    this.etat.session = session;
    this.broadcast({ type: 'session', session });

    // Anti-trace pré-attaque
    this.setStatut('attacking');
    this.log('Démarrage anti-traçage pré-attaque...');
    const antiTrace = creerGestionnaireAntiTraceV2({ modeSimulation: true, niveauParano: 'parano' });
    await antiTrace.executerSequenceComplete(session);
    this.etat.actionsAntiTrace = antiTrace.getActions();
    this.broadcast({ type: 'anti-trace', actions: this.etat.actionsAntiTrace });
    this.log(`${this.etat.actionsAntiTrace.length} actions anti-forensics exécutées.`);

    // Lancer l'agent autonome
    this.log('Démarrage du moteur d\'attaque autonome...');
    try {
      const { etapes, contexte } = await lancerAgentEnrichi(session, 'agent-dashboard', 25);
      this.etat.contexte = contexte;

      // Streamer chaque étape
      for (const etape of etapes) {
        this.broadcast({ type: 'etape', etape });
        this.log(`[${etape.severite}] ${etape.description}`);
      }

      // Analyse défense
      this.setStatut('analyzing');
      this.log('Analyse de la posture de sécurité...');
      this.etat.posture = this.analyseur.analyserSession(session);
      this.broadcast({ type: 'posture', posture: this.etat.posture });

      // Finaliser
      session.statut = 'terminee';
      session.termineeAt = Date.now();
      this.setStatut('done');
      this.log('Pentest terminé. Rapport disponible au téléchargement.');
      this.broadcast({ type: 'termine', session });
    } catch (e) {
      this.setStatut('error');
      this.log(`Erreur : ${String(e)}`);
      this.broadcast({ type: 'erreur', message: String(e) });
    }
  }

  // ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
  //  Helpers
  // ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

  private setStatut(statut: EtatDashboard['statut']): void {
    this.etat.statut = statut;
    this.broadcast({ type: 'statut', statut });
  }

  private log(message: string): void {
    const ligne = `[${new Date().toLocaleTimeString('fr-FR')}] ${message}`;
    this.etat.log.push(ligne);
    if (this.etat.log.length > 200) this.etat.log.shift();
    this.broadcast({ type: 'log', ligne });
  }

  private reset(): void {
    this.etat = { session: null, contexte: null, posture: null, actionsAntiTrace: [], statut: 'idle', log: [] };
    this.broadcast({ type: 'reset' });
  }

  private broadcast(msg: unknown): void {
    const data = JSON.stringify(msg);
    for (const client of this.clients.values()) {
      if (client.ws.readyState === 1) client.ws.send(data);
    }
  }

  private serialiserEtat(): unknown {
    return {
      statut: this.etat.statut,
      session: this.etat.session,
      contexte: this.etat.contexte,
      posture: this.etat.posture,
      actionsAntiTrace: this.etat.actionsAntiTrace,
      log: this.etat.log,
    };
  }

  private construireRapport() {
    return {
      session: this.etat.session!,
      contexte: this.etat.contexte ?? undefined,
      posture: this.etat.posture!,
      tracesAntiForensics: this.etat.actionsAntiTrace.map((a) => ({
        action: a.nom,
        description: a.description,
        statut: a.statut,
        timestamp: a.timestamp,
      })),
      dateGeneration: Date.now(),
    };
  }

  // ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
  //  Génération du HTML du dashboard
  // ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

  private genererHTML(): string {
    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Cyber Hive - Dashboard Pentest</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
:root {
  --bg: #0a0e1a; --bg-card: #131826; --bg-hover: #1a2033;
  --border: #2a3450; --text: #e2e8f0; --text-dim: #64748b;
  --accent: #38bdf8; --accent-dim: #0ea5e9;
  --green: #22c55e; --yellow: #eab308; --orange: #f97316; --red: #ef4444;
  --purple: #a855f7; --pink: #ec4899;
}
body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); height: 100vh; overflow: hidden; display: flex; flex-direction: column; }

/* Header */
.header { background: var(--bg-card); border-bottom: 1px solid var(--border); padding: 0.75rem 1.5rem; display: flex; align-items: center; justify-content: space-between; }
.header h1 { font-size: 1.25rem; background: linear-gradient(135deg, var(--accent), var(--purple)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.header .status { display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; color: var(--text-dim); }
.status-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--text-dim); }
.status-dot.active { background: var(--green); animation: pulse 2s infinite; }
.status-dot.attacking { background: var(--orange); animation: pulse 1s infinite; }
.status-dot.error { background: var(--red); }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

/* Layout */
.main { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1px; background: var(--border); flex: 1; overflow: hidden; }
.panel { background: var(--bg); padding: 1rem; overflow-y: auto; }
.panel-title { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-dim); margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.5rem; }

/* Input bar */
.input-bar { background: var(--bg-card); border-bottom: 1px solid var(--border); padding: 1rem 1.5rem; display: flex; gap: 0.75rem; }
.input-bar input { flex: 1; background: var(--bg); border: 1px solid var(--border); border-radius: 0.5rem; padding: 0.75rem 1rem; color: var(--text); font-size: 0.95rem; outline: none; transition: border-color 0.2s; }
.input-bar input:focus { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.1); }
.input-bar input::placeholder { color: var(--text-dim); }
.btn { padding: 0.75rem 1.5rem; border: none; border-radius: 0.5rem; font-weight: 600; cursor: pointer; transition: all 0.2s; font-size: 0.9rem; }
.btn-primary { background: var(--accent); color: var(--bg); }
.btn-primary:hover { background: var(--accent-dim); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary { background: var(--bg-hover); color: var(--text); border: 1px solid var(--border); }
.btn-secondary:hover { background: var(--border); }

/* Cards */
.card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 0.75rem; padding: 1rem; margin-bottom: 0.75rem; }
.card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
.card-title { font-size: 0.9rem; font-weight: 600; }

/* Score */
.score-display { text-align: center; padding: 1rem; }
.score-value { font-size: 3rem; font-weight: 800; }
.score-level { font-size: 1.5rem; font-weight: 700; padding: 0.25rem 1rem; border-radius: 0.5rem; display: inline-block; margin-top: 0.5rem; }

/* Timeline */
.timeline-item { padding: 0.75rem; border-left: 3px solid var(--border); margin-left: 0.5rem; margin-bottom: 0.5rem; position: relative; }
.timeline-item .ts { font-size: 0.75rem; color: var(--text-dim); }
.timeline-item .desc { font-size: 0.9rem; margin-top: 0.25rem; }
.timeline-item .reason { font-size: 0.8rem; color: var(--text-dim); margin-top: 0.25rem; }
.timeline-item.info { border-color: var(--accent); }
.timeline-item.remarque { border-color: var(--yellow); }
.timeline-item.avertissement { border-color: var(--orange); }
.timeline-item.critique { border-color: var(--red); }

/* Data table */
.data-table { width: 100%; border-collapse: collapse; }
.data-table th { text-align: left; font-size: 0.75rem; text-transform: uppercase; color: var(--text-dim); padding: 0.5rem; border-bottom: 1px solid var(--border); }
.data-table td { padding: 0.5rem; font-size: 0.85rem; border-bottom: 1px solid var(--border); }

/* Badge */
.badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 0.25rem; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; }
.badge.critique { background: var(--red); color: #fff; }
.badge.eleve { background: var(--orange); color: #fff; }
.badge.moyenne { background: var(--yellow); color: #000; }
.badge.faible { background: var(--green); color: #000; }
.badge.info { background: var(--accent); color: #000; }
.badge.simule { background: var(--purple); color: #fff; }
.badge.applique { background: var(--green); color: #000; }

/* Log */
.log-container { font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 0.8rem; }
.log-line { padding: 0.15rem 0; color: var(--text-dim); }
.log-line:last-child { color: var(--text); }

/* Anti-trace */
.anti-trace-item { display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0; border-bottom: 1px solid var(--border); font-size: 0.85rem; }

/* Download buttons */
.downloads { display: flex; gap: 0.5rem; flex-wrap: wrap; }

/* Scrollbar */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: var(--bg); }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--text-dim); }

/* Responsive */
@media (max-width: 1024px) { .main { grid-template-columns: 1fr; overflow-y: auto; } .panel { max-height: 500px; } }
</style>
</head>
<body>

<div class="header">
  <h1>⚡ Cyber Hive Dashboard</h1>
  <div class="status">
    <span class="status-dot" id="statusDot"></span>
    <span id="statusText">En attente</span>
  </div>
</div>

<div class="input-bar">
  <input type="text" id="cibleInput" placeholder="Entrez une cible : IP (192.168.1.1), URL (https://example.com), domaine, ou description libre..." />
  <button class="btn btn-primary" id="lancerBtn" onclick="lancerAttaque()">Lancer l'attaque</button>
  <button class="btn btn-secondary" onclick="reset()">Reset</button>
</div>

<div class="main">
  <!-- Colonne 1 : Timeline + Log -->
  <div class="panel">
    <div class="panel-title">📡 Timeline de l'attaque</div>
    <div id="timeline"></div>
    <div class="panel-title" style="margin-top: 1rem;">📋 Log</div>
    <div class="log-container" id="logContainer"></div>
  </div>

  <!-- Colonne 2 : Données trouvées -->
  <div class="panel">
    <div class="panel-title">🔍 Données trouvées</div>
    <div id="donnees"></div>
    <div class="panel-title" style="margin-top: 1rem;">🛡️ Anti-traçage</div>
    <div id="antiTrace"></div>
  </div>

  <!-- Colonne 3 : Défense + Rapport -->
  <div class="panel">
    <div class="panel-title">📊 Posture de sécurité</div>
    <div id="posture"></div>
    <div class="panel-title" style="margin-top: 1rem;">📥 Télécharger le rapport</div>
    <div class="downloads" id="downloads" style="display: none;">
      <a class="btn btn-secondary" href="/api/rapport/markdown" download>Markdown</a>
      <a class="btn btn-secondary" href="/api/rapport/html" download>HTML</a>
      <a class="btn btn-secondary" href="/api/rapport/json" download>JSON</a>
    </div>
  </div>
</div>

<script>
const ws = new WebSocket(\`ws://\${location.host}\`);
let statut = 'idle';

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  switch (msg.type) {
    case 'init': afficherEtat(msg.etat); break;
    case 'statut': majStatut(msg.statut); break;
    case 'parsing': afficherParsing(msg.resultat); break;
    case 'session': afficherSession(msg.session); break;
    case 'anti-trace': afficherAntiTrace(msg.actions); break;
    case 'etape': afficherEtape(msg.etape); break;
    case 'posture': afficherPosture(msg.posture); break;
    case 'log': ajouterLog(msg.ligne); break;
    case 'termine': majStatut('done'); document.getElementById('downloads').style.display = 'flex'; break;
    case 'erreur': majStatut('error'); ajouterLog('ERREUR: ' + msg.message); break;
    case 'reset': location.reload(); break;
  }
};

function lancerAttaque() {
  const cible = document.getElementById('cibleInput').value;
  if (!cible) return;
  ws.send(JSON.stringify({ type: 'lancer-attaque', cible }));
  document.getElementById('lancerBtn').disabled = true;
}

function reset() { ws.send(JSON.stringify({ type: 'reset' })); }

function majStatut(s) {
  statut = s;
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  dot.className = 'status-dot';
  if (s === 'attacking') dot.classList.add('attacking');
  else if (s === 'done') dot.classList.add('active');
  else if (s === 'error') dot.classList.add('error');
  const labels = { idle: 'En attente', parsing: 'Analyse de la cible...', attacking: 'Attaque en cours', analyzing: 'Analyse défense...', done: 'Terminé', error: 'Erreur' };
  text.textContent = labels[s] || s;
  if (s === 'done' || s === 'error') document.getElementById('lancerBtn').disabled = false;
}

function afficherEtat(etat) {
  if (etat.statut) majStatut(etat.statut);
  if (etat.log) etat.log.forEach(l => ajouterLog(l));
  if (etat.actionsAntiTrace) afficherAntiTrace(etat.actionsAntiTrace);
  if (etat.posture) afficherPosture(etat.posture);
}

function afficherParsing(r) {
  ajouterLog('Cible: ' + r.explication + ' (confiance: ' + Math.round(r.confiance * 100) + '%)');
  if (r.suggestions) r.suggestions.forEach(s => ajouterLog('Suggestion: ' + s));
}

function afficherSession(s) {
  ajouterLog('Session créée: ' + s.nom);
}

function afficherEtape(etape) {
  const tl = document.getElementById('timeline');
  const div = document.createElement('div');
  div.className = 'timeline-item ' + etape.severite;
  div.innerHTML = \`
    <div class="ts">\${new Date(etape.ts).toLocaleTimeString('fr-FR')} | \${etape.type}</div>
    <div class="desc">\${escapeHtml(etape.description)}</div>
    \${etape.explication ? '<div class="reason">' + escapeHtml(etape.explication) + '</div>' : ''}
    \${etape.commande ? '<div class="reason"><code>' + escapeHtml(etape.commande) + '</code></div>' : ''}
  \`;
  tl.appendChild(div);
  tl.scrollTop = tl.scrollHeight;
}

function afficherAntiTrace(actions) {
  const el = document.getElementById('antiTrace');
  el.innerHTML = actions.map(a => \`
    <div class="anti-trace-item">
      <span class="badge \${a.statut}">\${a.statut}</span>
      <span>\${escapeHtml(a.nom)}</span>
    </div>
  \`).join('');
}

function afficherPosture(p) {
  const el = document.getElementById('posture');
  const colors = { A: '#22c55e', B: '#84cc16', C: '#eab308', D: '#f97316', F: '#ef4444' };
  let html = '<div class="card"><div class="score-display">';
  html += '<div class="score-value" style="color:' + (colors[p.niveau] || '#fff') + '">' + p.score + '/100</div>';
  html += '<div class="score-level" style="background:' + (colors[p.niveau] || '#fff') + ';color:#0a0e1a">Niveau ' + p.niveau + '</div>';
  html += '</div></div>';

  if (p.faiblesses && p.faiblesses.length > 0) {
    html += '<div class="card"><div class="card-title">⚠️ Faiblesses</div>';
    p.faiblesses.forEach(f => html += '<div style="font-size:0.85rem;padding:0.25rem 0">• ' + escapeHtml(f) + '</div>');
    html += '</div>';
  }

  if (p.forces && p.forces.length > 0) {
    html += '<div class="card"><div class="card-title">✅ Points forts</div>';
    p.forces.forEach(f => html += '<div style="font-size:0.85rem;padding:0.25rem 0">• ' + escapeHtml(f) + '</div>');
    html += '</div>';
  }

  if (p.recommandations && p.recommandations.length > 0) {
    html += '<div class="card"><div class="card-title">🔧 Recommandations</div>';
    p.recommandations.forEach(r => {
      html += '<div style="margin-bottom:0.5rem"><span class="badge ' + r.severite + '">' + r.severite + '</span> <strong>' + escapeHtml(r.titre) + '</strong><br>';
      html += '<small style="color:#64748b">' + escapeHtml(r.correctif) + '</small></div>';
    });
    html += '</div>';
  }

  el.innerHTML = html;
}

function ajouterLog(ligne) {
  const el = document.getElementById('logContainer');
  const div = document.createElement('div');
  div.className = 'log-line';
  div.textContent = ligne;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

document.getElementById('cibleInput').addEventListener('keypress', (e) => { if (e.key === 'Enter') lancerAttaque(); });
</script>
</body>
</html>`;
  }
}

/** Crée et démarre un serveur dashboard. */
export async function demarrerDashboard(port?: number): Promise<ServeurDashboard> {
  const serveur = new ServeurDashboard(port);
  await serveur.demarrer();
  return serveur;
}
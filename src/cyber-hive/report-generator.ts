// Générateur de rapport complet pour Cyber Hive.
// Produit un rapport détaillé : données trouvées, méthodologie, traces, anti-forensics, recommandations.
// Formats : Markdown, JSON, HTML téléchargeable.

import type { SessionPentest, EtapeAttaque } from './types.js';
import type { PostureSecurite } from './defense.js';
import type { ContexteCible } from './autonomous-agent.js';

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Types
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

export interface RapportComplet {
  session: SessionPentest;
  contexte?: ContexteCible;
  posture: PostureSecurite;
  tracesAntiForensics: TraceAntiForensics[];
  dateGeneration: number;
}

export interface TraceAntiForensics {
  action: string;
  description: string;
  statut: 'applique' | 'echec' | 'simule';
  timestamp: number;
}

// ╌╌�╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Générateur
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

export class GenerateurRapport {
  /** Génère un rapport complet en Markdown. */
  genererMarkdown(rapport: RapportComplet): string {
    const { session, contexte, posture, tracesAntiForensics, dateGeneration } = rapport;
    const lignes: string[] = [];

    // En-tête
    lignes.push(`# Rapport de Pentest : ${session.nom}`);
    lignes.push(`\n**Date** : ${new Date(dateGeneration).toLocaleString('fr-FR')}`);
    lignes.push(`**Cible** : ${session.cible.hote}`);
    lignes.push(`**Statut** : ${session.statut}`);
    lignes.push(`**Durée** : ${posture.resume.includes('ms') ? '' : ''}${session.termineeAt ? session.termineeAt - session.creeeAt : Date.now() - session.creeeAt} ms`);
    lignes.push('');

    // Score de sécurité
    lignes.push('## Posture de sécurité');
    lignes.push(`\n**Score** : ${posture.score}/100 (Niveau ${posture.niveau})`);
    lignes.push(`\n${posture.resume}`);
    lignes.push('');

    // Données trouvées
    lignes.push('## Données trouvées');
    if (contexte) {
      lignes.push(`\n### Ports découverts (${contexte.portsOuverts.length})`);
      if (contexte.portsOuverts.length === 0) {
        lignes.push('Aucun port ouvert détecté.');
      } else {
        lignes.push('| Port | Protocole | État |');
        lignes.push('|------|-----------|------|');
        for (const p of contexte.portsOuverts) {
          lignes.push(`| ${p.port} | ${p.protocole} | ${p.etat} |`);
        }
      }

      lignes.push(`\n### Services détectés (${contexte.services.length})`);
      if (contexte.services.length === 0) {
        lignes.push('Aucun service détecté.');
      } else {
        lignes.push('| Port | Service | Version |');
        lignes.push('|------|---------|---------|');
        for (const s of contexte.services) {
          lignes.push(`| ${s.port} | ${s.service} | ${s.version} |`);
        }
      }

      lignes.push(`\n### Vulnérabilités (${contexte.vulnerabilites.length})`);
      if (contexte.vulnerabilites.length === 0) {
        lignes.push('Aucune vulnérabilité détectée.');
      } else {
        for (const v of contexte.vulnerabilites) {
          lignes.push(`- **[${v.severite.toUpperCase()}]** ${v.type} sur ${v.cible}`);
          lignes.push(`  - ${v.description}`);
        }
      }

      lignes.push(`\n### Credentials trouvés (${contexte.credentialsTrouves.length})`);
      if (contexte.credentialsTrouves.length === 0) {
        lignes.push('Aucun credential découvert.');
      } else {
        lignes.push('| Utilisateur | Mot de passe | Service |');
        lignes.push('|-------------|--------------|---------|');
        for (const c of contexte.credentialsTrouves) {
          lignes.push(`| ${c.utilisateur} | ${c.motDePasse} | ${c.service} |`);
        }
      }

      lignes.push(`\n### URLs découvertes (${contexte.urlsDecouvertes.length})`);
      for (const url of contexte.urlsDecouvertes) {
        lignes.push(`- ${url}`);
      }
    }
    lignes.push('');

    // Méthodologie (timeline)
    lignes.push('## Méthodologie (timeline)');
    for (const etape of session.etapes) {
      const icone = this.iconeSeverite(etape.severite);
      lignes.push(`\n### ${icone} ${etape.description}`);
      lignes.push(`- **Type** : ${etape.type}`);
      lignes.push(`- **Sévérité** : ${etape.severite}`);
      lignes.push(`- **Timestamp** : ${new Date(etape.ts).toLocaleString('fr-FR')}`);
      if (etape.commande) lignes.push(`- **Commande** : \`${etape.commande}\``);
      if (etape.explication) lignes.push(`- **Explication** : ${etape.explication}`);
      if (etape.resultat) {
        lignes.push(`- **Succès** : ${etape.resultat.succes ? 'Oui' : 'Non'}`);
        lignes.push(`- **Durée** : ${etape.resultat.dureeMs} ms`);
        if (etape.resultat.stdout) {
          const extrait = etape.resultat.stdout.split('\n').slice(0, 10).join('\n');
          lignes.push(`- **Sortie (extrait)** :`);
          lignes.push('```');
          lignes.push(extrait);
          lignes.push('```');
        }
      }
    }
    lignes.push('');

    // Anti-forensics
    lignes.push('## Anti-traçage et nettoyage des traces');
    if (tracesAntiForensics.length === 0) {
      lignes.push('\nAucune action anti-forensic enregistrée.');
    } else {
      lignes.push('\n| Action | Description | Statut | Timestamp |');
      lignes.push('|--------|-------------|--------|-----------|');
      for (const t of tracesAntiForensics) {
        lignes.push(`| ${t.action} | ${t.description} | ${t.statut} | ${new Date(t.timestamp).toLocaleString('fr-FR')} |`);
      }
    }
    lignes.push('');

    // Recommandations de défense
    lignes.push('## Recommandations de défense');
    if (posture.recommandations.length === 0) {
      lignes.push('\nAucune recommandation. La cible semble bien sécurisée.');
    } else {
      for (const reco of posture.recommandations) {
        lignes.push(`\n### [${reco.severite.toUpperCase()}] ${reco.titre}`);
        lignes.push(`- **Description** : ${reco.description}`);
        lignes.push(`- **Correctif** : ${reco.correctif}`);
        if (reco.cve) lignes.push(`- **CVE** : ${reco.cve}`);
        if (reco.cvss) lignes.push(`- **CVSS** : ${reco.cvss}`);
      }
    }
    lignes.push('');

    // Conclusion
    lignes.push('## Conclusion');
    lignes.push(`\n${this.genererConclusion(posture, contexte)}`);

    return lignes.join('\n');
  }

  /** Génère un rapport au format JSON. */
  genererJSON(rapport: RapportComplet): string {
    return JSON.stringify(rapport, null, 2);
  }

  /** Génère un rapport HTML autonome (téléchargeable). */
  genererHTML(rapport: RapportComplet): string {
    const { session, contexte, posture, tracesAntiForensics, dateGeneration } = rapport;
    const couleurNiveau: Record<string, string> = {
      A: '#22c55e', B: '#84cc16', C: '#eab308', D: '#f97316', F: '#ef4444',
    };
    const couleurSeverite: Record<string, string> = {
      critique: '#ef4444', eleve: '#f97316', moyenne: '#eab308', faible: '#84cc16',
    };

    let html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Rapport de Pentest : ${this.escapeHtml(session.nom)}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; line-height: 1.6; padding: 2rem; }
h1 { color: #f8fafc; font-size: 1.8rem; margin-bottom: 0.5rem; }
h2 { color: #38bdf8; font-size: 1.4rem; margin-top: 2rem; margin-bottom: 1rem; border-bottom: 1px solid #334155; padding-bottom: 0.5rem; }
h3 { color: #94a3b8; font-size: 1.1rem; margin-top: 1.5rem; margin-bottom: 0.5rem; }
.meta { color: #64748b; font-size: 0.9rem; margin-bottom: 1rem; }
.score-badge { display: inline-block; padding: 0.5rem 1.5rem; border-radius: 0.5rem; font-size: 1.5rem; font-weight: bold; color: #0f172a; }
table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
th { background: #1e293b; color: #38bdf8; padding: 0.75rem; text-align: left; font-size: 0.85rem; text-transform: uppercase; }
td { padding: 0.75rem; border-bottom: 1px solid #1e293b; font-size: 0.9rem; }
tr:hover { background: #1e293b; }
.severite { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 0.25rem; font-size: 0.75rem; font-weight: bold; text-transform: uppercase; }
.reco { background: #1e293b; border-left: 4px solid; padding: 1rem; margin: 1rem 0; border-radius: 0 0.5rem 0.5rem 0; }
.code { background: #1e293b; padding: 1rem; border-radius: 0.5rem; font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; overflow-x: auto; margin: 0.5rem 0; }
.conclusion { background: #1e293b; padding: 1.5rem; border-radius: 0.5rem; margin-top: 2rem; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin: 1rem 0; }
.card { background: #1e293b; padding: 1rem; border-radius: 0.5rem; text-align: center; }
.card .value { font-size: 2rem; font-weight: bold; color: #38bdf8; }
.card .label { color: #64748b; font-size: 0.85rem; }
</style>
</head>
<body>
<h1>Rapport de Pentest : ${this.escapeHtml(session.nom)}</h1>
<div class="meta">Généré le ${new Date(dateGeneration).toLocaleString('fr-FR')} | Cible : ${this.escapeHtml(session.cible.hote)} | Statut : ${session.statut}</div>

<div class="grid">
<div class="card"><div class="value" style="color: ${couleurNiveau[posture.niveau]}">${posture.niveau}</div><div class="label">Niveau de sécurité</div></div>
<div class="card"><div class="value">${posture.score}</div><div class="label">Score / 100</div></div>
<div class="card"><div class="value">${session.etapes.length}</div><div class="label">Étapes d'attaque</div></div>
<div class="card"><div class="value">${posture.recommandations.length}</div><div class="label">Recommandations</div></div>
</div>

<h2>Posture de sécurité</h2>
<p>${this.escapeHtml(posture.resume)}</p>

<h2>Données trouvées</h2>`;

    if (contexte) {
      if (contexte.portsOuverts.length > 0) {
        html += `<h3>Ports découverts (${contexte.portsOuverts.length})</h3><table><tr><th>Port</th><th>Protocole</th><th>État</th></tr>`;
        for (const p of contexte.portsOuverts) {
          html += `<tr><td>${p.port}</td><td>${p.protocole}</td><td>${p.etat}</td></tr>`;
        }
        html += '</table>';
      }

      if (contexte.services.length > 0) {
        html += `<h3>Services détectés (${contexte.services.length})</h3><table><tr><th>Port</th><th>Service</th><th>Version</th></tr>`;
        for (const s of contexte.services) {
          html += `<tr><td>${s.port}</td><td>${this.escapeHtml(s.service)}</td><td>${this.escapeHtml(s.version)}</td></tr>`;
        }
        html += '</table>';
      }

      if (contexte.vulnerabilites.length > 0) {
        html += `<h3>Vulnérabilités (${contexte.vulnerabilites.length})</h3>`;
        for (const v of contexte.vulnerabilites) {
          const couleur = couleurSeverite[v.severite] ?? '#64748b';
          html += `<div class="reco" style="border-color: ${couleur}"><span class="severite" style="background: ${couleur}; color: #0f172a">${v.severite}</span> <strong>${this.escapeHtml(v.type)}</strong> sur ${this.escapeHtml(v.cible)}<br>${this.escapeHtml(v.description)}</div>`;
        }
      }

      if (contexte.credentialsTrouves.length > 0) {
        html += `<h3>Credentials trouvés (${contexte.credentialsTrouves.length})</h3><table><tr><th>Utilisateur</th><th>Mot de passe</th><th>Service</th></tr>`;
        for (const c of contexte.credentialsTrouves) {
          html += `<tr><td>${this.escapeHtml(c.utilisateur)}</td><td>${this.escapeHtml(c.motDePasse)}</td><td>${c.service}</td></tr>`;
        }
        html += '</table>';
      }
    }

    // Timeline
    html += '<h2>Méthodologie (timeline)</h2>';
    for (const etape of session.etapes) {
      const couleur = couleurSeverite[etape.severite] ?? '#64748b';
      html += `<div class="reco" style="border-color: ${couleur}">`;
      html += `<span class="severite" style="background: ${couleur}; color: #0f172a">${etape.severite}</span> <strong>${this.escapeHtml(etape.description)}</strong><br>`;
      html += `<small>Type: ${etape.type} | ${new Date(etape.ts).toLocaleString('fr-FR')}</small><br>`;
      if (etape.explication) html += `${this.escapeHtml(etape.explication)}<br>`;
      if (etape.commande) html += `<div class="code">${this.escapeHtml(etape.commande)}</div>`;
      if (etape.resultat?.stdout) {
        const extrait = etape.resultat.stdout.split('\n').slice(0, 5).join('\n');
        html += `<div class="code">${this.escapeHtml(extrait)}</div>`;
      }
      html += '</div>';
    }

    // Anti-forensics
    html += '<h2>Anti-traçage et nettoyage</h2>';
    if (tracesAntiForensics.length === 0) {
      html += '<p>Aucune action anti-forensic enregistrée.</p>';
    } else {
      html += '<table><tr><th>Action</th><th>Description</th><th>Statut</th><th>Timestamp</th></tr>';
      for (const t of tracesAntiForensics) {
        html += `<tr><td>${this.escapeHtml(t.action)}</td><td>${this.escapeHtml(t.description)}</td><td>${t.statut}</td><td>${new Date(t.timestamp).toLocaleString('fr-FR')}</td></tr>`;
      }
      html += '</table>';
    }

    // Recommandations
    html += '<h2>Recommandations de défense</h2>';
    if (posture.recommandations.length === 0) {
      html += '<p>Aucune recommandation. La cible semble bien sécurisée.</p>';
    } else {
      for (const reco of posture.recommandations) {
        const couleur = couleurSeverite[reco.severite] ?? '#64748b';
        html += `<div class="reco" style="border-color: ${couleur}">`;
        html += `<span class="severite" style="background: ${couleur}; color: #0f172a">${reco.severite}</span> <strong>${this.escapeHtml(reco.titre)}</strong><br>`;
        html += `${this.escapeHtml(reco.description)}<br>`;
        html += `<em>Correctif : ${this.escapeHtml(reco.correctif)}</em>`;
        if (reco.cve) html += `<br><small>CVE: ${reco.cve}</small>`;
        html += '</div>';
      }
    }

    // Conclusion
    html += `<div class="conclusion"><h2>Conclusion</h2><p>${this.escapeHtml(this.genererConclusion(posture, contexte))}</p></div>`;

    html += '</body></html>';
    return html;
  }

  private iconeSeverite(severite: string): string {
    switch (severite) {
      case 'info': return 'ℹ️';
      case 'remarque': return '🔎';
      case 'avertissement': return '⚠️';
      case 'critique': return '🔴';
      default: return '•';
    }
  }

  private genererConclusion(posture: PostureSecurite, contexte?: ContexteCible): string {
    const parts: string[] = [];
    parts.push(`Le pentest a identifié ${posture.recommandations.length} point(s) d'amélioration.`);
    if (posture.recommandations.filter((r) => r.severite === 'critique').length > 0) {
      parts.push('Des vulnérabilités critiques nécessitent une action immédiate.');
    }
    if (contexte && contexte.credentialsTrouves.length > 0) {
      parts.push(`${contexte.credentialsTrouves.length} credential(s) faible(s) découvert(s) : politique de mots de passe à renforcer.`);
    }
    if (contexte && contexte.vulnerabilites.length > 0) {
      parts.push(`${contexte.vulnerabilites.length} vulnérabilité(s) exploitée(s) : correctifs urgents requis.`);
    }
    if (posture.score >= 75) {
      parts.push('La posture globale reste acceptable mais des améliorations sont possibles.');
    } else {
      parts.push('La posture de sécurité nécessite des corrections importantes.');
    }
    return parts.join(' ');
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

/** Crée une instance du générateur de rapport. */
export function creerGenerateurRapport(): GenerateurRapport {
  return new GenerateurRapport();
}
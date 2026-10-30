// LA PAGE DE LA PORTE — ce que voit l'invité qui ouvre le lien.
//
// Servie par la Reine à `GET /r/<id>`. Elle ne connaît du billet que son
// IDENTIFIANT : le billet entier est dans le fragment de l'URL, que le
// navigateur ne transmet jamais au serveur (`shared/porte.ts`). Tout ce qui
// dépend du billet — le nom de la ruche, la validité, la commande, le lien vers
// l'application — se compose DANS LE NAVIGATEUR, et l'état se lit par
// `POST /api/billets/:id/etat`, qui exige le secret.
//
// ─── LA DIRECTION ────────────────────────────────────────────────────────────
//
// Celle de Mission Control (`docs/DIRECTION-ARTISTIQUE.md`) : fond sombre
// profond, surfaces propres, typographie forte, miel RARE. L'élément qu'on
// retient est une alvéole vide, tracée au miel, dans un rayon éteint : la
// place qui attend la machine de l'invité. Quand elle entre, l'alvéole se
// remplit. Rien d'autre ne bouge.
//
// Aucune dépendance, aucune requête externe : les polices sont celles que
// l'écran a construites (`fontesDuTableau`), ou celles du système. Une CSP
// stricte à nonce : la page n'exécute que son propre script.

import { readdirSync } from 'node:fs';
import { DEPOT_BRUT } from '../shared/commande-entree.js';
import { HOTE_LIEN_PROFOND, LIBELLES_SYSTEME, type SystemeInvite } from '../shared/porte.js';

/** Les polices de l'écran, si `dashboard/dist` est construit : nom → URL servie. */
export interface Fontes {
  titre?: string;
  texte?: string;
  mono?: string;
}

/**
 * Retrouve dans `dist/assets` les fichiers que Vite a émis pour les trois
 * polices (nom suffixé d'un condensé). Sans écran construit : aucune — la page
 * s'écrit alors avec les polices du système, et reste lisible.
 */
export function fontesDuTableau(dashboardDist: string): Fontes {
  let fichiers: string[];
  try {
    fichiers = readdirSync(`${dashboardDist}/assets`);
  } catch {
    return {};
  }
  const trouve = (prefixe: string): string | undefined => {
    const f = fichiers.find((n) => n.startsWith(prefixe) && n.endsWith('.woff2'));
    return f === undefined ? undefined : `/assets/${f}`;
  };
  const fontes: Fontes = {};
  const titre = trouve('bricolage-grotesque-latin-400-700');
  const texte = trouve('instrument-sans-latin-400-600');
  const mono = trouve('jetbrains-mono-latin-400-600');
  if (titre) fontes.titre = titre;
  if (texte) fontes.texte = texte;
  if (mono) fontes.mono = mono;
  return fontes;
}

export interface OptionsPorte {
  /** L'identifiant public du billet, déjà validé par la route. */
  id: string;
  /** Un nonce tiré au sort pour CETTE réponse ; la CSP n'accepte que lui. */
  nonce: string;
  /** Le système deviné d'après le User-Agent ; le script affine ensuite. */
  systeme: SystemeInvite;
  /** La page des releases, d'où télécharger l'application. */
  releases: string;
  fontes?: Fontes;
  /** La version de la Reine, pour le pied de page. */
  version?: string;
}

/** Échappe pour un attribut ou un texte HTML. */
const h = (s: string): string =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

/** Pour poser une valeur dans un `<script>` : JSON, sans `</script>` possible. */
const js = (v: unknown): string => JSON.stringify(v).replaceAll('<', '\\u003c');

const ID_BILLET = /^[A-Za-z0-9_-]{1,80}$/;

/** La politique de sécurité de la page : rien d'autre que ce qu'elle porte. */
export function cspPorte(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    "font-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function fontFaces(f: Fontes): string {
  const face = (famille: string, url: string | undefined, graisses: string): string =>
    url === undefined
      ? ''
      : `@font-face{font-family:'${famille}';font-style:normal;font-weight:${graisses};font-display:swap;src:url('${url}') format('woff2')}`;
  return (
    face('Bricolage Grotesque', f.titre, '400 700') +
    face('Instrument Sans', f.texte, '400 600') +
    face('JetBrains Mono', f.mono, '400 600')
  );
}

/** Le rayon : sept alvéoles éteintes, et UNE qui attend, tracée au miel. */
function rayon(): string {
  // Hexagones à sommets plats, rayon 34, posés sur deux rangées décalées.
  const hex = (cx: number, cy: number, cls: string): string => {
    const r = 34;
    const pts = Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i;
      return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
    }).join(' ');
    return `<polygon class="${cls}" points="${pts}"/>`;
  };
  const dx = 34 * 1.5 + 6;
  const dy = 34 * Math.sqrt(3) + 7;
  const cellules = [
    hex(60, 70, 'alv'),
    hex(60 + dx, 70 + dy / 2, 'alv'),
    hex(60 + 2 * dx, 70, 'alv attend'),
    hex(60 + 3 * dx, 70 + dy / 2, 'alv'),
    hex(60 + 4 * dx, 70, 'alv'),
    hex(60 + 5 * dx, 70 + dy / 2, 'alv'),
    hex(60 + 6 * dx, 70, 'alv'),
  ].join('');
  return `<svg class="rayon" viewBox="0 0 520 150" width="520" height="150" aria-hidden="true" focusable="false">${cellules}</svg>`;
}

/**
 * La page, en une chaîne. Tout ce qui vient du dehors passe par `h`/`js`.
 */
export function pagePorte(o: OptionsPorte): string {
  if (!ID_BILLET.test(o.id)) throw new Error('identifiant de billet hors grammaire');
  const f = o.fontes ?? {};
  const n = h(o.nonce);
  const systemeLibelle = LIBELLES_SYSTEME[o.systeme];
  const config = js({
    id: o.id,
    systeme: o.systeme,
    releases: o.releases,
    depot: DEPOT_BRUT,
    hote: HOTE_LIEN_PROFOND,
  });

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#0c0d10">
<title>Rejoindre la ruche</title>
<style nonce="${n}">
${fontFaces(f)}
:root{--bg:#0c0d10;--bg-2:#111318;--panel:#15171d;--panel-2:#1b1e25;--panel-3:#23272f;--border:#262a33;--border-2:#333844;--text:#eeebe5;--muted:#a9abb2;--faint:#8f929b;--honey:#f0b64a;--miel:#f6c445;--green:#5ccfa8;--red:#ff8a73;--encre:#08090b;--focus:#f6c445;--r:10px;--r-lg:12px;--titre:'Bricolage Grotesque',ui-sans-serif,system-ui,sans-serif;--texte:'Instrument Sans',ui-sans-serif,system-ui,sans-serif;--mono:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
*{box-sizing:border-box}
html{background:var(--bg);color:var(--text);font:400 16px/1.55 var(--texte);-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;display:flex;flex-direction:column}
main{width:100%;max-width:600px;margin:0 auto;padding:40px 20px 56px;flex:1}
.rayon{display:block;width:100%;max-width:520px;height:auto;margin:8px 0 28px -8px}
.alv{fill:var(--panel);stroke:var(--border-2);stroke-width:1.5}
.alv.attend{fill:none;stroke:var(--miel);stroke-width:2;stroke-dasharray:6 7;animation:tourne 9s linear infinite}
.alv.pleine{fill:var(--miel);stroke:var(--miel);stroke-dasharray:none;animation:none}
.alv.fermee{fill:var(--panel);stroke:var(--border-2);stroke-width:1.5;stroke-dasharray:none;animation:none}
@keyframes tourne{to{stroke-dashoffset:-78}}
h1{font:600 clamp(28px,6vw,40px)/1.08 var(--titre);letter-spacing:-.035em;margin:0 0 14px;text-wrap:balance}
.sous{color:var(--muted);margin:0 0 30px;max-width:48ch}
.sous strong{color:var(--text);font-weight:600}
.geste{display:flex;flex-direction:column;gap:12px;margin:0 0 34px}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 20px;border-radius:var(--r);font:600 16px/1 var(--texte);text-decoration:none;cursor:pointer;border:1px solid transparent;transition:background .16s ease,border-color .16s ease}
.btn.primaire{background:var(--miel);color:var(--encre);border-color:var(--miel)}
.btn.primaire:hover{background:#ffd25c}
.btn.second{background:var(--panel);color:var(--text);border-color:var(--border-2)}
.btn.second:hover{border-color:var(--faint)}
.btn:focus-visible,.copier:focus-visible,details summary:focus-visible,a:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
.note{color:var(--faint);font-size:14px;margin:0}
.note a{color:var(--honey)}
.etat{display:flex;align-items:flex-start;gap:12px;padding:14px 16px;border:1px solid var(--border);border-radius:var(--r-lg);background:var(--bg-2);margin:0 0 34px;font-size:15px;color:var(--muted)}
.etat .pastille{flex:none;width:10px;height:10px;border-radius:999px;background:var(--faint);margin-top:7px}
.etat.vivant .pastille{background:var(--miel);box-shadow:0 0 0 3px color-mix(in srgb,var(--miel) 25%,transparent)}
.etat.attente .pastille{background:var(--miel);animation:pouls 1.4s ease-in-out infinite}
.etat.entre{border-color:color-mix(in srgb,var(--green) 40%,var(--border));color:var(--text)}
.etat.entre .pastille{background:var(--green)}
.etat.ferme{color:var(--text)}
.etat.ferme .pastille{background:var(--red)}
.etat strong{color:var(--text);font-weight:600}
@keyframes pouls{0%,100%{opacity:1}50%{opacity:.35}}
details{border-top:1px solid var(--border);padding:18px 0 6px}
summary{cursor:pointer;font-weight:600;color:var(--text);list-style:none;display:flex;align-items:center;justify-content:space-between;min-height:44px}
summary::-webkit-details-marker{display:none}
summary::after{content:'+';color:var(--faint);font-size:22px;font-weight:400}
details[open] summary::after{content:'−'}
.os{display:flex;gap:6px;margin:10px 0 12px}
.os button{min-height:36px;padding:0 12px;border-radius:999px;border:1px solid var(--border-2);background:transparent;color:var(--muted);font:500 13px/1 var(--texte);cursor:pointer}
.os button[aria-pressed=true]{background:var(--panel-3);color:var(--text);border-color:var(--faint)}
.cmd{position:relative;background:var(--panel);border:1px solid var(--border);border-radius:var(--r-lg);padding:14px 56px 14px 16px;margin:0 0 10px}
.cmd code{display:block;font:400 13px/1.5 var(--mono);color:var(--text);white-space:pre-wrap;word-break:break-all}
.copier{position:absolute;top:8px;right:8px;min-height:36px;padding:0 12px;border-radius:8px;border:1px solid var(--border-2);background:var(--panel-2);color:var(--text);font:500 13px/1 var(--texte);cursor:pointer}
.copier:hover{border-color:var(--faint)}
.sait{margin:0;padding:0;list-style:none;color:var(--muted);font-size:14px;display:grid;gap:8px}
.sait li{padding-left:18px;position:relative}
.sait li::before{content:'';position:absolute;left:0;top:.62em;width:8px;height:8px;border-radius:2px;background:var(--border-2)}
.sait li.oui::before{background:var(--green)}
.sait li.non::before{background:var(--red)}
footer{border-top:1px solid var(--border);color:var(--faint);font-size:13px;padding:18px 20px;text-align:center}
footer a{color:var(--faint)}
.cache{display:none !important}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms !important;animation-iteration-count:1 !important;transition-duration:.01ms !important}}
@media (max-width:480px){main{padding:28px 16px 44px}.rayon{margin-left:-4px}}
</style>
</head>
<body>
<main>
${rayon()}
<h1 id="titre">Rejoindre une ruche</h1>
<p class="sous" id="sous">Une alvéole vous attend. <strong>Votre ordinateur</strong> travaillera pour cette ruche avec votre propre agent de codage — dans un dossier jetable, sans toucher à vos fichiers.</p>

<section class="etat" id="etat" aria-live="polite">
  <span class="pastille"></span>
  <span id="etat-texte">Lecture du lien…</span>
</section>

<div class="geste" id="geste">
  <a class="btn primaire" id="app" href="#" rel="noreferrer">Rejoindre avec l’application Hive</a>
  <a class="btn second" id="telecharger" href="${h(o.releases)}" target="_blank" rel="noopener noreferrer">Télécharger Hive pour <span id="os-nom">${h(systemeLibelle)}</span></a>
  <p class="note" id="note-app">Pas encore l’application ? Téléchargez-la, installez-la, puis revenez ici et cliquez sur <em>Rejoindre</em>.</p>
</div>

<details id="terminal">
  <summary>Plutôt un terminal ?</summary>
  <div class="os" role="group" aria-label="Système">
    <button type="button" data-os="posix" aria-pressed="false">Linux · macOS</button>
    <button type="button" data-os="windows" aria-pressed="false">Windows</button>
  </div>
  <div class="cmd"><code id="cmd"></code><button type="button" class="copier" id="copier">Copier</button></div>
  <p class="note">Une commande : elle installe Hive si besoin, puis rejoint. Hive déjà installé ? <code>hive join</code> suivi de ce lien suffit.</p>
</details>

<details>
  <summary>Ce que l’hôte de la ruche peut faire, et ne peut pas</summary>
  <ul class="sait">
    <li class="oui">Voir le nom de votre machine et lui confier des tâches de code, une à la fois.</li>
    <li class="oui">Lire les modifications que votre agent produit sur le projet qu’il vous confie.</li>
    <li class="non">Lire vos fichiers, vos clés ou votre historique : la tâche tourne dans un clone jetable, isolé.</li>
    <li class="non">Vous retenir : vous arrêtez votre ouvrière quand vous voulez, et l’hôte peut vous exclure d’un geste.</li>
  </ul>
</details>
</main>
<footer>Hive${o.version ? ` ${h(o.version)}` : ''} · <a href="https://github.com/Micka420-collab/hive" rel="noopener noreferrer" target="_blank">le code est ouvert</a></footer>
<script nonce="${n}">
(function(){
'use strict';
var C=${config};
var $=function(id){return document.getElementById(id)};
var etat=$('etat'),etatTexte=$('etat-texte'),titre=$('titre'),sous=$('sous');
function dire(classe,html){etat.className='etat '+classe;etatTexte.innerHTML=html}
function texte(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}

// ─── Le billet, lu du fragment, jamais envoyé ─────────────────────────────
var brut=(location.hash||'').replace(/^#/,'');
var ok=/^hive2_[A-Za-z0-9_-]+$/.test(brut)&&brut.length<=4000;
var billet=null;
if(ok){try{var oct=atob(brut.slice(6).replace(/-/g,'+').replace(/_/g,'/'));var tab=new Uint8Array(oct.length);for(var k=0;k<oct.length;k++)tab[k]=oct.charCodeAt(k);var d=JSON.parse(new TextDecoder().decode(tab));if(d&&d.v===2&&d.id===C.id&&typeof d.url==='string'&&typeof d.s==='string')billet=d}catch(e){billet=null}}
if(!billet){
  dire('ferme','<strong>Ce lien est incomplet.</strong> Il a sans doute été coupé en le copiant. Redemandez-le à la personne qui vous invite.');
  $('geste').classList.add('cache');$('terminal').classList.add('cache');
  return;
}
var label=billet.label&&billet.label.length<=200?billet.label:null;
if(label){titre.textContent='Rejoindre «\u00a0'+label+'\u00a0»';document.title='Rejoindre « '+label+' » — Hive'}

// ─── Le système, affiné côté navigateur ──────────────────────────────────
var systeme=C.systeme;
var ua=(navigator.userAgent||'').toLowerCase();
var uad=navigator.userAgentData&&navigator.userAgentData.platform?String(navigator.userAgentData.platform).toLowerCase():'';
if(/android|iphone|ipad|ipod|mobile/.test(ua)||uad==='android'||uad==='ios')systeme='autre';
else if(/win/.test(uad)||/windows/.test(ua))systeme='windows';
else if(/mac/.test(uad)||/mac os x|macintosh/.test(ua))systeme='macos';
else if(/linux|cros/.test(uad)||/linux|x11|cros/.test(ua))systeme='linux';
var noms={windows:'Windows',macos:'macOS',linux:'Linux',autre:'votre ordinateur'};
$('os-nom').textContent=noms[systeme];
if(systeme==='autre'){
  $('note-app').innerHTML='Cette page s’ouvre sur un téléphone ou une tablette : une ruche se rejoint depuis un <strong>ordinateur</strong>. Envoyez-vous ce lien, et ouvrez-le là-bas.';
}

// ─── Le lien profond vers l'application ─────────────────────────────────
var profond='hive://'+C.hote+'/'+brut;
var app=$('app');app.setAttribute('href',profond);

// ─── La commande, la même que compose la ruche (shared/commande-entree.ts) ──
var os=systeme==='windows'?'windows':'posix';
function commande(o){
  if(o==='posix')return 'curl -fsSL '+C.depot+'/rejoindre.sh | sh -s -- '+brut;
  return 'irm '+C.depot+'/rejoindre.ps1 -OutFile "$env:TEMP\\\\hive-rejoindre.ps1"; powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\\\\hive-rejoindre.ps1" -Billet '+brut;
}
var cmd=$('cmd');
function montrerOs(o){os=o;cmd.textContent=commande(o);var bs=document.querySelectorAll('.os button');for(var i=0;i<bs.length;i++)bs[i].setAttribute('aria-pressed',String(bs[i].getAttribute('data-os')===o))}
montrerOs(os);
var bs=document.querySelectorAll('.os button');
for(var i=0;i<bs.length;i++)bs[i].addEventListener('click',function(e){montrerOs(e.currentTarget.getAttribute('data-os'))});
$('copier').addEventListener('click',function(){
  var b=$('copier');
  function fait(){b.textContent='Copié ✓';setTimeout(function(){b.textContent='Copier'},1800)}
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(cmd.textContent).then(fait,fait);
  else{var r=document.createRange();r.selectNodeContents(cmd);var s=getSelection();s.removeAllRanges();s.addRange(r);try{document.execCommand('copy')}catch(e){}s.removeAllRanges();fait()}
});

// ─── L'état du billet : lu avec le secret, jamais sans ────────────────────
var secret=billet.s,enAttente=false,minuteur=null,debut=0;
function quand(ms){try{return new Date(ms).toLocaleString('fr-FR',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})}catch(e){return new Date(ms).toISOString()}}
function remplir(){var a=document.querySelector('.alv.attend');if(a){a.classList.remove('attend');a.classList.add('pleine')}}
function fermer(){var a=document.querySelector('.alv.attend');if(a){a.classList.remove('attend');a.classList.add('fermee')}$('geste').classList.add('cache');$('terminal').classList.add('cache')}
function lire(){
  return fetch('/api/billets/'+encodeURIComponent(C.id)+'/etat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({secret:secret}),credentials:'omit'})
  .then(function(r){return r.json().then(function(j){return {status:r.status,corps:j}})})
  .then(function(rep){
    var j=rep.corps||{};
    if(rep.status===429){dire('attente','Trop d’essais depuis cette connexion — <strong>patientez une minute</strong>.');return}
    if(rep.status!==200||!j.etat){dire('ferme','<strong>La ruche ne reconnaît pas ce lien.</strong> Redemandez-en un à la personne qui vous invite.');return}
    if(j.label&&!label){label=j.label;titre.textContent='Rejoindre «\u00a0'+label+'\u00a0»';document.title='Rejoindre « '+label+' » — Hive'}
    var arrivees=Array.isArray(j.arrivees)?j.arrivees:[];
    if(enAttente&&arrivees.length>0&&arrivees[0].quand>=debut){
      remplir();clearInterval(minuteur);
      dire('entre','<strong>« '+texte(arrivees[0].label||'votre machine')+' » est entrée dans la ruche.</strong> Vous pouvez fermer cette page : l’ouvrière continue sur votre ordinateur.');
      $('geste').classList.add('cache');$('terminal').classList.add('cache');
      return;
    }
    if(j.etat==='revoque'){clearInterval(minuteur);dire('ferme','<strong>Ce lien a été révoqué</strong> par l’hôte. Demandez-en un nouveau.');fermer();return}
    if(j.etat==='expire'){clearInterval(minuteur);dire('ferme','<strong>Ce lien a expiré</strong> le '+quand(j.expiresAt)+'. Demandez-en un nouveau.');fermer();return}
    if(j.etat==='epuise'){clearInterval(minuteur);dire('ferme','<strong>Ce lien a déjà servi</strong>'+(arrivees.length?' — « '+texte(arrivees[0].label||'une machine')+' » est entrée le '+quand(arrivees[0].quand)+'.':'.')+' Demandez-en un nouveau pour une autre machine.');fermer();return}
    if(enAttente){dire('attente','<strong>En attente de votre machine…</strong> Dès qu’elle entre, cette alvéole se remplit. L’installation peut prendre une ou deux minutes.');return}
    var places=j.usesLeft===1?'une place':j.usesLeft+' places';
    dire('vivant','Ce lien est valable jusqu’au <strong>'+quand(j.expiresAt)+'</strong> · '+places+'.'+(j.label?'':''));
  })
  .catch(function(){dire('ferme','<strong>La ruche ne répond pas.</strong> Elle est peut-être éteinte, ou injoignable depuis ce réseau. Réessayez dans un instant.')});
}
lire();
function attendre(){
  if(enAttente)return;enAttente=true;debut=Date.now();
  dire('attente','<strong>En attente de votre machine…</strong> Dès qu’elle entre, cette alvéole se remplit.');
  minuteur=setInterval(function(){if(Date.now()-debut>20*60*1000){clearInterval(minuteur);enAttente=false;lire();return}lire()},4000);
}
app.addEventListener('click',attendre);
$('copier').addEventListener('click',attendre);
})();
</script>
</body>
</html>
`;
}

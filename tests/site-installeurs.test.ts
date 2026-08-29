// ADR 0002 — Pages sert les installeurs ; le workflow les COPIE, il ne les
// duplique pas dans `site/` (deux copies dérivent). Les scripts affichent leur
// empreinte SHA-256 avant d'agir quand ils tournent comme fichier.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const lire = (f: string) => readFileSync(path.join(RACINE, f), 'utf8');

describe('Pages publie les installeurs (ADR 0002)', () => {
  it('le workflow Site copie install.sh et install.ps1 dans site/', () => {
    const wf = lire('.github/workflows/pages.yml');
    expect(wf).toContain('cp install.sh install.ps1 site/');
    expect(wf).toMatch(/paths:[\s\S]*install\.sh/);
    expect(wf).toMatch(/paths:[\s\S]*install\.ps1/);
    expect(wf).toContain('install.sha256');
  });

  it('README FR et EN annoncent la variante prudente Windows + Pages', () => {
    // Sans ça, Linux a le pipe prudent documenté et Windows reste « irm | run »
    // sans manifeste — le défaut que le lot 8 (empreintes Pages) devait fermer.
    for (const f of ['README.md', 'README.en.md'] as const) {
      const txt = lire(f);
      expect(txt).toContain('micka420-collab.github.io/hive/install.ps1');
      expect(txt).toContain('install.sha256');
      expect(txt).toMatch(/Get-FileHash|sha256sum/);
    }
  });

  it('INSTALLATION.md ne promet plus une Release pour l’empreinte', () => {
    // Le manifeste vit sur Pages ; une Release signée reste 🔒. Dire « Release /
    // install.sha256 » laisse croire qu’un tag signé existe déjà.
    const txt = lire('docs/INSTALLATION.md');
    expect(txt).toContain('micka420-collab.github.io/hive/install.sha256');
    expect(txt).toContain('Get-FileHash');
    expect(txt).toMatch(/Release GitHub signée|signed GitHub Release/i);
    expect(txt).not.toMatch(/publié avec la Release\s*\/\s*`?site\/install\.sha256/);
  });

  it('ADR 0002 amende : empreinte Pages avant Release signée', () => {
    const adr = lire('docs/adr/0002-distribution-one-liners.md');
    expect(adr).toContain('install.sha256');
    expect(adr).toMatch(/Amendement du 21 août 2026/);
    expect(adr).toMatch(/Pages avant la Release/);
  });

  it('install.sh et install.ps1 annoncent l’empreinte dans le source', () => {
    const sh = lire('install.sh');
    expect(sh).toContain('annoncer_empreinte');
    expect(sh).toContain('Empreinte SHA-256');
    expect(sh).toContain('Tuyau curl|sh');
    // Hasher via stdin : sous Windows, `sha256sum "$0"` préfixait le condensé
    // de `\\` (chemin). La garde refuse le retour à `"$0"` comme seul argument.
    expect(sh).toMatch(/sha256sum\s*<\s*"\$0"/);
    expect(lire('install.ps1')).toContain('Get-FileHash');
    expect(lire('install.ps1')).toContain('Empreinte SHA-256');
  });
});

describe('install.sh annonce son empreinte', () => {
  // ─── CE BANC MESURAIT LA MACHINE, PAS LE SCRIPT ────────────────────────────
  //
  // Il lançait `install.sh --dry-run` avec `execFileSync`, qui LÈVE dès que le
  // code de sortie n'est pas nul. Sur un poste en Node 22, l'installeur refuse
  // — c'est son travail — et l'exception emportait toute la sortie : le banc
  // rougissait sans jamais dire pourquoi, et la ligne d'empreinte QUI ÉTAIT
  // BIEN LÀ n'était même pas lue.
  //
  // Un banc qui rougit selon la version de Node de l'hôte ne mesure pas le
  // dépôt. Celui-ci lit maintenant la sortie DANS LES DEUX MONDES, et vérifie
  // la propriété qui compte : l'empreinte est annoncée AVANT tout verdict —
  // on sait ce qu'on s'apprête à exécuter avant que le script décide quoi que
  // ce soit. Et sur un Node trop vieux, le refus se dit ; il n'est pas muet.
  const lancer = (): { sortie: string; code: number } => {
    const r = spawnSync(
      'sh',
      [path.join(RACINE, 'install.sh'), '--dry-run', '--dir=/tmp/hive-empreinte-test-$$'],
      {
        encoding: 'utf8',
        env: { ...process.env, NO_COLOR: '1', TERM: 'dumb', HIVE_DEPOT: RACINE },
        timeout: 60_000,
      },
    );
    if (r.error) throw r.error;
    return { sortie: `${r.stdout ?? ''}${r.stderr ?? ''}`, code: r.status ?? -1 };
  };

  /** Le plancher que l'installeur s'impose, LU dans le script — jamais recopié. */
  const nodeMin = Number(/^NODE_MIN=(\d+)$/m.exec(lire('install.sh'))?.[1]);

  it('le plancher de version est lisible dans le script', () => {
    // Sans lui, les deux cas ci-dessous se choisiraient sur un nombre écrit de
    // tête, et le banc mentirait le jour où le plancher bouge.
    expect(nodeMin, 'NODE_MIN introuvable dans install.sh').toBeGreaterThan(0);
  });

  it('affiche le SHA-256 avant de juger quoi que ce soit (--dry-run)', () => {
    // Sous Windows, git peut convertir les fins de ligne : le hash Node ≠
    // sha256sum du fichier sur disque. On vérifie la présence de la ligne ;
    // l'égalité octet-à-octet reste la garde Linux/macOS.
    const attendu = createHash('sha256')
      .update(readFileSync(path.join(RACINE, 'install.sh')))
      .digest('hex');
    const { sortie } = lancer();
    expect(sortie).toMatch(/Empreinte SHA-256 : [0-9a-f]{64}/);
    if (process.platform !== 'win32') {
      expect(sortie).toContain(`Empreinte SHA-256 : ${attendu}`);
    }
  });

  it('LE CODE DE SORTIE DIT LA VÉRITÉ, DANS LES DEUX MONDES', () => {
    // ─── CE QUE LA RÉÉCRITURE AVAIT FAILLI PERDRE ───────────────────────────
    //
    // L'ancien banc n'affirmait rien du code de sortie — il n'en avait pas
    // besoin : `execFileSync` LEVAIT dès qu'il n'était pas nul, donc « le
    // dry-run réussit » était tenu, mais par accident d'outil et sans être
    // écrit nulle part. En passant à `spawnSync`, qui ne lève plus, cette
    // affirmation-là serait tombée en silence : un `--dry-run` qui se met à
    // échouer sur un runner neuf n'aurait plus fait rougir personne.
    //
    // Elle est donc REMISE, explicite, et des deux côtés du plancher : au-dessus
    // le dry-run doit réussir, en dessous il doit refuser. Le même banc ne
    // mesure plus la machine — il mesure ce que le script promet À CETTE
    // machine-là.
    const majeur = Number(process.versions.node.split('.')[0]);
    const { sortie, code } = lancer();
    if (majeur >= nodeMin) {
      expect(code, `--dry-run doit réussir sous Node ${majeur} (≥ ${nodeMin})`).toBe(0);
      return;
    }
    expect(code, 'un refus qui sort 0 fait croire à une installation réussie').not.toBe(0);
    expect(sortie, 'le refus ne nomme pas la version trouvée').toContain(`Node ${majeur}`);
    expect(sortie, 'le refus ne nomme pas le plancher exigé').toContain(String(nodeMin));
  });
});

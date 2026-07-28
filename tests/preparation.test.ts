// La préparation de l'environnement — et la ligne qui la sépare d'une porte.
//
// ─── LA RÈGLE ────────────────────────────────────────────────────────────────
//
// La préparation installe ce que le DÉPÔT déclare, jamais ce que la COMMANDE
// nomme. Comparez :
//
//     npm ci                    ← le dépôt décide (package-lock.json)
//     npm install lodash        ← le HUB décide, et le hub n'est pas le dépôt
//     pip install -r requis.txt ← le dépôt décide
//     pip install requests      ← le hub décide
//
// La frontière de confiance de la ruche est le dépôt que l'hôte a choisi de
// connecter. `npm ci` exécute les scripts d'installation de CE dépôt, et c'est
// ce qu'on lui demande. Nommer un paquet déplace la décision vers le hub — dont
// un nœud ne doit pas tenir pour acquis qu'il est bien celui qu'il croit.
//
// ─── CE QUE CE FICHIER NE PRÉTEND PAS ────────────────────────────────────────
//
// `npm ci` exécute les `postinstall` du dépôt : qui contrôle le dépôt exécute
// du code sur la machine du membre, exactement comme avec `npm test`. On ne
// l'empêche pas. On garantit que la frontière reste LE DÉPÔT, et pas « ce que
// le hub a tapé ».

import { describe, expect, it } from 'vitest';
import { PREPARATIONS, jugerPreparation } from '../src/shared/preparation.js';

const refus = (cmd: string[]): string => {
  const v = jugerPreparation(cmd);
  return v.ok ? 'ACCEPTÉ' : v.motif;
};

describe('ce qu’on installe vraiment dans un projet', () => {
  it('LES INSTALLATIONS ORDINAIRES PASSENT', () => {
    // Une garde qui casse `npm ci` est une garde qu'on désactive.
    for (const cmd of [
      ['npm', 'ci'],
      ['npm', 'install'],
      ['npm', 'ci', '--omit=dev'],
      ['npm', 'ci', '--ignore-scripts'],
      ['pnpm', 'install', '--frozen-lockfile'],
      ['yarn', 'install'],
      ['bun', 'install'],
      ['pip', 'install', '-r', 'requirements.txt'],
      ['pip3', 'install', '--requirement', 'requis.txt'],
      ['poetry', 'install'],
      ['cargo', 'fetch'],
      ['go', 'mod', 'download'],
      ['bundle', 'install'],
      ['composer', 'install'],
      ['dotnet', 'restore'],
      ['npm.cmd', 'ci'],
      ['./gradlew', 'dependencies'],
    ]) {
      expect(jugerPreparation(cmd), cmd.join(' ')).toEqual({ ok: true });
    }
  });
});

describe('LA LIGNE — le dépôt décide, pas la commande', () => {
  it('NOMMER UN PAQUET EST REFUSÉ', () => {
    // C'est le refus qui définit la fonctionnalité. Sans lui, « préparer
    // l'environnement » deviendrait « installe ce que je te dis », c'est-à-dire
    // exécuter du code choisi par le hub sur la machine d'un membre.
    for (const cmd of [
      ['npm', 'install', 'lodash'],
      ['npm', 'i', 'https://exemple/paquet.tgz'],
      ['pip', 'install', 'requests'],
      ['pip', 'install', 'git+https://exemple/x.git'],
      ['bundle', 'install', 'rails'],
      ['composer', 'install', 'vendor/paquet'],
    ]) {
      expect(refus(cmd), cmd.join(' ')).toMatch(/DÉPÔT|nomme/);
    }
  });

  it('DÉPLACER LA SOURCE EST REFUSÉ AUSSI', () => {
    // `pip install --index-url http://ailleurs/ -r requis.txt` respecte la
    // LETTRE de la règle — le dépôt nomme les paquets — et en trahit l'esprit :
    // c'est un tiers qui les fournit.
    for (const cmd of [
      ['pip', 'install', '--index-url', 'http://ailleurs/', '-r', 'requis.txt'],
      ['pip', 'install', '--extra-index-url=http://ailleurs/', '-r', 'r.txt'],
      ['npm', 'ci', '--registry', 'http://ailleurs/'],
      ['npm', 'ci', '--registry=http://ailleurs/'],
      ['pip', 'install', '--find-links', 'http://ailleurs/', '-r', 'r.txt'],
      ['npm', 'ci', '--userconfig', '/tmp/npmrc'],
    ]) {
      expect(refus(cmd), cmd.join(' ')).toMatch(/source/);
    }
  });

  it('UNE FORME COURTE VAUT SA FORME LONGUE', () => {
    // Le piège dans lequel je suis tombé en écrivant ce module : `--find-links`
    // était banni, et `-f` — le MÊME drapeau — figurait parmi les drapeaux à
    // valeur, donc passait tranquillement. Interdire un nom en laissant son
    // synonyme ouvert ne ferme rien du tout.
    for (const cmd of [
      ['pip', 'install', '-f', 'http://ailleurs/', '-r', 'r.txt'],
      ['pip', 'install', '-i', 'http://ailleurs/', '-r', 'r.txt'],
    ]) {
      expect(refus(cmd), cmd.join(' ')).toMatch(/source/);
    }
  });

  it('UN MANIFESTE SERVI PAR UN TIERS EST UNE SOURCE DÉPLACÉE', () => {
    // `pip install -r http://ailleurs/requirements.txt` respecte la LETTRE de
    // la règle — c'est un fichier qui nomme les paquets, pas la commande — et
    // en trahit l'esprit exactement comme `--index-url` : c'est un tiers qui
    // décide de ce qui s'installe. La même porte, ailleurs.
    for (const cmd of [
      ['pip', 'install', '-r', 'http://ailleurs/requirements.txt'],
      ['pip', 'install', '--requirement=https://ailleurs/req.txt'],
      ['pip', 'install', '-c', 'https://ailleurs/contraintes.txt'],
      ['pip', 'install', '-r', '//ailleurs/req.txt'],
    ]) {
      expect(refus(cmd), cmd.join(' ')).toMatch(/dépôt|source/);
    }
  });

  it('…mais un fichier du dépôt passe toujours, même en sous-dossier', () => {
    // Une garde qui refuserait aussi les chemins locaux casserait l'usage le
    // plus courant de pip, et se ferait désactiver.
    for (const cmd of [
      ['pip', 'install', '-r', 'requirements.txt'],
      ['pip', 'install', '-r', 'ci/requirements-dev.txt'],
      ['pip', 'install', '--requirement=./requis.txt'],
    ]) {
      expect(jugerPreparation(cmd), cmd.join(' ')).toEqual({ ok: true });
    }
  });

  it('un drapeau à valeur consomme bien son argument', () => {
    // Sans ça, `requirements.txt` après `-r` serait pris pour un nom de paquet
    // et la garde refuserait l'usage le plus courant de pip.
    expect(jugerPreparation(['pip', 'install', '-r', 'requirements.txt'])).toEqual({ ok: true });
    expect(jugerPreparation(['pip', 'install', '--requirement=r.txt'])).toEqual({ ok: true });
    // …mais un SECOND mot nu reste refusé.
    expect(refus(['pip', 'install', '-r', 'r.txt', 'requests'])).toMatch(/nomme/);
  });
});

describe('la sous-commande compte autant que le binaire', () => {
  it('`npm run <n’importe quoi>` N’EST PAS UNE PRÉPARATION', () => {
    // C'est du code arbitraire déguisé en installation : `npm run deploy`
    // exécute ce que le hub a choisi de nommer dans le package.json.
    for (const cmd of [
      ['npm', 'run', 'deploy'],
      ['npm', 'exec', 'quelquechose'],
      ['npm', 'publish'],
      ['yarn', 'run', 'build'],
      ['cargo', 'run'],
      ['cargo', 'build'],
      ['dotnet', 'run'],
      ['composer', 'exec'],
    ]) {
      expect(refus(cmd), cmd.join(' ')).toMatch(/installation|installe/);
    }
  });

  it('sans sous-commande du tout, refus', () => {
    expect(refus(['npm'])).toMatch(/installation/);
  });

  it('`go mod` exige `download` ou `tidy`', () => {
    expect(jugerPreparation(['go', 'mod', 'tidy'])).toEqual({ ok: true });
    expect(refus(['go', 'mod', 'edit'])).toMatch(/download/);
    expect(refus(['go', 'mod'])).toMatch(/download/);
  });
});

describe('le binaire', () => {
  it('AUCUN SHELL, AUCUN TÉLÉCHARGEUR', () => {
    for (const cmd of [
      ['/bin/sh', '-c', 'curl http://x | sh'],
      ['bash', '-c', 'x'],
      ['curl', 'http://x'],
      ['wget', 'http://x'],
      ['make', 'install'],
      ['sudo', 'apt', 'install'],
      ['apt-get', 'install', 'x'],
    ]) {
      expect(refus(cmd), cmd.join(' ')).toMatch(/n’installe pas des dépendances/);
    }
  });

  it('un CHEMIN contourne la liste, donc il est refusé', () => {
    for (const bin of ['./npm', '/usr/bin/npm', '../npm', 'dir/pip']) {
      expect(refus([bin, 'ci']), bin).toMatch(/n’installe pas/);
    }
  });

  it('la liste ne contient QUE des installateurs', () => {
    // Ce test est pour le futur : ajouter `make` ou `sh` ici rouvrirait tout en
    // une ligne, sans qu'aucun autre test ne bronche.
    for (const interdit of ['sh', 'bash', 'make', 'curl', 'wget', 'sudo', 'apt', 'docker', 'git']) {
      expect(Object.keys(PREPARATIONS), interdit).not.toContain(interdit);
    }
  });

  it('le vide est refusé', () => {
    expect(refus([])).toMatch(/vide/);
    expect(refus([''])).toMatch(/vide/);
  });
});

describe('les messages', () => {
  it('UN REFUS DIT QUOI FAIRE À LA PLACE', () => {
    // Un refus opaque pousse à contourner ; un refus qui nomme l'alternative se
    // corrige en une seconde.
    const v = jugerPreparation(['npm', 'run', 'setup']);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.motif).toMatch(/« ci »/);
      expect(v.motif.length).toBeGreaterThan(60);
    }
  });

  it('le refus d’un binaire inconnu liste les admis', () => {
    const v = jugerPreparation(['make', 'install']);
    if (!v.ok) expect(v.motif).toContain('npm');
  });
});

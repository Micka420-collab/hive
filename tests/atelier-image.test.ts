// L'image de l'Atelier — invariants lisibles, sans construire (pas de démon
// Docker ici). La construction réelle est documentée dans docs/ATELIER.md.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const lire = (f: string): string => readFileSync(path.join(RACINE, f), 'utf8');
const nu = (s: string): string => s.replace(/^\s*#.*$/gm, '');

const DOCKER = lire('docker/atelier/Dockerfile');
const ENTREE = lire('docker/atelier/entrypoint.sh');
const COMPOSE = lire('docker-compose.yml');
const DOCKER_NU = nu(DOCKER);
const COMPOSE_NU = nu(COMPOSE);

describe('l’image de recette', () => {
  it('NE TOURNE PAS EN ROOT', () => {
    expect(DOCKER_NU).toMatch(/^USER\s+hive\s*$/m);
  });

  it('n’embarque aucun secret', () => {
    for (const cle of ['HIVE_TOKEN', 'HIVE_JWT_SECRET', 'ANTHROPIC_API_KEY']) {
      expect(DOCKER_NU, `${cle} dans l’image`).not.toContain(cle);
    }
    expect(DOCKER_NU).not.toMatch(/^\s*COPY\s+[^\n]*\.env/m);
  });

  it('porte Xvfb, Openbox, VNC, Chromium, Python, Node, LibreOffice, Tesseract', () => {
    expect(DOCKER).toMatch(/xvfb/i);
    expect(DOCKER).toMatch(/openbox/);
    expect(DOCKER).toMatch(/x11vnc/);
    expect(DOCKER).toMatch(/novnc|websockify/);
    expect(DOCKER).toMatch(/chromium/);
    expect(DOCKER).toMatch(/python3/);
    expect(DOCKER).toMatch(/libreoffice/);
    expect(DOCKER).toMatch(/tesseract/);
    expect(DOCKER).toMatch(/FROM node:24/);
  });

  it('explique pourquoi pas google-chrome-stable', () => {
    expect(DOCKER).toMatch(/google-chrome-stable/);
    expect(DOCKER).toMatch(/CDP/);
  });

  it('persiste /workspace', () => {
    expect(DOCKER).toMatch(/\/workspace/);
    expect(COMPOSE).toMatch(/hive-atelier-workspace:\/workspace/);
  });
});

describe('l’entrée', () => {
  it('démarre dans l’ordre écran → fenêtres → VNC → Chrome CDP → outils', () => {
    const i = (s: string) => ENTREE.indexOf(s);
    expect(i('Xvfb')).toBeGreaterThan(-1);
    expect(i('openbox')).toBeGreaterThan(i('Xvfb'));
    expect(i('chromium')).toBeGreaterThan(i('openbox'));
    expect(i('x11vnc')).toBeGreaterThan(i('chromium') - 1);
    expect(i('websockify')).toBeGreaterThan(-1);
    expect(i('outil.ts')).toBeGreaterThan(i('websockify'));
    expect(ENTREE).toMatch(/remote-debugging-port=9222/);
    expect(ENTREE).toMatch(/\.wake-hooks/);
  });
});

describe('compose — le bureau ne s’ouvre pas sur Internet', () => {
  it('chaque port d’atelier est publié sur 127.0.0.1', () => {
    const bloc = COMPOSE_NU.slice(COMPOSE_NU.indexOf('atelier:'));
    const ports = [...bloc.matchAll(/-\s*'([^']+)'/g)].map((m) => m[1]!);
    expect(ports.length, 'aucun port d’atelier').toBeGreaterThan(2);
    for (const p of ports) {
      if (!p.includes(':')) continue;
      expect(p, p).toMatch(/^127\.0\.0\.1:/);
    }
  });

  it('aucun env_file sur l’atelier — les secrets restent à la ruche', () => {
    const debut = COMPOSE_NU.indexOf('atelier:');
    const bloc = COMPOSE_NU.slice(debut, debut + 1200);
    expect(bloc).not.toMatch(/env_file:/);
  });

  it('le profil évite d’allumer le bureau avec la ruche', () => {
    expect(COMPOSE_NU).toMatch(/profiles:\s*\[atelier\]/);
  });
});

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// L'adresse de LA Reine que ce proxy relaie. `npm run ruche` la pose
// (`HIVE_HTTP`) à celle que sa Reine a annoncée en ouvrant son port ; sinon,
// le défaut d'une ruche locale. Écrite en dur, elle envoyait l'écran d'une
// ruche à `HIVE_PORT=7911` vers :7777 — une page qui s'affiche, et dont
// chaque appel échoue.
const reine = process.env.HIVE_HTTP ?? 'http://localhost:7777';

// Dashboard Hive : servi en dev par Vite (proxy → orchestrateur local), et en
// production construit dans dashboard/dist puis servi par l'orchestrateur.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': reine,
      '/ws': { target: reine.replace(/^http/, 'ws'), ws: true },
    },
    fs: {
      // Autorise l'import des types partagés depuis ../src/shared en dev.
      allow: ['..'],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Les deux seuls chunks au-dessus des 500 kB par défaut — CodeMirror
    // (≈508 kB) et le moteur 3D Galacean (≈1 152 kB) — sont chargés À LA
    // DEMANDE (import() dans le tiroir de tâche et la vue 3D) : ils ne pèsent
    // pas sur le chargement initial (entrée ≈232 kB, 73 kB gzip). La limite
    // est calée juste au-dessus du plus gros pour que toute NOUVELLE dérive
    // (vendor lourd glissé dans l'entrée, mise à jour qui gonfle un chunk)
    // redéclenche l'avertissement au lieu d'être noyée dans du bruit connu.
    chunkSizeWarningLimit: 1200,
  },
});

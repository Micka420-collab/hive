import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dashboard Hive : servi en dev par Vite (proxy → orchestrateur local), et en
// production construit dans dashboard/dist puis servi par l'orchestrateur.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:7777',
      '/ws': { target: 'ws://localhost:7777', ws: true },
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

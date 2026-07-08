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
  },
});

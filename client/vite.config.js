import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Client-internal alias. Keep it in sync with client/jsconfig.json,
      // which is what gives the editor the same resolution.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true, // exposes the dev server on the LAN — needed to test on a real phone
  },
});

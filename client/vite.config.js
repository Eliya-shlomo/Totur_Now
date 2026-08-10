import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  // One .env for the whole monorepo, at the repo root. Vite defaults to looking in
  // this package, which would mean a second file to keep in sync with the server's.
  //
  // Sharing the file with the server is safe because Vite only exposes variables
  // prefixed VITE_ to the bundle — DATABASE_URL and the API keys sitting in the same
  // file are not merely unused here, they are unreachable.
  envDir: fileURLToPath(new URL('..', import.meta.url)),
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

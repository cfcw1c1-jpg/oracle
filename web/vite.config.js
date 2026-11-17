import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// The web app reports the same version as the Expo app it shares releases with.
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export default defineConfig({
  plugins: [vue()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // The /api functions run under `vercel dev`; set VITE_API_PROXY to point elsewhere.
  server: { port: 5173, proxy: { '/api': process.env.VITE_API_PROXY || 'http://127.0.0.1:3001' } },
});

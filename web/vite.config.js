import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// The web app reports the same version as the Expo app it shares releases with.
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// Files in web/public the app needs offline.
const PUBLIC_FILES = ['/oracle-logo.png', '/defyne-logo.png', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

// Writes sw.js with the exact list of files this build produced, so the
// service worker can save the whole app for offline use (see sw-template.js).
function serviceWorker() {
  return {
    name: 'oracle-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter((name) => !name.endsWith('.map') && !name.endsWith('.html')).map((name) => `/${name}`);
      const precache = ['/', ...built, ...PUBLIC_FILES];
      const hash = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 12);
      const template = readFileSync(new URL('./sw-template.js', import.meta.url), 'utf8');
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template.replace('__VERSION__', `${version}-${hash}`).replace('__PRECACHE__', JSON.stringify(precache)),
      });
    },
  };
}

export default defineConfig({
  plugins: [vue(), serviceWorker()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // The /api functions run under `vercel dev`; set VITE_API_PROXY to point elsewhere.
  server: { port: 5173, proxy: { '/api': process.env.VITE_API_PROXY || 'http://127.0.0.1:3001' } },
});

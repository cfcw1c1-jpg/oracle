import '@fontsource-variable/dm-sans';
import '@fontsource-variable/inter';
import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import './styles/app.css';

createApp(App).use(router).mount('#app');

// Saves the app on the device so it opens offline (see web/sw-template.js).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => console.warn('Offline mode unavailable:', error.message));
  });
}

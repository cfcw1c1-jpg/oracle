import '@fontsource-variable/dm-sans';
import '@fontsource-variable/inter';
import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import './styles/app.css';

createApp(App).use(router).mount('#app');

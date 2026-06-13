import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router.js';
import { initCryptoEngine } from './crypto-init.js';

initCryptoEngine();

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');

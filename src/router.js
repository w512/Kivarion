import { createRouter, createWebHistory } from 'vue-router';
import HomePage from './pages/HomePage.vue';
import DatabasePage from './pages/DatabasePage.vue';
import SettingsPage from './pages/SettingsPage.vue';

const routes = [
    { path: '/', name: 'home', component: HomePage },
    { path: '/database', name: 'database', component: DatabasePage },
    { path: '/settings', name: 'settings', component: SettingsPage },
];

const router = createRouter({
    history: createWebHistory(),
    routes,
});

export default router;

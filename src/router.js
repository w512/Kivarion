import { createRouter, createWebHistory } from 'vue-router';
import HomePage from './pages/HomePage.vue';
import DatabasePage from './pages/DatabasePage.vue';
import SettingsPage from './pages/SettingsPage.vue';
import { useStore } from './store.js';

const routes = [
    { path: '/', name: 'home', component: HomePage },
    { path: '/database', name: 'database', component: DatabasePage },
    { path: '/settings', name: 'settings', component: SettingsPage },
];

const router = createRouter({
    history: createWebHistory(),
    routes,
});

router.beforeEach((to) => {
    const store = useStore();
    if (to.name === 'database' && !store.db) {
        return { name: 'home' };
    }
});

export default router;

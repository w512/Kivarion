import { createRouter, createWebHashHistory } from 'vue-router';
import HomePage from './pages/HomePage.vue';
import DatabasePage from './pages/DatabasePage.vue';
import SettingsPage from './pages/SettingsPage.vue';
import { useStore } from './store.js';

const routes = [
    { path: '/', name: 'home', component: HomePage },
    { path: '/database', name: 'database', component: DatabasePage },
    { path: '/settings', name: 'settings', component: SettingsPage },
    { path: '/:pathMatch(.*)*', redirect: { name: 'home' } },
];

const router = createRouter({
    // Hash history is reliable under Tauri's production custom protocol: a
    // reload never asks the asset server for a non-existent /database file.
    history: createWebHashHistory(),
    routes,
});

router.beforeEach((to) => {
    const store = useStore();
    if (to.name === 'database' && !store.db) {
        return { name: 'home' };
    }
});

export default router;

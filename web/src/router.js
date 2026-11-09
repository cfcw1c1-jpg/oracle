import { createRouter, createWebHistory } from 'vue-router';

// The signed-in app's pages are chosen by AppShell from :tab, so access rules
// live in one place. Public pages need no session.
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/privacy-policy', component: () => import('./views/public/PrivacyPolicy.vue'), meta: { public: true } },
    { path: '/training-lookup', component: () => import('./views/public/TrainingLookup.vue'), meta: { public: true } },
    { path: '/clp-registration', component: () => import('./views/public/ClpRegistration.vue'), meta: { public: true } },
    { path: '/:tab?', component: () => import('./layouts/AppShell.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

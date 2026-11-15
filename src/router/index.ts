import { createRouter, createWebHashHistory } from 'vue-router';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      // 开屏不再停在项目列表：直接进编辑器（上次项目 → 最近修改 → 新建）。
      path: '/',
      name: 'Home',
      component: () => import('@/views/HomeView.vue'),
    },
    {
      path: '/editor/:id',
      name: 'Editor',
      component: () => import('@/App.vue'),
    },
    {
      path: '/docs',
      name: 'Docs',
      component: () => import('@/views/DocsView.vue'),
    },
  ],
});

export default router;

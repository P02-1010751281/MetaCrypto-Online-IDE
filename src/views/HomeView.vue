<template>
  <div class="home-boot" aria-live="polite">
    <span class="home-spinner" aria-hidden="true" />
    <p class="home-text">{{ message }}</p>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { indexedDbProjectStore } from '@/services/projects/indexedDbProjectStore';
import type { ProjectRecord } from '@/services/projects/ProjectStore';
import { ui } from '@/composables/locale';

/**
 * 开屏不再停在项目列表：直接进入编辑器。
 *
 * 选择项目的顺序是「上次打开的项目 → 最近修改的项目 → 新建一个」。
 * 项目列表仍然存在，路径是 `/projects`，从编辑器侧栏的返回键进入。
 */

const LAST_PROJECT_KEY = 'ciphercat:last-project';

const router = useRouter();
const message = ref(ui('openingProject'));

onMounted(async () => {
  try {
    const lastId = Number(window.localStorage.getItem(LAST_PROJECT_KEY));
    if (Number.isFinite(lastId) && lastId > 0) {
      const last = await indexedDbProjectStore.get(lastId);
      if (last) {
        await router.replace(`/editor/${lastId}`);
        return;
      }
    }

    const all = await indexedDbProjectStore.list();
    if (all.length > 0) {
      const newest = [...all].sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )[0];
      if (newest?.id !== undefined) {
        await router.replace(`/editor/${newest.id}`);
        return;
      }
    }

    const now = new Date().toISOString();
    const record: ProjectRecord = {
      name: ui('unnamed'),
      workspace: '',
      format: 'xml',
      language: 'python',
      createdAt: now,
      updatedAt: now,
    };
    const id = await indexedDbProjectStore.save(record);
    await router.replace(`/editor/${id}`);
  } catch (err) {
    // 读取失败（存储被禁用/配额满）时退回项目列表，让用户能自己处理。
    console.error('打开项目失败，退回项目列表:', err);
    await router.replace('/projects');
  }
});
</script>

<style scoped>
.home-boot {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-md);
  color: var(--color-text-secondary);
  background: var(--color-bg);
}

.home-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: home-spin 0.8s linear infinite;
}

.home-text {
  margin: 0;
  font-size: 13px;
}

@keyframes home-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

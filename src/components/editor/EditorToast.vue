<template>
  <Transition name="toast">
    <div v-if="visible" class="toast">{{ message }}</div>
  </Transition>
</template>

<script setup lang="ts">
defineProps<{ visible: boolean; message: string }>();
</script>

<style scoped>
.toast {
  position: fixed;
  /* 顶部已被侧栏横条/面包屑/工具栏占满，提示固定在底部状态栏之上，不遮挡任何控件。 */
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 20px;
  background: var(--color-primary);
  color: #fff;
  border-radius: 6px;
  font-size: 13px;
  z-index: 1000;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  pointer-events: none;
}

.toast-enter-active {
  transition: all 0.25s ease-out;
}

.toast-leave-active {
  transition: all 0.2s ease-in;
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(4px);
}
</style>

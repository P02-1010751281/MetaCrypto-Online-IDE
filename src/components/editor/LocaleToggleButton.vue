<template>
  <!-- 语言切换是全局偏好（同一个 blocklyLocale），编辑器顶栏与文档中心各有一个入口。
       抽成共用组件后两处的显示逻辑只在这里定义一次。 -->
  <button @click="$emit('toggle')">
    {{ targetLabel }}
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { useBlocklyLocale } from '@/composables/locale';

defineEmits<{ toggle: [] }>();

const blocklyLocale = useBlocklyLocale();

/** 按钮显示的是「切过去之后」的语言：中文界面显示 EN，英文界面显示 中文。 */
const targetLabel = computed(() =>
  blocklyLocale.getCurrentLocale() === 'zh-hans' ? 'EN' : '中文',
);
</script>

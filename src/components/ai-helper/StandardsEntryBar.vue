<template>
  <!-- A 线入口的「选哪一份」：条目列表 + 没选中时的引导 + 文件核对。
       为什么从面板里拆出来：面板本体已经贴着 500 行上限，而且这一块的三件事
       （选、提示、核对）都不碰判据渲染。 -->
  <div class="stw-entry">
    <div class="stw-standards" role="tablist" :aria-label="ui('standardsToWorkspace')">
      <button
        v-for="item in standards"
        :key="item.id"
        type="button"
        role="tab"
        class="stw-standard"
        :class="{ active: item.id === activeId }"
        :aria-selected="item.id === activeId"
        @click="select(item.id)"
      >
        <span class="stw-standard-name">{{ item.name }}</span>
        <span class="stw-standard-meta">{{ item.version ? `${item.version} · ` : '' }}{{ item.checkedAt }}</span>
      </button>
    </div>

    <p v-if="note" class="stw-entry-note stw-entry-note--match" :class="`stw-entry-note--${note.tone}`">{{ note.text }}</p>
    <p v-if="!activeId" class="stw-entry-empty">{{ ui('stwPickHint') }}</p>

    <div class="stw-verify">
      <button type="button" class="stw-btn" :disabled="verify.kind === 'reading'" @click="openPicker">
        {{ verify.kind === 'reading' ? ui('stwVerifyReading') : ui('stwVerifyPick') }}
      </button>
      <input
        ref="fileInput"
        type="file"
        class="stw-verify-input"
        accept=".pdf,.md,.markdown,.txt,.tex,.doc,.docx,.rst"
        @change="onFile"
      />
      <p v-if="verifyText" class="stw-verify-result" :class="`stw-verify-result--${verify.kind}`">{{ verifyText }}</p>
    </div>
    <p class="stw-entry-note stw-entry-note--hint">{{ ui('stwVerifyHint') }}</p>
  </div>
</template>

<script setup lang="ts">
/**
 * 选条目与文件核对。核对只比字节：拿本地文件算 sha256，与登记原文的哈希比对。
 *
 * 不比正文相似度——正文相似只能说明「像」，字节相同才说明「就是这一份」。
 * 核对通过时顺带选中该条并告知「判据对它成立」；不通过时明确说不符，
 * 而不是退化成「大概选一条」。
 */
import { computed, ref } from 'vue';

import { ui, uiFormat } from '@/composables/locale';
import type { EntryNote, EntryStandard } from '@/services/ai-helper/standards-entry';

const props = defineProps<{
  standards: readonly EntryStandard[];
  activeId: string;
  note?: EntryNote | null;
}>();

const emit = defineEmits<{ (e: 'select', id: string): void }>();

/** 核对上限：登记原文都是几 MB 的 PDF/文本，超过 32 MB 多半选错了文件。 */
const MAX_FILE_BYTES = 32 * 1024 * 1024;

type VerifyState =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'ok'; id: string; hash: string }
  | { kind: 'mismatch'; hash: string; count: number }
  | { kind: 'error'; message: string };

const fileInput = ref<HTMLInputElement | null>(null);
const verify = ref<VerifyState>({ kind: 'idle' });

const verifyText = computed(() => {
  const state = verify.value;
  if (state.kind === 'ok') {
    return uiFormat('stwVerifyOk', { hash: state.hash.slice(0, 12) });
  }
  if (state.kind === 'mismatch') {
    return uiFormat('stwVerifyMismatch', { hash: state.hash.slice(0, 12), count: state.count });
  }
  if (state.kind === 'error') {
    return uiFormat('stwVerifyFailed', { message: state.message });
  }
  return '';
});

function select(id: string): void {
  verify.value = { kind: 'idle' };
  emit('select', id);
}

function openPicker(): void {
  verify.value = { kind: 'idle' };
  fileInput.value?.click();
}

/** 摘要走 WebCrypto 的 SHA-256；结果是 32 字节，转小写十六进制对齐登记格式。 */
async function digestHex(bytes: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function onFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  const hashed = props.standards.filter((item) => item.sha256);
  if (hashed.length === 0) {
    verify.value = { kind: 'error', message: ui('stwVerifyNoHash') };
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    verify.value = {
      kind: 'error',
      message: uiFormat('stwVerifyTooBig', { mb: Math.round(MAX_FILE_BYTES / 1024 / 1024) }),
    };
    return;
  }

  verify.value = { kind: 'reading' };
  try {
    const hash = await digestHex(await file.arrayBuffer());
    const hit = hashed.find((item) => (item.sha256 ?? '').toLowerCase() === hash);
    if (hit) {
      verify.value = { kind: 'ok', id: hit.id, hash };
      emit('select', hit.id);
      return;
    }
    verify.value = { kind: 'mismatch', hash, count: hashed.length };
  } catch (cause) {
    verify.value = { kind: 'error', message: (cause as Error).message };
  }
}
</script>

<style scoped src="./standards-entry-bar.css"></style>

<template>
  <aside class="editor-sidebar">
    <header class="sidebar-head">
      <button class="icon-btn" :title="ui('back')" @click="$emit('back')">←</button>
      <input
        class="project-name"
        :value="projectName"
        :placeholder="ui('projectName')"
        @input="$emit('update:projectName', ($event.target as HTMLInputElement).value)"
      />
      <span class="save-state" :class="saveStatus" :title="saveStateLabel">{{ saveStateDot }}</span>
    </header>

    <section class="sidebar-section files-section">
      <div class="section-head">
        <span class="section-title">{{ ui('files') }}</span>
        <button class="ghost-btn" :title="ui('newFile')" @click="$emit('add-file')">＋</button>
      </div>
      <ul class="file-list">
        <li
          v-for="file in files"
          :key="file.fileId"
          class="file-row"
          :class="{ active: file.fileId === activeFileId }"
          @click="$emit('select-file', file.fileId)"
        >
          <template v-if="editingId === file.fileId">
            <input
              ref="renameInput"
              v-model="editingName"
              class="rename-input"
              @keydown.enter.prevent="commitRename(file.fileId)"
              @keydown.esc.prevent="cancelRename"
              @blur="commitRename(file.fileId)"
              @click.stop
            />
          </template>
          <template v-else>
            <span class="file-label">
              <span class="file-name" :title="file.name">{{ file.name }}</span>
              <span v-if="file.fileId === entryFileId" class="entry-badge">{{ ui('entryFile') }}</span>
            </span>
            <div class="file-actions" @click.stop>
              <button
                v-if="file.fileId !== entryFileId"
                class="row-btn"
                :title="ui('setEntryFile')"
                @click="$emit('set-entry', file.fileId)"
              >◎</button>
              <button class="row-btn" :title="ui('renameFile')" @click="startRename(file.fileId, file.name)">✎</button>
              <button
                class="row-btn danger"
                :title="pendingDeleteId === file.fileId ? ui('deleteFileConfirm') : ui('deleteFile')"
                :class="{ confirming: pendingDeleteId === file.fileId }"
                @click="requestDelete(file.fileId)"
              >{{ pendingDeleteId === file.fileId ? '!' : '✕' }}</button>
            </div>
          </template>
        </li>
      </ul>
      <p v-if="fileCountHint" class="section-hint">{{ fileCountHint }}</p>
    </section>

    <section class="sidebar-section panels-section">
      <div class="section-head">
        <span class="section-title">{{ ui('panels') }}</span>
      </div>
      <button
        class="panel-toggle"
        :class="{ active: functionsOpen }"
        :aria-pressed="functionsOpen"
        :title="ui('functionsPanel')"
        @click="$emit('toggle-functions')"
      >
        <span>{{ ui('functionsPanel') }}</span>
        <span class="toggle-indicator" :class="{ on: functionsOpen }" aria-hidden="true" />
      </button>
      <button
        class="panel-toggle"
        :class="{ active: docSearchOpen }"
        :aria-pressed="docSearchOpen"
        :title="ui('docSearch')"
        @click="$emit('toggle-doc-search')"
      >
        <span>{{ ui('docSearch') }}</span>
        <span class="toggle-indicator" :class="{ on: docSearchOpen }" aria-hidden="true" />
      </button>
    </section>

    <div class="sidebar-panels">
      <slot />
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import type { ProjectFileRecord } from '@/services/projects/ProjectStore';
import { ui } from '@/composables/locale';

const props = defineProps<{
  projectName: string;
  saveStatus: 'saved' | 'unsaved' | 'error';
  files: ProjectFileRecord[];
  activeFileId: string;
  entryFileId: string;
  functionsOpen: boolean;
  docSearchOpen: boolean;
}>();

const emit = defineEmits<{
  (e: 'back'): void;
  (e: 'update:projectName', value: string): void;
  (e: 'select-file', fileId: string): void;
  (e: 'add-file'): void;
  (e: 'rename-file', fileId: string, name: string): void;
  (e: 'delete-file', fileId: string): void;
  (e: 'set-entry', fileId: string): void;
  (e: 'toggle-functions'): void;
  (e: 'toggle-doc-search'): void;
}>();

const saveStateDot = computed(() =>
  props.saveStatus === 'saved' ? '●' : props.saveStatus === 'error' ? '!' : '○',
);
const saveStateLabel = computed(() =>
  props.saveStatus === 'saved'
    ? ui('saved')
    : props.saveStatus === 'error'
      ? ui('saveError')
      : ui('unsaved'),
);
const fileCountHint = computed(() =>
  props.files.length <= 1 ? ui('keepOneFile') : '',
);

const editingId = ref('');
const editingName = ref('');
const renameInput = ref<HTMLInputElement[] | HTMLInputElement | null>(null);
const pendingDeleteId = ref('');
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

async function startRename(fileId: string, name: string): Promise<void> {
  editingId.value = fileId;
  editingName.value = name;
  await nextTick();
  const el = Array.isArray(renameInput.value) ? renameInput.value[0] : renameInput.value;
  el?.focus();
  el?.select();
}

function commitRename(fileId: string): void {
  if (editingId.value !== fileId) return;
  const name = editingName.value.trim();
  editingId.value = '';
  if (name) emit('rename-file', fileId, name);
}

function cancelRename(): void {
  editingId.value = '';
}

/** 删除是两级确认：第一次点击进入待确认，3 秒内再点才真正删除。 */
function requestDelete(fileId: string): void {
  if (pendingDeleteId.value === fileId) {
    pendingDeleteId.value = '';
    if (pendingTimer) clearTimeout(pendingTimer);
    emit('delete-file', fileId);
    return;
  }
  pendingDeleteId.value = fileId;
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    pendingDeleteId.value = '';
  }, 3000);
}
</script>

<style scoped src="./editor-sidebar.css"></style>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { AppError, txnService } from '../api';
const props = defineProps<{ transactionId: string; transactionTitle?: string }>();
const emit = defineEmits<{ finish: [editUrl?: string] }>();
const dialog = ref<HTMLDialogElement | null>(null);
const state = ref<'confirm' | 'syncing' | 'failed' | 'success'>('confirm');
const error = ref('');
const editUrl = ref('');
const primary = ref<HTMLButtonElement | null>(null);
const heading = computed(() => ({ confirm: '是否同步到 FabricWorld？', syncing: '正在添加布料', failed: '添加未成功，是否重试？', success: '添加成功，是否前往 FabricWorld？' }[state.value]));
onMounted(() => dialog.value?.showModal());
onUnmounted(() => dialog.value?.close());
function dismiss(): void { if (state.value !== 'syncing') emit('finish'); }
async function accept(): Promise<void> {
  if (state.value === 'syncing') return;
  if (state.value === 'success') { emit('finish', editUrl.value); return; }
  state.value = 'syncing';
  try {
    const result = await txnService.syncFabricWorld(props.transactionId);
    if (!/^[a-f0-9]{32}$/.test(result.fabricId) || result.editUrl !== `/fabricworld/fabrics/${result.fabricId}/edit`) throw new Error('invalid result');
    editUrl.value = result.editUrl;
    state.value = 'success';
  } catch (e) {
    error.value = e instanceof AppError && ['VALIDATION', 'FABRICWORLD'].includes(e.code) ? e.message : '暂未收到添加确认。重试会核对同一笔交易，避免重复添加布料。';
    state.value = 'failed';
  }
  await nextTick();
  primary.value?.focus();
}
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="fabric-sync" aria-labelledby="fabric-sync-title" aria-describedby="fabric-sync-message" @cancel.prevent="dismiss" @keydown.stop>
      <div aria-live="polite" aria-atomic="true">
        <h3 id="fabric-sync-title">{{ heading }}</h3>
        <p v-if="transactionTitle" class="transaction-title">{{ transactionTitle }}</p>
        <p id="fabric-sync-message">
          <template v-if="state === 'confirm'">交易已保存。将用交易日期、金额和标题新建布料，其余资料稍后补充。</template>
          <template v-else-if="state === 'syncing'">正在等待服务器确认，请稍候…</template>
          <template v-else-if="state === 'failed'">{{ error }} 交易已经保存。</template>
          <template v-else>布料已保存。前往编辑页后可直接拍照、补充详细信息。</template>
        </p>
      </div>
      <div v-if="state !== 'syncing'" class="fabric-sync-actions">
        <button class="btn btn-secondary" @click="dismiss">否，返回记账</button>
        <button ref="primary" class="btn btn-primary" @click="accept">{{ state === 'confirm' ? '是，同步' : state === 'failed' ? '是，重试' : '是，前往编辑' }}</button>
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.fabric-sync { margin: auto; width: min(420px, calc(100% - 32px)); max-height: calc(100dvh - 32px); overflow-y: auto; padding: 24px; border: 1px solid var(--border); border-radius: var(--r-lg); background: var(--surface); color: var(--fg); box-shadow: var(--sh-3); }
.fabric-sync::backdrop { background: rgba(0, 0, 0, 0.32); }
.fabric-sync h3 { font-size: 18px; line-height: 1.5; }
.fabric-sync p { margin-top: 12px; color: var(--fg-2); line-height: 1.7; }
.transaction-title { overflow-wrap: anywhere; }
.fabric-sync-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 24px; }
.fabric-sync-actions button { flex: 1 1 auto; }
</style>

<script setup>
import { ChevronDown, ChevronUp, Info, KeyRound, LogIn } from 'lucide-vue-next';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import AppModal from '@/components/AppModal.vue';
import DataTable from '@/components/DataTable.vue';
import LoadingBlock from '@/components/LoadingBlock.vue';
import PageHead from '@/components/PageHead.vue';
import PasswordField from '@/components/PasswordField.vue';
import SearchInput from '@/components/SearchInput.vue';
import { formatDateTime } from '@/lib/data';
import { FAILURE_MESSAGES, fetchOgdChapters, runOgdTestLogin, saveOgdCredential } from '@/lib/ogdApi';

const props = defineProps({ scopes: { type: Array, required: true } });

const COPY = {
  accounts: {
    tab: 'OGD Login', subtitle: 'Set the One Global Data username and password for each chapter.', column: 'OGD Username',
    identifierLabel: 'OGD username', passwordLabel: 'OGD password', hint: 'Username used at cfcglobaldata.com', waiting: 'Waiting for Gmail', type: 'text', maxIdentifier: 50, maxPassword: 50, passwordHint: '',
  },
  sector: {
    tab: 'Gmail', subtitle: "Assign each chapter's Gmail account and check whether it can sign in to OGD.", column: 'Gmail',
    identifierLabel: 'Gmail address', passwordLabel: 'Gmail App Password', hint: 'chapter@gmail.com', waiting: 'Waiting for MSG', type: 'email', maxIdentifier: 254, maxPassword: 40, passwordHint: '16-character App Password',
  },
};
const STATUS = {
  connected: { label: 'Logged in', tone: 'success' }, running: { label: 'Logging in…', tone: 'info' },
  failed: { label: 'Failed', tone: 'danger' }, idle: { label: 'Not tested', tone: '' },
};
const GUIDE_STEPS = [
  { text: "Sign in to the chapter's Gmail account in your browser." },
  { text: 'Turn on 2-Step Verification for that account.', link: 'Open Google Account security', url: 'https://myaccount.google.com/security' },
  { text: 'Go to App Passwords, enter a name such as "OGD Portal", and create it.', link: 'Open App Passwords', url: 'https://myaccount.google.com/apppasswords' },
  { text: 'Copy the 16-character password Google shows. It is displayed only once.' },
  { text: 'In the table below, choose "Set up" on the chapter, then enter the Gmail address and the App Password. Do not use the normal Gmail password.' },
  { text: 'Once MSG has set the OGD Account for that chapter, choose "Test Login".' },
];
const GUIDE_NOTES = [
  'IMAP needs no setup. Gmail keeps it turned on, and this app uses it to read the OTP email.',
  "Changing the Gmail account's password cancels its App Passwords. Create a new one and save it here.",
  'App Passwords may not be available on work or school accounts, or on accounts using Advanced Protection or security keys only.',
];

const scope = ref(props.scopes[0]);
const copy = computed(() => COPY[scope.value]);
const rows = ref([]);
const loadState = reactive({ status: 'loading', message: '' });
const search = ref('');
const isGuideOpen = ref(true);
const editing = ref(null);
const form = reactive({ identifier: '', password: '', error: '', isSaving: false });
const testingIds = ref(new Set());
const notice = ref('');

function setupLabel(row) {
  if (!row.ownConfigured) return 'Not set';
  return row.otherConfigured ? 'Ready' : copy.value.waiting;
}

const columns = computed(() => [
  { key: 'sector', label: 'Sector' },
  { key: 'chapter', label: 'Chapter' },
  { key: 'identifier', label: copy.value.column },
  { key: 'setup', label: 'Setup', value: setupLabel },
  { key: 'status', label: 'OGD Status', value: (row) => STATUS[row.status].label },
  { key: 'lastAttemptAt', label: 'Last Attempt' },
  { key: 'actions', label: 'Actions', action: true },
]);

const visibleRows = computed(() => {
  const query = search.value.trim().toLowerCase();
  return query ? rows.value.filter((row) => [row.sector, row.cluster, row.chapter, row.identifier].some((value) => value?.toLowerCase().includes(query))) : rows.value;
});

let loadToken = 0;
async function load() {
  const token = ++loadToken;
  try {
    const chapters = await fetchOgdChapters(scope.value);
    if (token !== loadToken) return;
    rows.value = chapters;
    Object.assign(loadState, { status: 'success', message: '' });
  } catch (error) {
    if (token === loadToken) Object.assign(loadState, { status: 'error', message: error.message });
  }
}

watch(scope, () => {
  Object.assign(loadState, { status: 'loading', message: '' });
  rows.value = [];
  load();
});

function openEdit(row) {
  editing.value = row;
  Object.assign(form, { identifier: row.identifier ?? '', password: '', error: '', isSaving: false });
}

async function saveCredential() {
  if (!form.identifier.trim() || !form.password) {
    form.error = 'Please fill in both fields.';
    return;
  }
  form.isSaving = true;
  form.error = '';
  try {
    await saveOgdCredential({ scope: scope.value, areaId: editing.value.areaId, identifier: form.identifier, password: form.password });
    editing.value = null;
    load();
  } catch (error) {
    form.error = error.message;
  } finally {
    form.isSaving = false;
  }
}

function setTesting(areaId, isTesting) {
  const next = new Set(testingIds.value);
  if (isTesting) next.add(areaId);
  else next.delete(areaId);
  testingIds.value = next;
}

async function testLogin(row) {
  notice.value = '';
  setTesting(row.areaId, true);
  rows.value = rows.value.map((item) => (item.areaId === row.areaId ? { ...item, status: 'running', failureCode: null, statusDetail: null } : item));
  try {
    await runOgdTestLogin({ scope: scope.value, areaId: row.areaId });
  } catch (error) {
    notice.value = `${row.chapter}: ${error.message}`;
  } finally {
    setTesting(row.areaId, false);
    load();
  }
}

onMounted(load);
</script>

<template>
  <div class="page">
    <PageHead title="OGD Accounts" :subtitle="copy.subtitle" />
    <div v-if="scopes.length > 1" class="tabs" role="tablist">
      <button v-for="item in scopes" :key="item" class="tab" :class="{ active: item === scope }" role="tab" :aria-selected="item === scope" @click="scope = item">{{ COPY[item].tab }}</button>
    </div>

    <section v-if="scope === 'sector'" class="card guide">
      <button class="guide-head" :aria-expanded="isGuideOpen" @click="isGuideOpen = !isGuideOpen">
        <Info :size="18" /><span class="grow">How to connect a chapter's Gmail (App Password + IMAP)</span><component :is="isGuideOpen ? ChevronUp : ChevronDown" :size="16" />
      </button>
      <div v-if="isGuideOpen" class="guide-body">
        <ol>
          <li v-for="step in GUIDE_STEPS" :key="step.text">{{ step.text }}<a v-if="step.link" :href="step.url" target="_blank" rel="noopener noreferrer">{{ step.link }}</a></li>
        </ol>
        <p class="strong small">Good to know</p>
        <ul><li v-for="note in GUIDE_NOTES" :key="note">{{ note }}</li></ul>
      </div>
    </section>

    <SearchInput v-model="search" placeholder="Search sector, chapter, or account..." />
    <p v-if="notice" class="notice error">{{ notice }}</p>

    <section class="card">
      <LoadingBlock v-if="loadState.status === 'loading'" />
      <div v-else-if="loadState.status === 'error'" class="card-pad stack">
        <p class="text-danger">{{ loadState.message }}</p>
        <div><button class="btn btn-sm" @click="load">Try again</button></div>
      </div>
      <DataTable v-else :columns="columns" :rows="visibleRows" row-key="areaId" :initial-sort="{ key: 'sector', ascending: true }" :empty-text="rows.length ? 'No chapters match your search.' : 'No chapters are assigned to your account yet.'">
        <template #cell-sector="{ value }">{{ value || '—' }}</template>
        <template #cell-chapter="{ value }"><span class="strong">{{ value }}</span></template>
        <template #cell-identifier="{ value }">{{ value || 'Not set' }}</template>
        <template #cell-status="{ row }">
          <div class="status">
            <span class="pill" :class="STATUS[row.status].tone">{{ STATUS[row.status].label }}</span>
            <p v-if="row.status === 'failed' && FAILURE_MESSAGES[row.failureCode]" class="small text-danger">{{ FAILURE_MESSAGES[row.failureCode] }}</p>
            <p v-if="row.statusDetail" class="muted tiny">{{ row.statusDetail }}</p>
            <p v-if="row.lastSuccessAt" class="muted tiny">Last success: {{ formatDateTime(row.lastSuccessAt) }}</p>
          </div>
        </template>
        <template #cell-lastAttemptAt="{ value }"><span class="nowrap">{{ formatDateTime(value) }}</span></template>
        <template #cell-actions="{ row }">
          <div class="row">
            <button class="link-btn" @click="openEdit(row)"><KeyRound :size="13" />{{ row.ownConfigured ? 'Change' : 'Set up' }}</button>
            <span v-if="testingIds.has(row.areaId)" class="spinner sm" role="status" aria-label="Testing login" />
            <button v-else-if="row.ownConfigured && row.otherConfigured && row.status !== 'running'" class="link-btn" @click="testLogin(row)"><LogIn :size="13" />Test Login</button>
          </div>
        </template>
      </DataTable>
    </section>

    <AppModal v-if="editing" :title="editing.chapter" :subtitle="editing.sector || ''" :locked="form.isSaving" @close="editing = null">
      <form class="stack" @submit.prevent="saveCredential">
        <label class="field"><span class="field-label">{{ copy.identifierLabel }}</span><input v-model="form.identifier" class="input" :type="copy.type" :placeholder="copy.hint" :maxlength="copy.maxIdentifier" autocapitalize="none" autocomplete="off" spellcheck="false" /></label>
        <PasswordField v-model="form.password" :label="copy.passwordLabel" :placeholder="editing.ownConfigured ? 'Enter the password again to save' : copy.passwordHint" :maxlength="copy.maxPassword" autocomplete="new-password" />
        <p class="muted small">Stored encrypted and used only to sign this chapter in to OGD. It can't be viewed again after saving.</p>
        <p v-if="form.error" class="small text-danger">{{ form.error }}</p>
        <div class="row actions">
          <button type="button" class="btn" :disabled="form.isSaving" @click="editing = null">Cancel</button>
          <button class="btn btn-primary" :disabled="form.isSaving">{{ form.isSaving ? 'Saving…' : 'Save' }}</button>
        </div>
      </form>
    </AppModal>
  </div>
</template>

<style scoped>
.guide { background: var(--accent-soft); box-shadow: none; }
.guide-head { width: 100%; display: flex; align-items: center; gap: 8px; padding: 13px 16px; border: 0; background: none; font-size: 13.5px; font-weight: 650; text-align: left; }
.guide-body { padding: 0 16px 14px; font-size: 13px; color: var(--ink-2); display: grid; gap: 8px; }
ol, ul { margin: 0; padding-left: 20px; display: grid; gap: 6px; }
.guide-body a { display: block; font-weight: 600; }
.status { text-align: left; min-width: 150px; }
.tiny { font-size: 11px; margin-top: 2px; }
.actions { justify-content: flex-end; }
</style>

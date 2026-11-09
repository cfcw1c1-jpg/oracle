<script setup>
import { CircleAlert } from 'lucide-vue-next';
import { onMounted, reactive, ref } from 'vue';
import LoadingBlock from '@/components/LoadingBlock.vue';
import { formatDateTime, showAlert } from '@/lib/data';
import { supabase } from '@/lib/supabase';

const FIELDS = [
  { key: 'min_ios_version', label: 'Minimum iOS Version', help: "Leave blank to never gate iOS. Must match app.json's version format (e.g. 1.4.0).", placeholder: 'e.g. 1.4.0' },
  { key: 'ios_store_url', label: 'iOS App Store URL', help: 'Opened when someone taps “Update Now” on iOS.', placeholder: 'https://apps.apple.com/app/id...' },
  { key: 'min_android_version', label: 'Minimum Android Version', help: 'Leave blank to never gate Android.', placeholder: 'e.g. 1.4.0' },
  { key: 'android_store_url', label: 'Android Play Store URL', help: 'Opened when someone taps “Update Now” on Android.', placeholder: 'https://play.google.com/store/apps/details?id=...' },
  { key: 'update_message', label: 'Custom Message (optional)', help: 'Shown in the update prompt instead of the default wording.', placeholder: 'A new version is required to continue...' },
];

const form = reactive(Object.fromEntries(FIELDS.map((field) => [field.key, ''])));
const updatedAt = ref(null);
const isLoading = ref(true);
const isSaving = ref(false);

async function load() {
  isLoading.value = true;
  try {
    const { data, error } = await supabase.from('app_version_requirements').select('min_ios_version, min_android_version, ios_store_url, android_store_url, update_message, updated_at').eq('id', true).maybeSingle();
    if (error) throw error;
    if (data) {
      FIELDS.forEach((field) => {
        form[field.key] = data[field.key] || '';
      });
      updatedAt.value = data.updated_at;
    }
  } catch (error) {
    showAlert('Error Loading Settings', error.message);
  } finally {
    isLoading.value = false;
  }
}

async function save() {
  isSaving.value = true;
  try {
    const { data: authData } = await supabase.auth.getUser();
    const values = Object.fromEntries(FIELDS.map((field) => [field.key, form[field.key].trim() || null]));
    const { error } = await supabase.from('app_version_requirements').update({ ...values, updated_by: authData?.user?.id || null, updated_at: new Date().toISOString() }).eq('id', true);
    if (error) throw error;
    showAlert('Saved', 'App update requirements updated. Anyone on an outdated native build (already open, or on next launch) will see the update prompt.');
    load();
  } catch (error) {
    showAlert('Save Failed', error.message);
  } finally {
    isSaving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <LoadingBlock v-if="isLoading" />
  <section v-else class="card card-pad stack">
    <div>
      <h2 class="card-title">App Update</h2>
      <p class="card-sub">Force iOS/Android accounts on an old build to update before they can use the app. The web build always serves the latest version, so this has no effect there.</p>
    </div>
    <p class="notice warn row"><CircleAlert :size="16" />Setting a minimum version blocks every native account below it immediately, with no way to dismiss the prompt except updating. Only raise these after the corresponding build is actually live in the App Store / Play Store.</p>
    <label v-for="field in FIELDS" :key="field.key" class="field">
      <span class="field-label">{{ field.label }}</span>
      <span class="muted small">{{ field.help }}</span>
      <input v-model="form[field.key]" class="input" :placeholder="field.placeholder" autocapitalize="none" spellcheck="false" />
    </label>
    <p v-if="updatedAt" class="muted small">Last updated {{ formatDateTime(updatedAt) }}.</p>
    <div><button class="btn btn-primary" :disabled="isSaving" @click="save">{{ isSaving ? 'Saving…' : 'Save Settings' }}</button></div>
  </section>
</template>

<style scoped>
.warn { background: var(--warning-soft); color: var(--warning); align-items: flex-start; }
.warn svg { flex: none; margin-top: 2px; }
</style>

<script setup>
import { KeyRound } from 'lucide-vue-next';
import { ref } from 'vue';
import PasswordField from '@/components/PasswordField.vue';
import { showAlert } from '@/lib/data';
import { supabase } from '@/lib/supabase';
import { sessionState } from '@/stores/session';

const newPassword = ref('');
const confirmPassword = ref('');
const isSaving = ref(false);

async function handleSubmit() {
  if (!newPassword.value || !confirmPassword.value) {
    showAlert('Missing Information', 'Please fill in both password fields.');
    return;
  }
  if (newPassword.value.length < 6) {
    showAlert('Password Too Short', 'New password must be at least 6 characters.');
    return;
  }
  if (newPassword.value !== confirmPassword.value) {
    showAlert('Passwords Do Not Match', 'New password and confirmation must match.');
    return;
  }
  isSaving.value = true;
  try {
    const { error } = await supabase.auth.updateUser({ password: newPassword.value });
    if (error) throw error;
    sessionState.passwordRecovery = false;
  } catch (error) {
    showAlert('Could Not Set Password', error.message);
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <main class="auth">
    <form class="reset card card-pad stack" @submit.prevent="handleSubmit">
      <span class="icon-chip reset-icon"><KeyRound :size="20" /></span>
      <h1 class="page-title">Set a New Password</h1>
      <p class="muted">Choose a new password for your account to finish resetting it.</p>
      <PasswordField v-model="newPassword" placeholder="New Password" autocomplete="new-password" />
      <PasswordField v-model="confirmPassword" placeholder="Confirm New Password" autocomplete="new-password" />
      <button class="btn btn-primary btn-block" :disabled="isSaving">{{ isSaving ? 'Saving…' : 'Save New Password' }}</button>
    </form>
  </main>
</template>

<style scoped>
.reset { width: 100%; max-width: 400px; }
.reset-icon { width: 48px; height: 48px; }
</style>

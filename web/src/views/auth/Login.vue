<script setup>
import { ChevronRight } from 'lucide-vue-next';
import { ref } from 'vue';
import PasswordField from '@/components/PasswordField.vue';
import { showAlert } from '@/lib/data';
import { supabase } from '@/lib/supabase';

const email = ref('');
const password = ref('');
const isLoading = ref(false);
const isResetting = ref(false);

async function handleLogin() {
  if (isLoading.value) return;
  if (!email.value || !password.value) {
    showAlert('Missing Information', 'Please fill in all fields.');
    return;
  }
  isLoading.value = true;
  try {
    const { error } = await supabase.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
    if (error) showAlert('Authentication Failed', error.message);
  } finally {
    isLoading.value = false;
  }
}

async function handleForgotPassword() {
  const address = email.value.trim();
  if (!address) {
    showAlert('Email Required', 'Please enter your email address above, then choose "Forgot Password".');
    return;
  }
  isResetting.value = true;
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(address, { redirectTo: window.location.origin });
    if (error) throw error;
    showAlert('Check Your Email', `A password reset link has been sent to ${address}.`);
  } catch (error) {
    showAlert('Reset Failed', error.message);
  } finally {
    isResetting.value = false;
  }
}
</script>

<template>
  <main class="auth">
    <div class="auth-panel">
      <section class="auth-brand">
        <span class="auth-mark"><img src="/oracle-logo.png" alt="" /></span>
        <h1 class="auth-title">ORACLE</h1>
        <p class="auth-sub">MEMBERS PORTAL</p>
      </section>
      <div class="auth-divider" />
      <form class="auth-form" @submit.prevent="handleLogin">
        <h2 class="auth-heading">Sign In</h2>
        <label class="field">
          <span class="sr-only">Email Address</span>
          <input v-model="email" class="input" type="email" placeholder="Email Address" autocomplete="email" autocapitalize="none" />
        </label>
        <PasswordField v-model="password" placeholder="Password" autocomplete="current-password" />
        <div class="auth-actions">
          <button type="button" class="auth-forgot" :disabled="isResetting" @click="handleForgotPassword">
            {{ isResetting ? 'Sending…' : 'Forgot Password' }}
          </button>
          <button class="auth-go" :disabled="isLoading">
            <span v-if="isLoading" class="spinner sm on-go" />
            <template v-else>Go <ChevronRight :size="19" /></template>
          </button>
        </div>
      </form>
    </div>
    <RouterLink class="auth-privacy" to="/privacy-policy">Privacy Policy</RouterLink>
  </main>
</template>

<style>
.auth { min-height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; background: var(--bg); }
.auth-panel { width: 100%; max-width: 860px; display: flex; align-items: center; background: var(--surface); border: 1px solid var(--line); border-radius: 22px; box-shadow: var(--shadow-card); padding: 48px; }
.auth-brand { flex: 1; display: flex; flex-direction: column; align-items: center; }
.auth-mark { width: 84px; height: 84px; border-radius: 22px; background: var(--primary); display: flex; align-items: center; justify-content: center; margin-bottom: 16px; }
.auth-mark img { width: 48px; height: 42px; object-fit: contain; }
.auth-title { font-size: 34px; font-weight: 700; letter-spacing: 0.1em; }
.auth-sub { font-size: 12px; font-weight: var(--fw-medium); letter-spacing: 0.16em; color: var(--muted); margin-top: 6px; }
.auth-divider { width: 1px; align-self: stretch; background: var(--line); margin: 0 48px; }
.auth-form { flex: 1; display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.auth-heading { font-size: 24px; font-weight: var(--fw-heading); margin-bottom: 6px; }
.auth-actions { display: flex; align-items: center; justify-content: space-between; margin-top: 4px; }
.auth-forgot { border: 0; background: none; padding: 0; font-size: 13px; color: var(--muted); }
.auth-go { display: inline-flex; align-items: center; justify-content: center; gap: 2px; min-width: 80px; border: 0; background: var(--primary); color: var(--primary-ink); border-radius: var(--radius-sm); padding: 9px 14px; font-weight: var(--fw-heading); }
.spinner.on-go { border-color: rgba(255, 255, 255, 0.35); border-top-color: #fff; }
.auth-privacy { margin-top: 24px; font-size: 12px; font-weight: var(--fw-medium); color: var(--muted); }

/* Phones keep the existing navy sign-in screen. */
@media (max-width: 767.98px) {
  .auth { background: radial-gradient(circle at 22% 18%, rgba(255, 255, 255, 0.1), transparent 55%), linear-gradient(150deg, #002060 0%, #001540 100%); }
  .auth-panel { flex-direction: column; background: none; border: 0; box-shadow: none; padding: 0; max-width: 340px; }
  .auth-brand { flex: none; margin-bottom: 32px; }
  .auth-mark { background: none; border: 1.5px dashed rgba(255, 255, 255, 0.35); border-radius: 50%; }
  .auth-title { color: #fff; }
  .auth-sub { color: rgba(255, 255, 255, 0.75); }
  .auth-divider { width: 60%; height: 1px; align-self: center; flex: none; background: rgba(255, 255, 255, 0.25); margin: 0 0 32px; }
  .auth-form { flex: none; width: 100%; }
  .auth-heading { color: #fff; font-size: 26px; font-weight: 700; }
  .auth-form .input { border: 0; border-radius: 4px; padding: 14px 16px; font-size: 15px; }
  .auth-forgot { color: rgba(255, 255, 255, 0.85); font-style: italic; }
  .auth-go { background: none; font-size: 18px; font-weight: 700; color: #fff; padding: 4px 0 4px 12px; min-width: 0; }
  .auth-privacy { color: rgba(255, 255, 255, 0.55); }
}
</style>

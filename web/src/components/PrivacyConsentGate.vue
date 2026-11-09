<script setup>
import { Mail, ShieldCheck } from 'lucide-vue-next';
import { ref } from 'vue';

defineProps({ purpose: { type: String, required: true } });

// Shared with the previous web build, so people who agreed aren't asked again.
const CONSENT_KEY = 'oracle_privacy_consent_v1';
const MODERATOR_EMAILS = ['jamesryanpatiag@gmail.com', 'markjosephreyes1513@gmail.com', 'bryanmunoz28@yahoo.com', 'bentiung02421@gmail.com'];

function readConsent() {
  try {
    return window.localStorage.getItem(CONSENT_KEY) === 'true';
  } catch {
    return false;
  }
}

const hasAgreed = ref(readConsent());
const isChecked = ref(false);

function agree() {
  hasAgreed.value = true;
  try {
    window.localStorage.setItem(CONSENT_KEY, 'true');
  } catch {
    // Consent still applies for this visit if storage is unavailable.
  }
}
</script>

<template>
  <slot v-if="hasAgreed" />
  <div v-else class="gate">
    <section class="card card-pad stack gate-card">
      <span class="icon-chip gate-icon"><ShieldCheck :size="24" /></span>
      <h1 class="page-title gate-title">Data Privacy Notice</h1>
      <div class="stack gate-text">
        <p>To {{ purpose }}, this page looks up personal information — including your name, Area/Chapter, and Pastoral Formation (PFO) and Christian Life Program (CLP) training history — using the Member ID and Last Name you provide below.</p>
        <p>This information is used only to {{ purpose }}. It is stored with Supabase, our cloud database provider, and is otherwise handled the same way as the rest of CFC's membership records — access is restricted to authorized portal accounts.</p>
        <p>Under the Data Privacy Act of 2012 (RA 10173), you have the right to access, correct, or request deletion of your personal data. For any privacy concerns or requests, contact the moderators below.</p>
        <RouterLink class="strong" to="/privacy-policy">Read the full Privacy Policy</RouterLink>
        <a v-for="email in MODERATOR_EMAILS" :key="email" class="row small strong" :href="`mailto:${email}`"><Mail :size="13" />{{ email }}</a>
      </div>
      <label class="check"><input v-model="isChecked" type="checkbox" />I have read this notice and confirm this is my own record.</label>
      <button class="btn btn-primary btn-block" :disabled="!isChecked" @click="agree">Continue</button>
    </section>
  </div>
</template>

<style scoped>
.gate { min-height: 100%; display: flex; align-items: center; justify-content: center; padding: 20px; background: var(--bg); }
.gate-card { width: 100%; max-width: 600px; }
.gate-icon { width: 48px; height: 48px; border-radius: 50%; align-self: center; }
.gate-title { text-align: center; font-size: 17px; }
.gate-text { font-size: 13px; color: var(--ink-2); }
</style>

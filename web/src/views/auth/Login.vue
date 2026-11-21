<script setup>
import { AlertCircle, ArrowRight, ArrowUpRight, ChevronRight, GraduationCap, ShieldCheck, UserPlus } from 'lucide-vue-next';
import { computed, onBeforeUnmount, ref } from 'vue';
import PasswordField from '@/components/PasswordField.vue';
import { showAlert } from '@/lib/data';
import { supabase } from '@/lib/supabase';

const email = ref('');
const password = ref('');
const isLoading = ref(false);
const isResetting = ref(false);
const errorText = ref('');
const isShaking = ref(false);
const isCapsLockOn = ref(false);

const QUICK_LINKS = [
  { to: '/training-lookup', icon: GraduationCap, title: 'Training Lookup', text: "Check a member's formation progress." },
  { to: '/clp-registration', icon: UserPlus, title: 'CLP Registration', text: 'Sign up for the Christian Life Program.' },
  { to: '/privacy-policy', icon: ShieldCheck, title: 'Privacy Policy', text: 'How Oracle keeps member data safe.' },
];

const greeting = computed(() => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
});

// Shows the message under the form and gives the form a short shake.
function fail(message) {
  errorText.value = message;
  isShaking.value = false;
  requestAnimationFrame(() => {
    isShaking.value = true;
  });
}

async function handleLogin() {
  if (isLoading.value) return;
  errorText.value = '';
  if (!email.value.trim() || !password.value) {
    fail('Please enter your email address and password.');
    return;
  }
  isLoading.value = true;
  try {
    const { error } = await supabase.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
    if (error) fail(error.message);
  } finally {
    isLoading.value = false;
  }
}

async function handleForgotPassword() {
  const address = email.value.trim();
  errorText.value = '';
  if (!address) {
    fail('Enter your email address above, then choose "Forgot password?".');
    return;
  }
  isResetting.value = true;
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(address, { redirectTo: window.location.origin });
    if (error) throw error;
    showAlert('Check Your Email', `A password reset link has been sent to ${address}.`);
  } catch (error) {
    fail(error.message);
  } finally {
    isResetting.value = false;
  }
}

function checkCapsLock(event) {
  if (typeof event.getModifierState === 'function') isCapsLockOn.value = event.getModifierState('CapsLock');
}

// The glow on the navy panel follows the pointer, at most once per frame.
const panel = ref(null);
let frame = 0;
function followPointer(event) {
  if (frame || !panel.value) return;
  const { clientX, clientY } = event;
  frame = requestAnimationFrame(() => {
    frame = 0;
    if (!panel.value) return;
    const box = panel.value.getBoundingClientRect();
    panel.value.style.setProperty('--mx', `${((clientX - box.left) / box.width) * 100}%`);
    panel.value.style.setProperty('--my', `${((clientY - box.top) / box.height) * 100}%`);
  });
}
onBeforeUnmount(() => cancelAnimationFrame(frame));
</script>

<template>
  <main class="auth">
    <div class="auth-card">
      <section class="auth-left">
        <div class="auth-form-wrap">
          <span class="auth-mark"><img src="/oracle-logo.png" alt="" /></span>
          <p class="auth-eyebrow">{{ greeting }}</p>
          <h1 class="auth-title">Welcome back</h1>
          <p class="auth-sub">Sign in to the Oracle members portal.</p>

          <form class="auth-form" :class="{ shake: isShaking }" novalidate @submit.prevent="handleLogin" @animationend="isShaking = false">
            <label class="field">
              <span class="field-label">Email</span>
              <input v-model="email" class="input" type="email" placeholder="you@example.com" autocomplete="email" autocapitalize="none" spellcheck="false" />
            </label>
            <div class="pw-wrap" @keydown="checkCapsLock" @keyup="checkCapsLock">
              <PasswordField v-model="password" label="Password" placeholder="Enter your password" autocomplete="current-password" />
              <Transition name="fade">
                <p v-if="isCapsLockOn" class="caps"><AlertCircle :size="13" />Caps Lock is on</p>
              </Transition>
            </div>

            <div class="auth-row">
              <RouterLink class="auth-text-link" to="/privacy-policy">Privacy Policy</RouterLink>
              <button type="button" class="auth-text-link strong" :disabled="isResetting" @click="handleForgotPassword">
                {{ isResetting ? 'Sending link…' : 'Forgot password?' }}
              </button>
            </div>

            <Transition name="fade">
              <p v-if="errorText" class="auth-error" role="alert"><AlertCircle :size="15" />{{ errorText }}</p>
            </Transition>

            <button class="auth-submit" :disabled="isLoading">
              <span v-if="isLoading" class="spinner sm on-dark" aria-hidden="true" />
              <span>{{ isLoading ? 'Signing in…' : 'Sign In' }}</span>
              <ArrowRight v-if="!isLoading" :size="17" class="auth-submit-arrow" />
            </button>
          </form>
        </div>

        <a class="credit-pill" href="https://defyne.solutions/" target="_blank" rel="noopener" aria-label="Developed and donated by Defyne Corporation (opens in a new tab)">
          <span>Developed &amp; donated by</span>
          <img src="/defyne-logo.png" alt="" width="84" height="26" />
        </a>
      </section>

      <section ref="panel" class="auth-right" aria-label="Quick links" @pointermove="followPointer">
        <div class="aurora" aria-hidden="true"><span class="blob one" /><span class="blob two" /><span class="blob three" /></div>
        <div class="spotlight" aria-hidden="true" />
        <div class="grid-lines" aria-hidden="true" />

        <div class="panel-body">
          <p class="panel-eyebrow">ORACLE · MEMBERS PORTAL</p>
          <h2 class="panel-title">Everything for our community, in one place.</h2>
          <ul class="links">
            <li v-for="(link, index) in QUICK_LINKS" :key="link.to" :style="{ '--i': index }">
              <RouterLink :to="link.to" class="link">
                <span class="link-icon"><component :is="link.icon" :size="18" /></span>
                <span class="link-text">
                  <strong>{{ link.title }}</strong>
                  <small>{{ link.text }}</small>
                </span>
                <ChevronRight :size="17" class="link-arrow" />
              </RouterLink>
            </li>
            <li :style="{ '--i': QUICK_LINKS.length }">
              <a href="https://defyne.solutions/" target="_blank" rel="noopener" class="link">
                <span class="link-icon"><ArrowUpRight :size="18" /></span>
                <span class="link-text">
                  <strong>Defyne Corporation</strong>
                  <small>The team that built and donated Oracle.</small>
                </span>
                <ChevronRight :size="17" class="link-arrow" />
              </a>
            </li>
          </ul>
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
/* ---------- Page ---------- */
.auth {
  --navy: #002060;
  --navy-deep: #00133d;
  min-height: 100%; display: grid; place-items: center; padding: 32px 20px;
  background: radial-gradient(1200px 600px at 15% 0%, #fff 0%, transparent 60%), var(--bg);
}
.auth-card {
  width: min(1040px, 100%); min-height: 620px; display: grid; grid-template-columns: 1fr 1fr;
  background: var(--surface); border-radius: 26px; overflow: hidden;
  box-shadow: 0 1px 2px rgba(45, 38, 28, 0.04), 0 30px 80px -20px rgba(0, 32, 96, 0.28);
  animation: rise 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

/* ---------- Form side ---------- */
.auth-left { position: relative; display: flex; flex-direction: column; padding: 56px 56px 28px; }
.auth-form-wrap { flex: 1; width: 100%; max-width: 360px; margin: 0 auto; display: flex; flex-direction: column; justify-content: center; }
.auth-mark {
  width: 52px; height: 52px; border-radius: 15px; background: var(--primary); display: grid; place-items: center; margin-bottom: 22px;
  box-shadow: 0 10px 24px -8px rgba(17, 17, 17, 0.45); transition: transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.auth-mark:hover { transform: rotate(-6deg) scale(1.05); }
.auth-mark img { width: 30px; height: 26px; object-fit: contain; }
.auth-eyebrow { font-size: 12px; font-weight: var(--fw-medium); letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); }
.auth-title { font-size: 32px; font-weight: 600; letter-spacing: -0.02em; margin-top: 4px; color: var(--ink); }
.auth-sub { font-size: 14px; color: var(--muted); margin-top: 6px; }

.auth-form { display: flex; flex-direction: column; gap: 16px; margin-top: 30px; }
.auth-form :deep(.input) { height: 46px; padding: 0 14px; font-size: 14.5px; border-radius: 11px; background: #fdfcfa; transition: border-color 0.2s, box-shadow 0.2s, background 0.2s; }
.auth-form :deep(.input:hover) { border-color: #ddd5ca; }
.auth-form :deep(.input:focus) { background: #fff; border-color: var(--navy); box-shadow: 0 0 0 4px rgba(0, 32, 96, 0.1); }
.auth-form :deep(.pw .input) { padding-right: 42px; }
.auth-form :deep(.field-label) { font-size: 12.5px; color: var(--ink-2); }
.pw-wrap { display: flex; flex-direction: column; gap: 6px; }
.caps { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--warning); }

.auth-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: -2px; }
.auth-text-link { border: 0; background: none; padding: 0; font-size: 13px; color: var(--muted); text-decoration: none; position: relative; }
.auth-text-link.strong { color: var(--ink); font-weight: var(--fw-medium); }
.auth-text-link::after { content: ''; position: absolute; left: 0; right: 0; bottom: -2px; height: 1px; background: currentColor; transform: scaleX(0); transform-origin: right; transition: transform 0.3s ease; }
.auth-text-link:hover::after, .auth-text-link:focus-visible::after { transform: scaleX(1); transform-origin: left; }

.auth-error { display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px; border-radius: 10px; background: var(--danger-soft); color: var(--danger); font-size: 13px; line-height: 1.4; }
.auth-error svg { flex: none; margin-top: 1px; }

.auth-submit {
  position: relative; overflow: hidden; height: 48px; display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  border: 0; border-radius: 12px; background: var(--primary); color: var(--primary-ink); font-size: 15px; font-weight: 600;
  box-shadow: 0 12px 24px -12px rgba(17, 17, 17, 0.6); transition: transform 0.15s, box-shadow 0.25s, background 0.25s;
}
.auth-submit::before {
  content: ''; position: absolute; inset: 0; transform: translateX(-120%);
  background: linear-gradient(110deg, transparent 30%, rgba(255, 255, 255, 0.28) 50%, transparent 70%); transition: transform 0.7s ease;
}
.auth-submit:hover:not(:disabled) { background: #000; box-shadow: 0 16px 30px -12px rgba(0, 32, 96, 0.55); }
.auth-submit:hover:not(:disabled)::before { transform: translateX(120%); }
.auth-submit:active:not(:disabled) { transform: translateY(1px) scale(0.99); }
.auth-submit:disabled { opacity: 0.8; cursor: progress; }
.auth-submit-arrow { transition: transform 0.25s ease; }
.auth-submit:hover .auth-submit-arrow { transform: translateX(4px); }

.shake { animation: shake 0.45s cubic-bezier(0.36, 0.07, 0.19, 0.97); }

.credit-pill {
  align-self: flex-start; display: inline-flex; align-items: center; gap: 10px; margin-top: 28px; padding: 8px 14px 8px 16px;
  border-radius: 999px; background: #fff; border: 1px solid var(--line); box-shadow: 0 10px 30px -12px rgba(45, 38, 28, 0.25);
  font-size: 12.5px; font-weight: var(--fw-medium); color: var(--ink-2); text-decoration: none; transition: transform 0.25s, box-shadow 0.25s;
}
.credit-pill:hover { transform: translateY(-2px); box-shadow: 0 16px 36px -14px rgba(0, 32, 96, 0.35); }
.credit-pill:focus-visible { outline: 2px solid var(--navy); outline-offset: 3px; }
.credit-pill img { height: 24px; width: auto; display: block; }

/* ---------- Navy side ---------- */
.auth-right {
  --mx: 30%; --my: 20%;
  position: relative; overflow: hidden; isolation: isolate; display: flex; align-items: center; padding: 56px 52px; color: #fff;
  background: linear-gradient(160deg, var(--navy) 0%, var(--navy-deep) 70%, #000b26 100%);
}
.aurora { position: absolute; inset: -20%; z-index: -3; filter: blur(60px); }
.blob { position: absolute; border-radius: 50%; opacity: 0.55; }
.blob.one { width: 55%; height: 45%; left: 5%; top: 0; background: #3b6fd8; animation: drift-one 18s ease-in-out infinite alternate; }
.blob.two { width: 45%; height: 40%; right: 0; top: 30%; background: var(--accent); opacity: 0.35; animation: drift-two 22s ease-in-out infinite alternate; }
.blob.three { width: 50%; height: 40%; left: 20%; bottom: 0; background: #1d3f8f; animation: drift-one 26s ease-in-out infinite alternate-reverse; }
.spotlight {
  position: absolute; inset: 0; z-index: -2; pointer-events: none;
  background: radial-gradient(420px circle at var(--mx) var(--my), rgba(165, 142, 114, 0.35), rgba(59, 111, 216, 0.12) 40%, transparent 70%);
}
.grid-lines {
  position: absolute; inset: 0; z-index: -1; pointer-events: none;
  background-image: linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: radial-gradient(ellipse at 50% 40%, #000 20%, transparent 75%);
}
.panel-body { width: 100%; max-width: 400px; margin: 0 auto; }
.panel-eyebrow { font-size: 11px; letter-spacing: 0.22em; color: rgba(255, 255, 255, 0.6); animation: fade-up 0.6s 0.2s both; }
.panel-title { font-size: 26px; line-height: 1.25; font-weight: 600; letter-spacing: -0.015em; margin: 12px 0 30px; animation: fade-up 0.6s 0.3s both; }

.links { list-style: none; margin: 0; padding: 0; }
.links li { border-top: 1px solid rgba(255, 255, 255, 0.1); animation: fade-up 0.55s calc(0.4s + var(--i) * 0.08s) both; }
.links li:last-child { border-bottom: 1px solid rgba(255, 255, 255, 0.1); }
.link {
  display: grid; grid-template-columns: 42px 1fr auto; align-items: center; gap: 14px; padding: 14px 10px; margin: 0 -10px;
  border-radius: 12px; color: #fff; text-decoration: none; transition: background 0.25s, transform 0.25s;
}
.link:hover, .link:focus-visible { background: rgba(255, 255, 255, 0.07); transform: translateX(4px); outline: none; }
.link:focus-visible { box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.5); }
.link-icon {
  width: 42px; height: 42px; border-radius: 11px; display: grid; place-items: center;
  background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.12); transition: background 0.3s, border-color 0.3s, box-shadow 0.3s;
}
.link:hover .link-icon { background: linear-gradient(135deg, rgba(165, 142, 114, 0.55), rgba(59, 111, 216, 0.45)); border-color: rgba(255, 255, 255, 0.25); box-shadow: 0 8px 20px -8px rgba(165, 142, 114, 0.7); }
.link-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.link-text strong { font-size: 14px; font-weight: 600; }
.link-text small { font-size: 12.5px; color: rgba(255, 255, 255, 0.62); }
.link-arrow { color: rgba(255, 255, 255, 0.5); transition: transform 0.25s, color 0.25s; }
.link:hover .link-arrow { transform: translateX(3px); color: #fff; }

/* ---------- Motion ---------- */
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s, transform 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; transform: translateY(-4px); }
@keyframes rise { from { opacity: 0; transform: translateY(18px) scale(0.985); } to { opacity: 1; transform: none; } }
@keyframes fade-up { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@keyframes shake { 10%, 90% { transform: translateX(-1px); } 20%, 80% { transform: translateX(3px); } 30%, 50%, 70% { transform: translateX(-6px); } 40%, 60% { transform: translateX(6px); } }
@keyframes drift-one { from { transform: translate(0, 0) scale(1); } to { transform: translate(18%, 12%) scale(1.15); } }
@keyframes drift-two { from { transform: translate(0, 0) scale(1); } to { transform: translate(-20%, -10%) scale(0.9); } }
@media (prefers-reduced-motion: reduce) {
  .auth-card, .panel-eyebrow, .panel-title, .links li, .blob, .shake { animation: none; }
  .auth-submit::before { display: none; }
  .link, .link-arrow, .auth-mark, .credit-pill, .auth-submit-arrow { transition: none; }
}

/* ---------- Smaller screens ---------- */
@media (max-width: 900px) {
  .auth-card { grid-template-columns: 1fr; min-height: 0; max-width: 520px; }
  .auth-left { padding: 40px 32px 24px; }
  .auth-right { padding: 36px 32px; }
  .panel-title { font-size: 22px; margin-bottom: 22px; }
}
@media (max-width: 767.98px) {
  .auth { padding: 20px 16px; background: radial-gradient(circle at 22% 18%, rgba(255, 255, 255, 0.1), transparent 55%), linear-gradient(150deg, #002060 0%, #001540 100%); }
  .auth-card { border-radius: 22px; box-shadow: 0 30px 60px -20px rgba(0, 0, 0, 0.5); }
  .auth-left { padding: 32px 22px 22px; }
  .auth-title { font-size: 28px; }
  .auth-right { padding: 28px 22px; }
  .credit-pill { align-self: center; }
}
</style>

<script setup>
import { Camera } from 'lucide-vue-next';
import { computed, onMounted, reactive, ref } from 'vue';
import LoadingBlock from '@/components/LoadingBlock.vue';
import PageHead from '@/components/PageHead.vue';
import PasswordField from '@/components/PasswordField.vue';
import { showAlert } from '@/lib/data';
import { supabase } from '@/lib/supabase';

const isLoading = ref(true);
const user = ref(null);
const isUploading = ref(false);
const isChanging = ref(false);
const fileInput = ref(null);
const passwords = reactive({ current: '', next: '', confirm: '' });

const email = computed(() => user.value?.email || 'Unknown');
const avatarUrl = computed(() => user.value?.user_metadata?.avatar_url);

function formatDate(value) {
  if (!value) return 'N/A';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

async function loadUser() {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    user.value = data.user;
  } catch (error) {
    console.error('Error loading profile:', error.message);
  } finally {
    isLoading.value = false;
  }
}

async function uploadAvatar(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  isUploading.value = true;
  try {
    const extension = (file.name.split('.').pop() || file.type.split('/').pop() || 'jpg').toLowerCase();
    const path = `${user.value.id}/avatar-${Date.now()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { contentType: file.type || 'image/jpeg', upsert: true });
    if (uploadError) throw uploadError;
    const newUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;

    const { error: updateError } = await supabase.auth.updateUser({ data: { avatar_url: newUrl } });
    if (updateError) throw updateError;
    // Also kept on profiles, since other accounts can't read user metadata.
    const { error: profileError } = await supabase.from('profiles').update({ avatar_url: newUrl }).eq('id', user.value.id);
    if (profileError) throw profileError;

    user.value = { ...user.value, user_metadata: { ...user.value.user_metadata, avatar_url: newUrl } };
    showAlert('Success', 'Profile picture updated.');
  } catch (error) {
    showAlert('Upload Failed', error.message?.toLowerCase().includes('bucket not found') ? 'No "avatars" storage bucket exists yet. In your Supabase project, go to Storage > New bucket, create a public bucket named "avatars", then try again.' : error.message);
  } finally {
    isUploading.value = false;
  }
}

async function changePassword() {
  if (!passwords.current || !passwords.next || !passwords.confirm) {
    showAlert('Missing Information', 'Please fill in all password fields.');
    return;
  }
  if (passwords.next.length < 6) {
    showAlert('Password Too Short', 'New password must be at least 6 characters.');
    return;
  }
  if (passwords.next !== passwords.confirm) {
    showAlert('Passwords Do Not Match', 'New password and confirmation must match.');
    return;
  }
  isChanging.value = true;
  try {
    // updateUser alone doesn't re-check who is at the keyboard.
    const { error: verifyError } = await supabase.auth.signInWithPassword({ email: user.value.email, password: passwords.current });
    if (verifyError) throw new Error('Current password is incorrect.');
    const { error } = await supabase.auth.updateUser({ password: passwords.next });
    if (error) throw error;
    Object.assign(passwords, { current: '', next: '', confirm: '' });
    showAlert('Success', 'Your password has been changed.');
  } catch (error) {
    showAlert('Password Change Failed', error.message);
  } finally {
    isChanging.value = false;
  }
}

onMounted(loadUser);
</script>

<template>
  <LoadingBlock v-if="isLoading" />
  <div v-else class="page">
    <PageHead title="My Profile" subtitle="Manage your account picture and password." />
    <div class="grid grid-2">
      <section class="card card-pad">
        <div class="avatar-area">
          <input ref="fileInput" type="file" accept="image/*" hidden @change="uploadAvatar" />
          <button class="avatar-btn" :disabled="isUploading" aria-label="Change profile picture" @click="fileInput.click()">
            <img v-if="avatarUrl" :src="avatarUrl" class="avatar big" alt="" />
            <span v-else class="avatar big">{{ email.slice(0, 2).toUpperCase() }}</span>
            <span class="camera"><span v-if="isUploading" class="spinner sm on-dark" /><Camera v-else :size="14" /></span>
          </button>
          <p class="muted small">Tap to change profile picture</p>
        </div>
        <dl class="info">
          <div><dt>Email</dt><dd>{{ email }}</dd></div>
          <div><dt>Member Since</dt><dd>{{ formatDate(user?.created_at) }}</dd></div>
          <div><dt>Last Sign-in</dt><dd>{{ formatDate(user?.last_sign_in_at) }}</dd></div>
        </dl>
      </section>

      <form class="card card-pad stack" @submit.prevent="changePassword">
        <h2 class="card-title">Change Password</h2>
        <PasswordField v-model="passwords.current" label="Current Password" placeholder="••••••••" autocomplete="current-password" />
        <PasswordField v-model="passwords.next" label="New Password" placeholder="At least 6 characters" autocomplete="new-password" />
        <PasswordField v-model="passwords.confirm" label="Confirm New Password" placeholder="••••••••" autocomplete="new-password" />
        <button class="btn btn-primary" :disabled="isChanging">{{ isChanging ? 'Updating…' : 'Update Password' }}</button>
      </form>
    </div>
    <RouterLink class="small muted" to="/privacy-policy">Privacy Policy</RouterLink>
  </div>
</template>

<style scoped>
.avatar-area { display: flex; flex-direction: column; align-items: center; gap: 8px; margin-bottom: 18px; }
.avatar-btn { position: relative; border: 0; background: none; padding: 0; }
.avatar.big { width: 92px; height: 92px; font-size: 26px; }
.camera { position: absolute; right: 0; bottom: 0; width: 28px; height: 28px; border-radius: 50%; background: var(--primary); color: var(--primary-ink); display: flex; align-items: center; justify-content: center; border: 2px solid var(--surface); }
.info { margin: 0; }
.info div { display: flex; justify-content: space-between; gap: 16px; padding: 10px 0; border-top: 1px solid var(--line); font-size: 13px; }
.info dt { color: var(--muted); }
.info dd { margin: 0; font-weight: 600; text-align: right; overflow-wrap: anywhere; }
</style>

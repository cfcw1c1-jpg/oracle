<script setup>
import { ChevronLeft, Image as ImageIcon, MessagesSquare, PenSquare, Send, Users, X } from 'lucide-vue-next';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import AppModal from '@/components/AppModal.vue';
import LoadingBlock from '@/components/LoadingBlock.vue';
import SearchInput from '@/components/SearchInput.vue';
import { searchTerm, showAlert } from '@/lib/data';
import { supabase } from '@/lib/supabase';
import { loadUnreadMessages, sessionState } from '@/stores/session';

defineProps({ onExit: { type: Function, default: null } });

const currentUserId = computed(() => sessionState.session?.user?.id || null);
const conversations = ref([]);
const isLoadingConversations = ref(true);
const selectedId = ref(null);
const messages = ref([]);
const isLoadingMessages = ref(false);
const participants = ref({});
const composeText = ref('');
const isSending = ref(false);
const isNewOpen = ref(false);
const userQuery = ref('');
const userResults = ref([]);
const isStarting = ref(false);
const isStartingGroup = ref(false);
const isUploading = ref(false);
const previewUrl = ref(null);
const scroller = ref(null);
const fileInput = ref(null);
let threadChannel = null;
let inboxChannel = null;

const selected = computed(() => conversations.value.find((conversation) => conversation.conversation_id === selectedId.value) || null);
const totalUnread = computed(() => conversations.value.reduce((sum, conversation) => sum + (conversation.unread_count || 0), 0));

function formatStamp(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function initials(name, email) {
  return (name || email || '?').trim().slice(0, 2).toUpperCase();
}

function conversationName(conversation) {
  return conversation.other_full_name || conversation.other_email || 'Portal User';
}

function senderInfo(senderId) {
  const person = participants.value[senderId] || {};
  return { name: senderId === currentUserId.value ? 'You' : person.full_name || person.email || 'Portal User', email: person.email, avatarUrl: person.avatar_url || null };
}

function seenLabel(message) {
  const names = Object.keys(participants.value)
    .filter((id) => id !== message.sender_id && id !== currentUserId.value)
    .filter((id) => participants.value[id]?.last_read_at && new Date(participants.value[id].last_read_at) >= new Date(message.created_at))
    .map((id) => participants.value[id]?.full_name || participants.value[id]?.email || 'Portal User');
  return names.length ? `Seen by ${names.join(', ')}` : null;
}

async function loadConversations() {
  try {
    const { data, error } = await supabase.rpc('get_my_conversations');
    if (error) throw error;
    conversations.value = data || [];
  } catch (error) {
    showAlert('Error Loading Messages', error.message);
  } finally {
    isLoadingConversations.value = false;
  }
}

async function loadParticipants(conversationId) {
  const { data, error } = await supabase.from('conversation_participants').select('profile_id, last_read_at, profiles ( full_name, email, avatar_url )').eq('conversation_id', conversationId);
  if (error) {
    console.error('Error loading participants:', error.message);
    return;
  }
  participants.value = Object.fromEntries((data || []).map((row) => [row.profile_id, { ...(row.profiles || {}), last_read_at: row.last_read_at }]));
}

async function markAsRead(conversationId) {
  if (!currentUserId.value) return;
  const { error } = await supabase.from('conversation_participants').update({ last_read_at: new Date().toISOString() }).eq('conversation_id', conversationId).eq('profile_id', currentUserId.value);
  if (error) {
    console.error('Error marking conversation read:', error.message);
    return;
  }
  conversations.value = conversations.value.map((conversation) => (conversation.conversation_id === conversationId ? { ...conversation, unread_count: 0 } : conversation));
  loadUnreadMessages();
}

function scrollToEnd() {
  nextTick(() => {
    if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight;
  });
}

async function openConversation(conversationId) {
  selectedId.value = conversationId;
  messages.value = [];
  participants.value = {};
  isLoadingMessages.value = true;
  loadParticipants(conversationId);
  markAsRead(conversationId);
  try {
    const { data, error } = await supabase.from('messages').select('id, conversation_id, sender_id, body, image_url, created_at').eq('conversation_id', conversationId).order('created_at', { ascending: true });
    if (error) throw error;
    if (selectedId.value === conversationId) messages.value = data || [];
  } catch (error) {
    showAlert('Error Loading Conversation', error.message);
  } finally {
    isLoadingMessages.value = false;
  }
}

function clearThreadChannel() {
  if (threadChannel) supabase.removeChannel(threadChannel);
  threadChannel = null;
}

watch(selectedId, (conversationId) => {
  clearThreadChannel();
  if (!conversationId) return;
  threadChannel = supabase
    .channel(`messages_conversation_${conversationId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, (payload) => {
      if (!messages.value.some((message) => message.id === payload.new.id)) messages.value = [...messages.value, payload.new];
      if (payload.new.sender_id !== currentUserId.value) markAsRead(conversationId);
      else loadConversations();
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_participants', filter: `conversation_id=eq.${conversationId}` }, () => loadParticipants(conversationId))
    .subscribe();
});

watch(messages, scrollToEnd);

async function send() {
  const body = composeText.value.trim();
  if (!body || !selectedId.value || !currentUserId.value) return;
  isSending.value = true;
  composeText.value = '';
  try {
    const { error } = await supabase.from('messages').insert([{ conversation_id: selectedId.value, sender_id: currentUserId.value, body }]);
    if (error) throw error;
  } catch (error) {
    showAlert('Send Failed', error.message);
    composeText.value = body;
  } finally {
    isSending.value = false;
  }
}

async function sendImage(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file || !selectedId.value || !currentUserId.value) return;
  isUploading.value = true;
  try {
    const extension = (file.name.split('.').pop() || file.type.split('/').pop() || 'jpg').toLowerCase();
    const path = `${currentUserId.value}/${Date.now()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from('message-images').upload(path, file, { contentType: file.type || 'image/jpeg' });
    if (uploadError) throw uploadError;
    const imageUrl = supabase.storage.from('message-images').getPublicUrl(path).data.publicUrl;
    const { error } = await supabase.from('messages').insert([{ conversation_id: selectedId.value, sender_id: currentUserId.value, body: '', image_url: imageUrl }]);
    if (error) throw error;
  } catch (error) {
    showAlert('Image Send Failed', error.message?.toLowerCase().includes('bucket not found') ? 'No "message-images" storage bucket exists yet. Run scripts/sql/add-message-images.sql against your Supabase project, then try again.' : error.message);
  } finally {
    isUploading.value = false;
  }
}

watch(userQuery, async (query) => {
  const term = searchTerm(query);
  if (term.length < 2) {
    userResults.value = [];
    return;
  }
  const { data, error } = await supabase.from('profiles').select('id, email, full_name, avatar_url').or(`email.ilike.%${term}%,full_name.ilike.%${term}%`).limit(10);
  if (error) console.error('Error searching users:', error.message);
  else userResults.value = (data || []).filter((profile) => profile.id !== currentUserId.value);
});

function closeNew() {
  isNewOpen.value = false;
  userQuery.value = '';
}

async function startConversation(profile) {
  isStarting.value = true;
  try {
    const { data, error } = await supabase.rpc('start_direct_conversation', { other_profile_id: profile.id });
    if (error) throw error;
    closeNew();
    await loadConversations();
    openConversation(data);
  } catch (error) {
    showAlert('Error Starting Conversation', error.message);
  } finally {
    isStarting.value = false;
  }
}

async function startModeratorGroup() {
  isStartingGroup.value = true;
  try {
    const { data, error } = await supabase.rpc('start_moderator_group_conversation');
    if (error) throw error;
    closeNew();
    await loadConversations();
    if (!conversations.value.some((conversation) => conversation.conversation_id === data)) {
      conversations.value = [{ conversation_id: data, is_group: true, other_full_name: 'Moderator Team', last_message_at: new Date().toISOString(), unread_count: 0 }, ...conversations.value];
    }
    openConversation(data);
  } catch (error) {
    showAlert('Error Starting Conversation', error.message);
  } finally {
    isStartingGroup.value = false;
  }
}

onMounted(async () => {
  await loadConversations();
  if (sessionState.pendingConversationId) {
    openConversation(sessionState.pendingConversationId);
    sessionState.pendingConversationId = null;
  }
  inboxChannel = supabase
    .channel('messages_global_inbox')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
      if (payload.new.conversation_id !== selectedId.value) loadConversations();
    })
    .subscribe();
});

onBeforeUnmount(() => {
  clearThreadChannel();
  if (inboxChannel) supabase.removeChannel(inboxChannel);
});
</script>

<template>
  <div class="msg" :class="{ 'in-thread': selectedId }">
    <header class="msg-head">
      <button v-if="onExit" class="icon-btn" aria-label="Back" @click="onExit"><ChevronLeft :size="22" /></button>
      <div class="grow">
        <h1 class="page-title row">Messages <span v-if="totalUnread" class="pill danger">{{ totalUnread }} unread</span></h1>
        <p class="page-sub">Message any portal account directly, across roles.</p>
      </div>
    </header>

    <div class="msg-body">
      <section class="card list">
        <header class="list-head">
          <span class="strong">Conversations</span>
          <button class="btn btn-primary btn-sm" @click="isNewOpen = true"><PenSquare :size="13" />New</button>
        </header>
        <LoadingBlock v-if="isLoadingConversations" />
        <p v-else-if="!conversations.length" class="empty">No conversations yet. Start one with "New".</p>
        <div v-else class="list-scroll">
          <button v-for="conversation in conversations" :key="conversation.conversation_id" class="convo" :class="{ on: conversation.conversation_id === selectedId }" @click="openConversation(conversation.conversation_id)">
            <span v-if="conversation.is_group" class="avatar"><Users :size="16" /></span>
            <img v-else-if="conversation.other_avatar_url" :src="conversation.other_avatar_url" class="avatar" alt="" />
            <span v-else class="avatar">{{ initials(conversation.other_full_name, conversation.other_email) }}</span>
            <span class="grow">
              <span class="row row-between"><span class="strong clamp">{{ conversationName(conversation) }}</span><span class="muted small nowrap">{{ formatStamp(conversation.last_message_at) }}</span></span>
              <span class="row row-between"><span class="muted small clamp">{{ conversation.last_message_sender_id === currentUserId ? 'You: ' : '' }}{{ conversation.last_message_body || (conversation.last_message_image_url ? '📷 Photo' : 'Say hello!') }}</span><span v-if="conversation.unread_count" class="count">{{ conversation.unread_count }}</span></span>
            </span>
          </button>
        </div>
      </section>

      <section class="card thread">
        <div v-if="!selected" class="thread-empty"><MessagesSquare :size="32" /><p>Select a conversation, or start a new one.</p></div>
        <template v-else>
          <header class="thread-head">
            <button class="icon-btn thread-back" aria-label="Back to conversations" @click="selectedId = null"><ChevronLeft :size="20" /></button>
            <span v-if="selected.is_group" class="avatar"><Users :size="16" /></span>
            <img v-else-if="selected.other_avatar_url" :src="selected.other_avatar_url" class="avatar" alt="" />
            <span v-else class="avatar">{{ initials(selected.other_full_name, selected.other_email) }}</span>
            <span class="strong clamp">{{ conversationName(selected) }}</span>
          </header>
          <LoadingBlock v-if="isLoadingMessages" />
          <div v-else ref="scroller" class="thread-scroll">
            <p v-if="!messages.length" class="empty">No messages yet. Say hello!</p>
            <div v-for="(message, index) in messages" :key="message.id" class="bubble-row" :class="{ mine: message.sender_id === currentUserId }">
              <img v-if="senderInfo(message.sender_id).avatarUrl" :src="senderInfo(message.sender_id).avatarUrl" class="avatar sm" alt="" />
              <span v-else class="avatar sm">{{ initials(senderInfo(message.sender_id).name, senderInfo(message.sender_id).email) }}</span>
              <div class="bubble-col">
                <span class="muted tiny">{{ senderInfo(message.sender_id).name }}</span>
                <div class="bubble">
                  <button v-if="message.image_url" class="img-btn" aria-label="View image" @click="previewUrl = message.image_url"><img :src="message.image_url" alt="Sent image" /></button>
                  <p v-if="message.body">{{ message.body }}</p>
                </div>
                <span class="muted tiny">{{ formatStamp(message.created_at) }}</span>
                <span v-if="message.sender_id === currentUserId && index === messages.length - 1 && seenLabel(message)" class="muted tiny">{{ seenLabel(message) }}</span>
              </div>
            </div>
          </div>
          <footer class="compose">
            <input ref="fileInput" type="file" accept="image/*" hidden @change="sendImage" />
            <button class="icon-btn" aria-label="Send an image" :disabled="isUploading" @click="fileInput.click()"><span v-if="isUploading" class="spinner sm" /><ImageIcon v-else :size="20" /></button>
            <textarea v-model="composeText" class="input compose-input" rows="1" placeholder="Type a message..." aria-label="Message" @keydown.enter.exact.prevent="send" />
            <button class="btn btn-primary send" aria-label="Send" :disabled="!composeText.trim() || isSending" @click="send"><Send :size="16" /></button>
          </footer>
        </template>
      </section>
    </div>

    <div v-if="previewUrl" class="preview" role="dialog" aria-label="Image preview" @click.self="previewUrl = null">
      <button class="preview-close" aria-label="Close" @click="previewUrl = null"><X :size="26" /></button>
      <img :src="previewUrl" alt="Full size" />
    </div>

    <AppModal v-if="isNewOpen" title="New Message" @close="closeNew">
      <div class="stack">
        <SearchInput v-model="userQuery" placeholder="Search by name or email..." />
        <button class="btn" :disabled="isStartingGroup" @click="startModeratorGroup"><Users :size="14" />{{ isStartingGroup ? 'Starting…' : 'Message All Moderators' }}</button>
        <LoadingBlock v-if="isStarting" />
        <template v-else>
          <button v-for="profile in userResults" :key="profile.id" class="result" @click="startConversation(profile)">
            <img v-if="profile.avatar_url" :src="profile.avatar_url" class="avatar" alt="" />
            <span v-else class="avatar">{{ initials(profile.full_name, profile.email) }}</span>
            <span class="grow"><span class="strong block clamp">{{ profile.full_name || profile.email }}</span><span v-if="profile.full_name" class="muted small block clamp">{{ profile.email }}</span></span>
          </button>
          <p v-if="userQuery.trim().length >= 2 && !userResults.length" class="muted small">No matching accounts.</p>
        </template>
      </div>
    </AppModal>
  </div>
</template>

<style scoped>
.msg { height: 100%; display: flex; flex-direction: column; padding: var(--page-pad); gap: 14px; }
.msg-head { display: flex; align-items: center; gap: 6px; }
.msg-body { flex: 1; min-height: 0; display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: 18px; }
.list, .thread { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.list-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid var(--line); }
.list-scroll { overflow-y: auto; }
.convo { width: 100%; display: flex; align-items: center; gap: 10px; padding: 11px 16px; border: 0; border-bottom: 1px solid var(--line); background: none; text-align: left; font-size: 13px; }
.convo:hover { background: var(--surface-hover); }
.convo.on { background: var(--accent-soft); }
.count { background: #e5484d; color: #fff; font-size: 10.5px; font-weight: 700; border-radius: 10px; padding: 1px 7px; }
.thread-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--muted); font-size: 13px; }
.thread-head { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--line); }
.thread-back { display: none; }
.thread-scroll { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.bubble-row { display: flex; align-items: flex-end; gap: 8px; }
.bubble-row.mine { flex-direction: row-reverse; }
.avatar.sm { width: 26px; height: 26px; font-size: 10px; }
.bubble-col { display: flex; flex-direction: column; max-width: 70%; gap: 2px; align-items: flex-start; }
.mine .bubble-col { align-items: flex-end; }
.tiny { font-size: 10.5px; }
.bubble { background: var(--surface-soft); border-radius: 14px; padding: 8px 12px; font-size: 13.5px; white-space: pre-wrap; overflow-wrap: anywhere; }
.mine .bubble { background: var(--primary); color: var(--primary-ink); }
.img-btn { border: 0; background: none; padding: 0; display: block; }
.img-btn img { max-width: 240px; max-height: 240px; border-radius: 10px; display: block; }
.compose { display: flex; align-items: flex-end; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--line); }
.compose-input { resize: none; max-height: 110px; }
.send { padding: 9px 12px; }
.preview { position: fixed; inset: 0; z-index: 120; background: rgba(0, 0, 0, 0.88); display: flex; align-items: center; justify-content: center; padding: 20px; }
.preview img { max-width: 100%; max-height: 100%; object-fit: contain; }
.preview-close { position: absolute; top: 14px; right: 14px; border: 0; background: none; color: #fff; }
.result { display: flex; align-items: center; gap: 10px; padding: 8px; border: 0; border-radius: var(--radius-sm); background: none; text-align: left; font-size: 13px; }
.result:hover { background: var(--surface-hover); }
.block { display: block; }
@media (max-width: 819.98px) {
  .msg-body { grid-template-columns: minmax(0, 1fr); }
  .thread { display: none; }
  .in-thread .list { display: none; }
  .in-thread .thread { display: flex; }
  .thread-back { display: inline-flex; }
}
</style>

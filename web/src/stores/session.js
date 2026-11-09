import { reactive, watch } from 'vue';
import { trackPresence } from '@/lib/presence';
import { supabase } from '@/lib/supabase';

export const sessionState = reactive({
  session: null,
  authChecked: false,
  passwordRecovery: false,
  access: null,
  accessLoading: true,
  unreadMessages: 0,
  pendingChangeRequests: 0,
  messageToast: null,
  disclaimerVisible: false,
  landOnAdminDashboard: false,
  pendingConversationId: null,
  activeTab: null,
});

let authListener = null;
let readyTimer = null;
let stopWatchers = [];
let messageChannel = null;
let changeRequestChannel = null;
let stopPresence = null;
let toastTimer = null;

export function canView(pageKey) {
  return Boolean(sessionState.access?.allowedPages?.includes(pageKey));
}

// A role with no profile row or a failed lookup gets no pages, never all pages.
export async function loadAccess(userId = sessionState.session?.user?.id) {
  if (!userId) return;
  try {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, email, full_name, role_id, roles ( id, name )')
      .eq('id', userId)
      .maybeSingle();
    if (profileError) throw profileError;

    let allowedPages = [];
    if (profile?.role_id) {
      const { data, error } = await supabase.from('role_pages').select('page_key').eq('role_id', profile.role_id);
      if (error) throw error;
      allowedPages = (data || []).map((row) => row.page_key);
    }
    const roleName = profile?.roles?.name || null;
    sessionState.access = { profile, roleName, isAdmin: roleName === 'Admin', allowedPages };
  } catch (error) {
    console.error('Error loading access:', error.message);
    sessionState.access = sessionState.access ?? { profile: null, roleName: null, isAdmin: false, allowedPages: [] };
  } finally {
    sessionState.accessLoading = false;
  }
}

export async function loadUnreadMessages() {
  const { data, error } = await supabase.rpc('get_my_conversations');
  if (error) {
    console.error('Error loading unread messages:', error.message);
    return;
  }
  sessionState.unreadMessages = (data || []).reduce((sum, conversation) => sum + (conversation.unread_count || 0), 0);
}

async function loadPendingChangeRequests() {
  const { count, error } = await supabase
    .from('member_change_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  if (error) {
    console.error('Error loading change requests:', error.message);
    return;
  }
  sessionState.pendingChangeRequests = count || 0;
}

function clearToastLater() {
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    sessionState.messageToast = null;
  }, 5000);
}

function subscribeMessages(userId) {
  loadUnreadMessages();
  messageChannel = supabase
    .channel('global_messages_watch')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
      if (payload.new.sender_id === userId) return;
      loadUnreadMessages();
      if (sessionState.activeTab === 'messages') return;
      const { data } = await supabase.from('profiles').select('full_name, email').eq('id', payload.new.sender_id).maybeSingle();
      sessionState.messageToast = { name: data?.full_name || data?.email || 'Someone', body: payload.new.body };
      clearToastLater();
    })
    .subscribe();
}

function clearChannel(channel) {
  if (channel) supabase.removeChannel(channel);
}

function handleUserChange(userId) {
  clearChannel(messageChannel);
  messageChannel = null;
  stopPresence?.();
  stopPresence = null;

  if (!userId) {
    sessionState.access = null;
    sessionState.accessLoading = true;
    sessionState.unreadMessages = 0;
    return;
  }
  loadAccess(userId);
  subscribeMessages(userId);
  stopPresence = trackPresence(userId);
}

function handleChangeQueueAccess(hasAccess) {
  clearChannel(changeRequestChannel);
  changeRequestChannel = null;
  if (!hasAccess) {
    sessionState.pendingChangeRequests = 0;
    return;
  }
  loadPendingChangeRequests();
  changeRequestChannel = supabase
    .channel('global_change_requests_watch')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'member_change_requests' }, loadPendingChangeRequests)
    .subscribe();
}

function applyRecoveryLink() {
  const { hash, pathname, search } = window.location;
  if (!hash.includes('type=recovery')) return;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) return;

  sessionState.passwordRecovery = true;
  supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(({ error }) => {
    if (error) {
      console.error('Error starting password recovery:', error.message);
      sessionState.passwordRecovery = false;
    }
  });
  // Removes the token from the address bar and browser history.
  window.history.replaceState(null, '', pathname + search);
}

export function startSession() {
  applyRecoveryLink();

  stopWatchers = [
    watch(() => sessionState.session?.user?.id, handleUserChange),
    watch(() => canView('memberChangeQueue'), handleChangeQueueAccess),
  ];

  // SIGNED_IN also fires when a stored session is restored on load, so it only
  // counts as a real login once the page has been open a moment.
  let readyForSignIn = false;
  readyTimer = setTimeout(() => {
    readyForSignIn = true;
  }, 500);

  supabase.auth.getSession().then(({ data }) => {
    sessionState.session = data.session;
    sessionState.authChecked = true;
  });

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    // The auth library also reports SIGNED_IN when a browser tab regains focus,
    // so a sign-in only counts when nobody was signed in a moment ago.
    const isNewSignIn = event === 'SIGNED_IN' && !sessionState.session;
    sessionState.session = session;
    sessionState.authChecked = true;
    if (isNewSignIn && readyForSignIn && !sessionState.passwordRecovery) {
      sessionState.disclaimerVisible = true;
      sessionState.landOnAdminDashboard = true;
    }
  });
  authListener = data;
}

export function stopSession() {
  clearTimeout(readyTimer);
  clearTimeout(toastTimer);
  authListener?.subscription?.unsubscribe();
  stopWatchers.forEach((stop) => stop());
  handleUserChange(null);
  handleChangeQueueAccess(false);
}

export function signOut() {
  return supabase.auth.signOut();
}

export function logPageView(tabKey, label) {
  const user = sessionState.session?.user;
  if (!user) return;
  supabase
    .from('audit_log')
    .insert([{ table_name: `page:${tabKey}`, action: 'PAGE_VIEW', actor_id: user.id, actor_email: user.email, new_data: { page: label || tabKey } }])
    .then(({ error }) => {
      if (error) console.error('Error logging page view:', error.message);
    });
}

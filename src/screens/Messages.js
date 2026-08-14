import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { supabase } from '../../lib/supabase';

const NAVY = '#002060';
const ACCENT_BLUE = '#2563eb';
const WIDE_BREAKPOINT = 820;

function showAlert(title, message) {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
}

function formatTimestamp(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getInitials(name, email) {
  const source = (name || email || '?').trim();
  return source.slice(0, 2).toUpperCase();
}

function Avatar({ avatarUrl, name, email }) {
  if (avatarUrl) {
    return <Image source={{ uri: avatarUrl }} style={styles.avatar} />;
  }
  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarText}>{getInitials(name, email)}</Text>
    </View>
  );
}

// Direct messaging between any two portal accounts, independent of role or
// page access -- see scripts/sql/add-messaging.sql. The conversation list
// (with unread counts) and message thread both stay live via Supabase
// Realtime; RLS ensures a subscriber only ever receives rows for
// conversations they're actually a participant of.
export default function Messages({ onConversationsChanged, initialConversationId, onInitialConversationHandled }) {
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT;

  const [currentUserId, setCurrentUserId] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [selectedConversationId, setSelectedConversationId] = useState(null);

  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [composeText, setComposeText] = useState('');
  const [sending, setSending] = useState(false);

  const [newMessageModalVisible, setNewMessageModalVisible] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userSearchResults, setUserSearchResults] = useState([]);
  const [startingConversation, setStartingConversation] = useState(false);
  const [randomModeratorProfile, setRandomModeratorProfile] = useState(null);
  const [loadingRandomModerator, setLoadingRandomModerator] = useState(false);

  const scrollRef = useRef(null);

  useEffect(() => {
    init();
  }, []);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    setCurrentUserId(user?.id || null);
    await loadConversations();
  }

  async function loadConversations() {
    try {
      setLoadingConversations(true);
      const { data, error } = await supabase.rpc('get_my_conversations');
      if (error) throw error;
      setConversations(data || []);
      onConversationsChanged?.(data || []);
    } catch (err) {
      showAlert('Error Loading Messages', err.message);
    } finally {
      setLoadingConversations(false);
    }
  }

  async function loadMessages(conversationId) {
    try {
      setLoadingMessages(true);
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setMessages(data || []);
    } catch (err) {
      showAlert('Error Loading Conversation', err.message);
    } finally {
      setLoadingMessages(false);
    }
  }

  async function markAsRead(conversationId) {
    if (!currentUserId) return;
    try {
      await supabase
        .from('conversation_participants')
        .update({ last_read_at: new Date().toISOString() })
        .eq('conversation_id', conversationId)
        .eq('profile_id', currentUserId);
      const next = conversations.map((c) => (c.conversation_id === conversationId ? { ...c, unread_count: 0 } : c));
      setConversations(next);
      onConversationsChanged?.(next);
    } catch (err) {
      console.error('Error marking conversation read:', err.message);
    }
  }

  function openConversation(conversationId) {
    setSelectedConversationId(conversationId);
    setMessages([]);
    loadMessages(conversationId);
    markAsRead(conversationId);
  }

  // Set by the Change Requests queue's "Message" button (via
  // src/app/index.js's pendingConversationId) so arriving here already
  // jumps straight into that conversation instead of the empty "select a
  // conversation" state. Reported back immediately so it only fires once --
  // otherwise navigating away and back to Messages normally would keep
  // re-opening the same stale conversation.
  useEffect(() => {
    if (!initialConversationId) return;
    openConversation(initialConversationId);
    onInitialConversationHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialConversationId]);

  // Realtime: one subscription per open conversation, torn down and
  // recreated whenever the selection changes.
  useEffect(() => {
    if (!selectedConversationId) return undefined;

    const channel = supabase
      .channel(`messages_conversation_${selectedConversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${selectedConversationId}` },
        (payload) => {
          setMessages((prev) => (prev.some((m) => m.id === payload.new.id) ? prev : [...prev, payload.new]));
          if (payload.new.sender_id !== currentUserId) {
            markAsRead(selectedConversationId);
          } else {
            loadConversations();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConversationId, currentUserId]);

  // Global subscription: keeps the conversation list (and unread badge)
  // fresh even for conversations that aren't currently open. RLS limits
  // delivery to rows the signed-in account can actually see.
  useEffect(() => {
    if (!currentUserId) return undefined;

    const channel = supabase
      .channel('messages_global_inbox')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          if (payload.new.conversation_id !== selectedConversationId) {
            loadConversations();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, selectedConversationId]);

  useEffect(() => {
    scrollRef.current?.scrollToEnd?.({ animated: true });
  }, [messages]);

  async function handleSend() {
    const body = composeText.trim();
    if (!body || !selectedConversationId || !currentUserId) return;
    try {
      setSending(true);
      setComposeText('');
      const { error } = await supabase
        .from('messages')
        .insert([{ conversation_id: selectedConversationId, sender_id: currentUserId, body }]);
      if (error) throw error;
    } catch (err) {
      showAlert('Send Failed', err.message);
      setComposeText(body);
    } finally {
      setSending(false);
    }
  }

  // On web, a multiline TextInput's Enter key inserts a newline instead of
  // firing onSubmitEditing -- intercept it here so Enter sends the message,
  // while Shift+Enter still inserts a literal newline as usual.
  function handleComposeKeyPress(e) {
    if (Platform.OS !== 'web') return;
    const nativeEvent = e.nativeEvent || {};
    if (nativeEvent.key === 'Enter' && !nativeEvent.shiftKey) {
      e.preventDefault?.();
      handleSend();
    }
  }

  useEffect(() => {
    if (userSearchQuery.trim().length >= 2) searchUsers(userSearchQuery);
    else setUserSearchResults([]);
  }, [userSearchQuery]);

  async function searchUsers(query) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, avatar_url')
        .or(`email.ilike.%${query}%,full_name.ilike.%${query}%`)
        .limit(10);
      if (error) throw error;
      setUserSearchResults((data || []).filter((p) => p.id !== currentUserId));
    } catch (err) {
      console.error('Error searching users:', err.message);
    }
  }

  // Quick way to reach a Moderator without knowing who's currently holding
  // that role -- picks one at random from whichever portal accounts have a
  // role literally named "Moderator" (Roles & Page Access), and reveals
  // their email so it can be tapped to start a conversation.
  async function handleShowRandomModerator() {
    try {
      setLoadingRandomModerator(true);
      setRandomModeratorProfile(null);
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, roles ( name )');
      if (error) throw error;
      const moderators = (data || []).filter((p) => p.roles?.name === 'Moderator' && p.id !== currentUserId);
      if (moderators.length === 0) {
        showAlert('No Moderators Found', 'No portal account currently has the Moderator role.');
        return;
      }
      setRandomModeratorProfile(moderators[Math.floor(Math.random() * moderators.length)]);
    } catch (err) {
      showAlert('Error', err.message);
    } finally {
      setLoadingRandomModerator(false);
    }
  }

  async function handleStartConversation(otherProfile) {
    try {
      setStartingConversation(true);
      const { data, error } = await supabase.rpc('start_direct_conversation', { other_profile_id: otherProfile.id });
      if (error) throw error;
      setNewMessageModalVisible(false);
      setUserSearchQuery('');
      setUserSearchResults([]);
      await loadConversations();
      openConversation(data);
    } catch (err) {
      showAlert('Error Starting Conversation', err.message);
    } finally {
      setStartingConversation(false);
    }
  }

  const selectedConversation = conversations.find((c) => c.conversation_id === selectedConversationId) || null;
  const showList = !isWide ? !selectedConversationId : true;
  const showThread = !isWide ? !!selectedConversationId : true;
  const totalUnread = conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Ionicons name="chatbubbles-outline" size={22} color="#0f172a" style={styles.titleIcon} />
          <Text style={styles.title}>Messages</Text>
          {totalUnread > 0 && (
            <View style={styles.headerUnreadPill}>
              <Text style={styles.headerUnreadPillText}>{totalUnread} unread</Text>
            </View>
          )}
        </View>
        <Text style={styles.subtitle}>Message any portal account directly, across roles.</Text>
      </View>

      <View style={[styles.body, isWide && styles.bodyWide]}>
        {showList && (
          <View style={[styles.listPane, isWide && styles.listPaneWide]}>
            <View style={styles.listHeader}>
              <Text style={styles.listHeaderText}>Conversations</Text>
              <TouchableOpacity style={styles.newMessageBtn} onPress={() => { setRandomModeratorProfile(null); setNewMessageModalVisible(true); }}>
                <Ionicons name="create-outline" size={14} color="#ffffff" style={{ marginRight: 4 }} />
                <Text style={styles.newMessageBtnText}>New</Text>
              </TouchableOpacity>
            </View>

            {loadingConversations ? (
              <ActivityIndicator size="large" color={NAVY} style={{ padding: 30 }} />
            ) : conversations.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Ionicons name="chatbubble-ellipses-outline" size={28} color="#cbd5e1" />
                <Text style={styles.emptyText}>No conversations yet. Start one with &quot;New&quot;.</Text>
              </View>
            ) : (
              <ScrollView>
                {conversations.map((c) => {
                  const isSelected = c.conversation_id === selectedConversationId;
                  const displayName = c.other_full_name || c.other_email || 'Portal User';
                  return (
                    <TouchableOpacity
                      key={c.conversation_id}
                      style={[styles.conversationRow, isSelected && styles.conversationRowActive]}
                      onPress={() => openConversation(c.conversation_id)}
                    >
                      <Avatar avatarUrl={c.other_avatar_url} name={c.other_full_name} email={c.other_email} />
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <Text style={styles.conversationName} numberOfLines={1}>{displayName}</Text>
                          <Text style={styles.conversationTime}>{formatTimestamp(c.last_message_at)}</Text>
                        </View>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Text style={styles.conversationPreview} numberOfLines={1}>
                            {c.last_message_sender_id === currentUserId ? 'You: ' : ''}{c.last_message_body || 'Say hello!'}
                          </Text>
                          {c.unread_count > 0 && (
                            <View style={styles.unreadBadge}>
                              <Text style={styles.unreadBadgeText}>{c.unread_count}</Text>
                            </View>
                          )}
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>
        )}

        {showThread && (
          <View style={[styles.threadPane, isWide && styles.threadPaneWide]}>
            {!selectedConversation ? (
              <View style={styles.emptyWrap}>
                <Ionicons name="chatbubbles-outline" size={32} color="#cbd5e1" />
                <Text style={styles.emptyText}>Select a conversation, or start a new one.</Text>
              </View>
            ) : (
              <>
                <View style={styles.threadHeader}>
                  {!isWide && (
                    <TouchableOpacity
                      style={styles.backBtn}
                      onPress={() => setSelectedConversationId(null)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="chevron-back" size={20} color="#334155" />
                    </TouchableOpacity>
                  )}
                  <Avatar
                    avatarUrl={selectedConversation.other_avatar_url}
                    name={selectedConversation.other_full_name}
                    email={selectedConversation.other_email}
                  />
                  <Text style={styles.threadHeaderName} numberOfLines={1}>
                    {selectedConversation.other_full_name || selectedConversation.other_email || 'Portal User'}
                  </Text>
                </View>

                {loadingMessages ? (
                  <ActivityIndicator size="large" color={NAVY} style={{ flex: 1 }} />
                ) : (
                  <ScrollView ref={scrollRef} style={styles.messageScroll} contentContainerStyle={{ padding: 14 }}>
                    {messages.length === 0 && (
                      <Text style={styles.emptyText}>No messages yet. Say hello!</Text>
                    )}
                    {messages.map((m) => {
                      const isMine = m.sender_id === currentUserId;
                      return (
                        <View key={m.id} style={[styles.bubbleRow, isMine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
                          <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
                            <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine]}>{m.body}</Text>
                          </View>
                          <Text style={styles.bubbleTime}>{formatTimestamp(m.created_at)}</Text>
                        </View>
                      );
                    })}
                  </ScrollView>
                )}

                <View style={styles.composeRow}>
                  <TextInput
                    style={styles.composeInput}
                    placeholder="Type a message..."
                    placeholderTextColor="#94a3b8"
                    value={composeText}
                    onChangeText={setComposeText}
                    onSubmitEditing={handleSend}
                    onKeyPress={handleComposeKeyPress}
                    returnKeyType="send"
                    multiline
                  />
                  <TouchableOpacity
                    style={[styles.sendBtn, (!composeText.trim() || sending) && styles.sendBtnDisabled]}
                    onPress={handleSend}
                    disabled={!composeText.trim() || sending}
                  >
                    <Ionicons name="send" size={16} color="#ffffff" />
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        )}
      </View>

      <Modal visible={newMessageModalVisible} transparent animationType="fade" onRequestClose={() => setNewMessageModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New Message</Text>
            <View style={styles.searchBox}>
              <Ionicons name="search-outline" size={14} color="#94a3b8" style={{ marginRight: 6 }} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search by name or email..."
                placeholderTextColor="#94a3b8"
                value={userSearchQuery}
                onChangeText={setUserSearchQuery}
                autoFocus
              />
            </View>

            <TouchableOpacity
              style={styles.randomModeratorBadge}
              onPress={handleShowRandomModerator}
              disabled={loadingRandomModerator}
            >
              {loadingRandomModerator ? (
                <ActivityIndicator size="small" color={ACCENT_BLUE} />
              ) : (
                <>
                  <Ionicons name="shuffle-outline" size={13} color={ACCENT_BLUE} style={{ marginRight: 6 }} />
                  <Text style={styles.randomModeratorBadgeText}>Message a Moderator</Text>
                </>
              )}
            </TouchableOpacity>

            {randomModeratorProfile && (
              <TouchableOpacity style={styles.randomModeratorResult} onPress={() => handleStartConversation(randomModeratorProfile)}>
                <Ionicons name="mail-outline" size={13} color="#334155" style={{ marginRight: 6 }} />
                <Text style={styles.randomModeratorResultText} numberOfLines={1}>{randomModeratorProfile.email}</Text>
              </TouchableOpacity>
            )}

            <ScrollView style={{ maxHeight: 280, marginTop: 8 }} keyboardShouldPersistTaps="handled">
              {startingConversation && <ActivityIndicator color={NAVY} style={{ marginVertical: 12 }} />}
              {!startingConversation && userSearchResults.map((p) => (
                <TouchableOpacity key={p.id} style={styles.userResultRow} onPress={() => handleStartConversation(p)}>
                  <Avatar avatarUrl={p.avatar_url} name={p.full_name} email={p.email} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.userResultName} numberOfLines={1}>{p.full_name || p.email}</Text>
                    {!!p.full_name && <Text style={styles.userResultEmail} numberOfLines={1}>{p.email}</Text>}
                  </View>
                </TouchableOpacity>
              ))}
              {!startingConversation && userSearchQuery.trim().length >= 2 && userSearchResults.length === 0 && (
                <Text style={styles.emptyText}>No matching accounts.</Text>
              )}
            </ScrollView>

            <TouchableOpacity
              style={styles.modalCancelBtn}
              onPress={() => { setNewMessageModalVisible(false); setRandomModeratorProfile(null); }}
            >
              <Text style={styles.modalCancelBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },

  header: { padding: 16, paddingBottom: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  titleIcon: { marginRight: 8 },
  title: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  subtitle: { fontSize: 12, color: '#64748b', marginTop: 4 },
  headerUnreadPill: { marginLeft: 10, backgroundColor: '#dbeafe', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  headerUnreadPillText: { fontSize: 11, fontWeight: '700', color: '#1d4ed8' },

  body: { flex: 1, flexDirection: 'column', paddingHorizontal: 16, paddingBottom: 16, gap: 16 },
  bodyWide: { flexDirection: 'row' },

  listPane: {
    flex: 1, backgroundColor: '#ffffff', borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden',
  },
  listPaneWide: { flex: 1, maxWidth: 320 },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  listHeaderText: { fontSize: 13, fontWeight: '800', color: '#0f172a' },
  newMessageBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: NAVY, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  newMessageBtnText: { fontSize: 12, fontWeight: '700', color: '#ffffff' },

  conversationRow: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: '#f4f6f9' },
  conversationRowActive: { backgroundColor: '#eff6ff' },
  conversationName: { fontSize: 13, fontWeight: '700', color: '#1e293b', flexShrink: 1 },
  conversationTime: { fontSize: 10, color: '#94a3b8' },
  conversationPreview: { fontSize: 12, color: '#64748b', flex: 1, marginRight: 6, marginTop: 2 },

  avatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#eff6ff',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 12, fontWeight: '800', color: NAVY },

  unreadBadge: { backgroundColor: ACCENT_BLUE, borderRadius: 10, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  unreadBadgeText: { color: '#ffffff', fontSize: 10, fontWeight: '800' },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 10 },
  emptyText: { fontSize: 12, color: '#94a3b8', textAlign: 'center' },

  threadPane: {
    flex: 1, backgroundColor: '#ffffff', borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden',
  },
  threadPaneWide: { flex: 2 },
  threadHeader: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  backBtn: { marginRight: 6, padding: 4 },
  threadHeaderName: { fontSize: 14, fontWeight: '800', color: '#0f172a', marginLeft: 10, flexShrink: 1 },

  messageScroll: { flex: 1 },
  bubbleRow: { marginBottom: 12, maxWidth: '75%' },
  bubbleRowMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubbleRowTheirs: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9 },
  bubbleMine: { backgroundColor: NAVY, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: '#f1f5f9', borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 13, color: '#1e293b', lineHeight: 18 },
  bubbleTextMine: { color: '#ffffff' },
  bubbleTime: { fontSize: 9, color: '#94a3b8', marginTop: 3 },

  composeRow: { flexDirection: 'row', alignItems: 'flex-end', padding: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9', gap: 8 },
  composeInput: {
    flex: 1, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: '#1e293b', maxHeight: 100,
  },
  sendBtn: { backgroundColor: ACCENT_BLUE, borderRadius: 10, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.5 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  modalCard: { backgroundColor: '#ffffff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 420 },
  modalTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a', marginBottom: 12 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', borderWidth: 1,
    borderColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9,
  },
  searchInput: { flex: 1, fontSize: 13, color: '#1e293b' },
  randomModeratorBadge: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start',
    backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 7, marginTop: 10,
  },
  randomModeratorBadgeText: { fontSize: 12, fontWeight: '700', color: ACCENT_BLUE },
  randomModeratorResult: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', borderWidth: 1,
    borderColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginTop: 8,
  },
  randomModeratorResultText: { fontSize: 12, fontWeight: '600', color: '#334155', flex: 1 },
  userResultRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  userResultName: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  userResultEmail: { fontSize: 11, color: '#64748b', marginTop: 1 },
  modalCancelBtn: { marginTop: 14, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, backgroundColor: '#f1f5f9', alignSelf: 'flex-end' },
  modalCancelBtnText: { fontSize: 13, fontWeight: '700', color: '#334155' },
});

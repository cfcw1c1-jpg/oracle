import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';

const NAVY = '#002060';
const ACCENT_BLUE = '#2563eb';
const WIDE_BREAKPOINT = 820;
// Android sits the compose row flush against the keyboard at the exact
// measured height with no breathing room -- a bit more clearance reads
// better there. iOS already looks right at the exact measurement, so this
// stays 0 on iOS rather than pushing it too far up.
const ANDROID_KEYBOARD_GAP = Platform.OS === 'android' ? 16 : 0;

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

function Avatar({ avatarUrl, name, email, isGroup, size = 36 }) {
  const sizeStyle = { width: size, height: size, borderRadius: size / 2 };
  if (isGroup) {
    return (
      <View style={[styles.avatar, styles.avatarGroup, sizeStyle]}>
        <Ionicons name="people" size={Math.round(size * 0.47)} color={NAVY} />
      </View>
    );
  }
  if (avatarUrl) {
    return <Image source={{ uri: avatarUrl }} style={[styles.avatar, sizeStyle]} />;
  }
  return (
    <View style={[styles.avatar, sizeStyle]}>
      <Text style={[styles.avatarText, size < 32 && { fontSize: 10 }]}>{getInitials(name, email)}</Text>
    </View>
  );
}

// Direct messaging between any two portal accounts, independent of role or
// page access -- see scripts/sql/add-messaging.sql. The conversation list
// (with unread counts) and message thread both stay live via Supabase
// Realtime; RLS ensures a subscriber only ever receives rows for
// conversations they're actually a participant of.
export default function Messages({ onConversationsChanged, initialConversationId, onInitialConversationHandled, onExit }) {
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT;
  const insets = useSafeAreaInsets();

  const [currentUserId, setCurrentUserId] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [selectedConversationId, setSelectedConversationId] = useState(null);

  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [participantsById, setParticipantsById] = useState({});
  const [composeText, setComposeText] = useState('');
  const [sending, setSending] = useState(false);

  const [newMessageModalVisible, setNewMessageModalVisible] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userSearchResults, setUserSearchResults] = useState([]);
  const [startingConversation, setStartingConversation] = useState(false);
  const [startingModeratorGroup, setStartingModeratorGroup] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState(null);

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

  // Every participant's name/avatar for the open conversation, keyed by
  // profile id -- looked up once per conversation (not per message) so
  // sender labels/avatars in the thread (and on messages that arrive via
  // Realtime, which only carries the raw message row) can be resolved
  // without a round trip each time.
  async function loadParticipants(conversationId) {
    try {
      const { data, error } = await supabase
        .from('conversation_participants')
        .select('profile_id, profiles ( full_name, email, avatar_url )')
        .eq('conversation_id', conversationId);
      if (error) throw error;
      const map = {};
      (data || []).forEach((row) => {
        map[row.profile_id] = row.profiles || {};
      });
      setParticipantsById(map);
    } catch (err) {
      console.error('Error loading participants:', err.message);
    }
  }

  function getSenderInfo(senderId) {
    const isMe = senderId === currentUserId;
    const p = participantsById[senderId] || {};
    return {
      name: isMe ? 'You' : (p.full_name || p.email || 'Portal User'),
      email: p.email,
      avatarUrl: p.avatar_url || null,
    };
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
    setParticipantsById({});
    loadMessages(conversationId);
    loadParticipants(conversationId);
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

  // Re-scrolls to the bottom once the keyboard opens -- without this, the
  // thread stays scrolled to where it was, so the latest message (and the
  // compose row right below it) can still end up hidden above the keyboard
  // instead of sitting right on top of it, Messenger-style.
  //
  // keyboardHeight drives the container's own bottom padding below, on
  // BOTH platforms. Android was originally left to windowSoftInputMode=
  // adjustResize alone (its window resizing natively), but that stopped
  // being reliable once edge-to-edge became mandatory (Android 15+/SDK 35+
  // -- see the SafeAreaView import note above): adjustResize is a pre-
  // edge-to-edge mechanism, and apps drawing behind the system bars are
  // expected to size themselves off the keyboard inset directly instead,
  // same as this already does for iOS. This replaced a KeyboardAvoidingView
  // here: that component pads itself based on measuring its own on-screen
  // position, which came up short once the mobile bottom tab bar (a sibling
  // of this screen, not a child) started occupying the bottom of the
  // screen -- this screen's container no longer reached the physical
  // bottom, so the measurement undercounted. Tracking the keyboard's actual
  // height directly sidesteps that measurement entirely.
  //
  // e.endCoordinates.height is measured from the true physical bottom of
  // the screen, but this container already sits insets.bottom above that
  // (the root SafeAreaView already reserved that strip for the home
  // indicator/nav bar) -- applying the raw keyboard height on top would
  // double-count that strip and leave a gap between the compose row and
  // the keyboard.
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates?.height || 0);
      scrollRef.current?.scrollToEnd?.({ animated: true });
    });
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

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

  // Quick way to reach the Moderator team without knowing who's currently
  // holding that role -- opens (or reuses) a single group conversation
  // with every portal account that has a role literally named "Moderator"
  // (Roles & Page Access), so anything sent there -- including images --
  // is visible to the whole team, not just whoever happens to be picked.
  async function handleStartModeratorGroup() {
    try {
      setStartingModeratorGroup(true);
      const { data, error } = await supabase.rpc('start_moderator_group_conversation');
      if (error) throw error;
      setNewMessageModalVisible(false);
      setUserSearchQuery('');
      setUserSearchResults([]);

      // Opens on this same tap using what's already known (a fresh or
      // reused group, this account being the one who started it) instead
      // of waiting on get_my_conversations() to reflect a row that may not
      // have propagated yet -- awaiting loadConversations() before opening
      // used to occasionally race the just-committed insert, so the first
      // tap would silently land on the "select a conversation" empty state
      // (selectedConversation lookup coming up empty) with nothing visibly
      // happening, and only a second tap -- by then caught up -- worked.
      // The real title ("Moderators w/ <email>", set server-side) replaces
      // this placeholder moments later once loadConversations() resolves.
      setConversations((prev) => (
        prev.some((c) => c.conversation_id === data)
          ? prev
          : [{
              conversation_id: data, is_group: true, other_profile_id: null,
              other_full_name: 'Moderator Team', other_email: null, other_avatar_url: null,
              last_message_at: new Date().toISOString(), last_message_body: null,
              last_message_image_url: null, last_message_sender_id: null, unread_count: 0,
            }, ...prev]
      ));
      openConversation(data);
      loadConversations();
    } catch (err) {
      showAlert('Error Starting Conversation', err.message);
    } finally {
      setStartingModeratorGroup(false);
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

  async function handlePickAndSendImage() {
    if (!selectedConversationId || !currentUserId || uploadingImage) return;
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showAlert('Permission Needed', 'Please allow photo library access to send an image.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      setUploadingImage(true);

      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const fileExt = (asset.fileName?.split('.').pop() || asset.mimeType?.split('/').pop() || 'jpg').toLowerCase();
      const filePath = `${currentUserId}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('message-images')
        .upload(filePath, blob, { contentType: asset.mimeType || 'image/jpeg' });
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from('message-images').getPublicUrl(filePath);

      const { error } = await supabase
        .from('messages')
        .insert([{ conversation_id: selectedConversationId, sender_id: currentUserId, body: '', image_url: publicUrlData.publicUrl }]);
      if (error) throw error;
    } catch (err) {
      const isMissingBucket = err.message?.toLowerCase().includes('bucket not found');
      showAlert(
        'Image Send Failed',
        isMissingBucket
          ? 'No "message-images" storage bucket exists yet. Run scripts/sql/add-message-images.sql against your Supabase project, then try again.'
          : err.message
      );
    } finally {
      setUploadingImage(false);
    }
  }

  const selectedConversation = conversations.find((c) => c.conversation_id === selectedConversationId) || null;
  const showList = !isWide ? !selectedConversationId : true;
  const showThread = !isWide ? !!selectedConversationId : true;
  const totalUnread = conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0);

  return (
    <View style={[styles.container, { paddingBottom: keyboardHeight > 0 ? Math.max(0, keyboardHeight - insets.bottom + ANDROID_KEYBOARD_GAP) : 0 }]}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          {/* Messages runs full-screen on mobile with no bottom tab bar, so
              this is the only way back out to the rest of the app there. */}
          {!isWide && !!onExit && (
            <TouchableOpacity onPress={onExit} style={styles.exitBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="chevron-back" size={22} color="#0f172a" />
            </TouchableOpacity>
          )}
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
              <TouchableOpacity style={styles.newMessageBtn} onPress={() => setNewMessageModalVisible(true)}>
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
                      <Avatar avatarUrl={c.other_avatar_url} name={c.other_full_name} email={c.other_email} isGroup={c.is_group} />
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <Text style={styles.conversationName} numberOfLines={1}>{displayName}</Text>
                          <Text style={styles.conversationTime}>{formatTimestamp(c.last_message_at)}</Text>
                        </View>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Text style={styles.conversationPreview} numberOfLines={1}>
                            {c.last_message_sender_id === currentUserId ? 'You: ' : ''}
                            {c.last_message_body || (c.last_message_image_url ? '📷 Photo' : 'Say hello!')}
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
                    isGroup={selectedConversation.is_group}
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
                      const sender = getSenderInfo(m.sender_id);
                      return (
                        <View key={m.id} style={[styles.bubbleRow, isMine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
                          <Avatar avatarUrl={sender.avatarUrl} name={sender.name} email={sender.email} size={26} />
                          <View style={[styles.bubbleColumn, isMine ? styles.bubbleColumnMine : styles.bubbleColumnTheirs]}>
                            <Text style={styles.bubbleSenderName}>{sender.name}</Text>
                            <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs, !!m.image_url && styles.bubbleImageWrap]}>
                              {!!m.image_url && (
                                <TouchableOpacity activeOpacity={0.85} onPress={() => setPreviewImageUrl(m.image_url)}>
                                  <Image source={{ uri: m.image_url }} style={styles.bubbleImage} resizeMode="cover" />
                                </TouchableOpacity>
                              )}
                              {!!m.body && (
                                <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine, !!m.image_url && styles.bubbleTextWithImage]}>{m.body}</Text>
                              )}
                            </View>
                            <Text style={styles.bubbleTime}>{formatTimestamp(m.created_at)}</Text>
                          </View>
                        </View>
                      );
                    })}
                  </ScrollView>
                )}

                <View style={styles.composeRow}>
                  <TouchableOpacity
                    style={styles.attachBtn}
                    onPress={handlePickAndSendImage}
                    disabled={uploadingImage}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    {uploadingImage ? (
                      <ActivityIndicator size="small" color={NAVY} />
                    ) : (
                      <Ionicons name="image-outline" size={20} color={NAVY} />
                    )}
                  </TouchableOpacity>
                  <TextInput
                    style={styles.composeInput}
                    placeholder="Type a message..."
                    placeholderTextColor="#94a3b8"
                    value={composeText}
                    onChangeText={setComposeText}
                    onSubmitEditing={handleSend}
                    onKeyPress={handleComposeKeyPress}
                    onFocus={() => scrollRef.current?.scrollToEnd?.({ animated: true })}
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

      <Modal visible={!!previewImageUrl} transparent animationType="fade" onRequestClose={() => setPreviewImageUrl(null)}>
        <View style={styles.imagePreviewOverlay}>
          <TouchableOpacity
            style={[styles.imagePreviewCloseBtn, { top: insets.top + 12 }]}
            onPress={() => setPreviewImageUrl(null)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="close" size={26} color="#ffffff" />
          </TouchableOpacity>
          {!!previewImageUrl && (
            <Image source={{ uri: previewImageUrl }} style={styles.imagePreviewFull} resizeMode="contain" />
          )}
        </View>
      </Modal>

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
              onPress={handleStartModeratorGroup}
              disabled={startingModeratorGroup}
            >
              {startingModeratorGroup ? (
                <ActivityIndicator size="small" color={ACCENT_BLUE} />
              ) : (
                <>
                  <Ionicons name="people-outline" size={14} color={ACCENT_BLUE} style={{ marginRight: 6 }} />
                  <Text style={styles.randomModeratorBadgeText}>Message All Moderators</Text>
                </>
              )}
            </TouchableOpacity>

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
              onPress={() => setNewMessageModalVisible(false)}
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
  exitBtn: { marginRight: 8, padding: 2 },
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
  avatarGroup: { backgroundColor: '#dbeafe' },

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
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 14, maxWidth: '85%', gap: 6 },
  bubbleRowMine: { alignSelf: 'flex-end', flexDirection: 'row-reverse' },
  bubbleRowTheirs: { alignSelf: 'flex-start' },
  bubbleColumn: { flexShrink: 1 },
  bubbleColumnMine: { alignItems: 'flex-end' },
  bubbleColumnTheirs: { alignItems: 'flex-start' },
  bubbleSenderName: { fontSize: 10, fontWeight: '700', color: '#64748b', marginBottom: 2, marginHorizontal: 2 },
  bubble: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9 },
  bubbleMine: { backgroundColor: NAVY, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: '#f1f5f9', borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 13, color: '#1e293b', lineHeight: 18 },
  bubbleTextMine: { color: '#ffffff' },
  bubbleTextWithImage: { marginTop: 6 },
  bubbleTime: { fontSize: 9, color: '#94a3b8', marginTop: 3 },
  bubbleImageWrap: { padding: 4 },
  bubbleImage: { width: 200, height: 200, borderRadius: 10, backgroundColor: '#e2e8f0' },

  imagePreviewOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  imagePreviewFull: { width: '100%', height: '100%' },
  imagePreviewCloseBtn: {
    position: 'absolute', right: 20, zIndex: 1, width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center',
  },

  composeRow: { flexDirection: 'row', alignItems: 'flex-end', padding: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9', gap: 8 },
  attachBtn: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' },
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
  userResultRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  userResultName: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  userResultEmail: { fontSize: 11, color: '#64748b', marginTop: 1 },
  modalCancelBtn: { marginTop: 14, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, backgroundColor: '#f1f5f9', alignSelf: 'flex-end' },
  modalCancelBtnText: { fontSize: 13, fontWeight: '700', color: '#334155' },
});

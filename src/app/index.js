import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
// react-native's own SafeAreaView is an iOS-only no-op -- on Android it
// never reserved space for the status bar, which only became visible as
// a bug once edge-to-edge became the SDK default. This one applies real
// insets on both platforms.
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import packageJson from '../../package.json';
import Login from '../auth/Login';
import ResetPassword from '../auth/ResetPassword';
import ForceUpdateModal from '../components/ForceUpdateModal';
import { fetchAccessContext } from '../lib/access';
import { checkForceUpdate, subscribeToForceUpdateChanges } from '../lib/appVersionGate';
import { addNotificationTapListener, registerForPushNotificationsAsync } from '../lib/pushNotifications';
import { trackPresence } from '../lib/presence';
import AdminDashboard from '../screens/AdminDashboard';
import ClpMaintenance from '../screens/ClpMaintenance'; // Imported the new CLP Maintenance screen
import DashboardHome from '../screens/DashboardHome';
import Logs from '../screens/Logs';
import ManageMembers from '../screens/ManageMembers';
import MemberChangeQueue from '../screens/MemberChangeQueue';
import MembersList from '../screens/MembersList';
import Messages from '../screens/Messages';
import MyChangeRequests from '../screens/MyChangeRequests';
import PfoList from '../screens/PfoList';
import PfoReport from '../screens/PfoReports';
import PfoStatGenerator from '../screens/PfoStatGenerator';
import PortalUsers from '../screens/PortalUsers';
import PredictorScreen from '../screens/PredictorScreen';
import ProfileScreen from '../screens/ProfileScreen';
import Settings from '../screens/Settings';

// An item with a `group` renders under its own labeled section in the
// sidebar (see SidebarPanel), separate from the main flat list.
const NAV_ITEMS = [
  { key: 'home', label: 'Dashboard', icon: 'home-outline' },
  { key: 'adminDashboard', label: 'Admin Dashboard', icon: 'stats-chart-outline' },
  { key: 'members', label: 'Directory', icon: 'people-outline' },
  { key: 'myChangeRequests', label: 'My Change Requests', icon: 'hourglass-outline' },
  { key: 'manageMembers', label: 'Manage Members', icon: 'list-outline' },
  { key: 'pfo', label: 'PFO Trainings', icon: 'bar-chart-outline' },
  { key: 'pfoReports', label: 'PFO Reports', icon: 'trending-up-outline' },
  { key: 'pfoStats', label: 'Formation Stats', icon: 'analytics-outline' },
  { key: 'clp', label: 'CLP Maintenance', icon: 'construct-outline' },
  { key: 'portalUsers', label: 'Portal Users', icon: 'people-circle-outline' },
  { key: 'logs', label: 'Logs', icon: 'file-tray-full-outline' },
  { key: 'settings', label: 'Settings', icon: 'settings-outline' },
  { key: 'memberChangeQueue', label: 'Change Requests', icon: 'checkmark-done-outline', group: 'Moderation' },
];

// Human-readable labels for the System Audit Log's PAGE_VIEW rows -- every
// NAV_ITEMS entry, plus the few tabs reachable outside the sidebar
// (avatar -> profile, the message toast -> messages).
const PAGE_VIEW_LABELS = NAV_ITEMS.reduce((acc, item) => {
  acc[item.key] = item.label;
  return acc;
}, { profile: 'My Profile', messages: 'Messages', predictor: 'Predictor' });

const SIDEBAR_GRADIENT = ['#05061a', '#0b1e4d', '#1d3f9e', '#5b21b6'];

// Remembers the last tab a signed-in account was on across a page refresh
// (web only -- native has no "refresh" concept). localStorage rather than
// sessionStorage -- it's scoped to the browser (origin) rather than one
// specific tab/session, so it survives regardless of how a given dev/preview
// environment happens to handle "refresh" under the hood. Cleared explicitly
// on sign-out so the next login on the same browser never inherits a
// previous account's last-viewed page.
const CURRENT_TAB_STORAGE_KEY = 'oracle_current_tab';

function readStoredTab() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(CURRENT_TAB_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredTab(tabKey) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CURRENT_TAB_STORAGE_KEY, tabKey);
  } catch {
    // Ignore (e.g. Safari private mode can throw on storage access).
  }
}

function clearStoredTab() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(CURRENT_TAB_STORAGE_KEY);
  } catch {
    // Ignore.
  }
}

// Shared by the permanent (wide-screen) sidebar and the mobile drawer.
// Renders a floating "glass" card (blurred/translucent) over a navy-to-violet
// gradient backdrop, matching the transparent sidebar design reference.
function SidebarPanel({ currentTab, onSelectTab, collapsed, session, showCollapseToggle, onToggleCollapse, navItems, roleName, badgeCounts = {} }) {
  const avatarUrl = session?.user?.user_metadata?.avatar_url;
  const email = session?.user?.email;
  const portalLabel = roleName ? `${roleName} Portal` : 'Members Portal';

  const ungroupedItems = navItems.filter((item) => !item.group);
  const groups = [];
  navItems.forEach((item) => {
    if (!item.group) return;
    let group = groups.find((g) => g.name === item.group);
    if (!group) {
      group = { name: item.group, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  });

  function renderNavItem(item) {
    const isActive = currentTab === item.key;
    const badgeCount = badgeCounts[item.key] || 0;
    return (
      <TouchableOpacity
        key={item.key}
        style={[styles.sidebarButton, collapsed && styles.sidebarButtonCollapsed, isActive && styles.activeSidebarButton]}
        onPress={() => onSelectTab(item.key)}
      >
        {collapsed ? (
          <View style={styles.sidebarIconWrapCollapsed}>
            <Ionicons name={item.icon} size={18} color={isActive ? '#ffffff' : 'rgba(226,232,255,0.65)'} />
            {badgeCount > 0 && (
              <View style={styles.sidebarIconBadge}>
                <Text style={styles.sidebarIconBadgeText}>{badgeCount > 9 ? '9+' : badgeCount}</Text>
              </View>
            )}
          </View>
        ) : (
          <Ionicons name={item.icon} size={18} color={isActive ? '#ffffff' : 'rgba(226,232,255,0.65)'} style={styles.sidebarIcon} />
        )}
        {!collapsed && (
          <Text style={[styles.sidebarButtonText, isActive && styles.activeSidebarText]} numberOfLines={1}>{item.label}</Text>
        )}
        {!collapsed && badgeCount > 0 && (
          <View style={styles.sidebarPillBadge}>
            <Text style={styles.sidebarPillBadgeText}>{badgeCount > 99 ? '99+' : badgeCount}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  }

  return (
    <LinearGradient colors={SIDEBAR_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.sidebarGradient}>
      <View style={[styles.glassPanel, collapsed && styles.glassPanelCollapsed]}>
        <View style={[styles.trafficLights, collapsed && styles.trafficLightsCollapsed]}>
          <View style={[styles.trafficDot, { backgroundColor: '#ff5f57' }]} />
          <View style={[styles.trafficDot, { backgroundColor: '#febc2e' }]} />
          <View style={[styles.trafficDot, { backgroundColor: '#28c840' }]} />
        </View>

        <View style={[styles.brandRow, collapsed && styles.brandRowCollapsed]}>
          <View style={styles.brandMark}>
            <Image source={require('../../assets/images/oracle-logo.png')} style={styles.brandMarkLogo} resizeMode="contain" />
          </View>
          {!collapsed && (
            <View>
              <Text style={styles.brandTitle}>ORACLE</Text>
              <Text style={styles.brandSubtitle} numberOfLines={1}>{portalLabel}</Text>
            </View>
          )}
        </View>

        <View style={styles.glassDivider} />

        <TouchableOpacity
          style={[styles.accountRow, collapsed && styles.accountRowCollapsed]}
          onPress={() => onSelectTab('profile')}
        >
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.accountAvatar} />
          ) : (
            <View style={styles.accountAvatarFallback}>
              <Text style={styles.accountAvatarFallbackText}>{(email || '?').slice(0, 2).toUpperCase()}</Text>
            </View>
          )}
          {!collapsed && (
            <View style={styles.accountTextWrap}>
              <Text style={styles.accountName} numberOfLines={1}>{email || 'Member'}</Text>
              <Text style={styles.accountCaption}>My Account</Text>
            </View>
          )}
        </TouchableOpacity>

        <View style={styles.glassDivider} />

        {/* The nav list is the one section that scrolls -- brand/account
            above and collapse/logout/version below stay fixed, so a long
            page list (many roles combined, or Admin with everything
            granted) never pushes Log Out off-screen with no way to reach
            it on a short mobile viewport. */}
        <ScrollView style={styles.navScroll} showsVerticalScrollIndicator={false}>
          {!collapsed && <Text style={styles.menuLabel}>MENU</Text>}
          <View style={styles.navLinksContainer}>
            {ungroupedItems.map(renderNavItem)}
          </View>

          {groups.map((group) => (
            <View key={group.name}>
              <View style={styles.glassDivider} />
              {!collapsed && <Text style={styles.menuLabel}>{group.name.toUpperCase()}</Text>}
              <View style={styles.navLinksContainer}>
                {group.items.map(renderNavItem)}
              </View>
            </View>
          ))}
        </ScrollView>

        {showCollapseToggle && (
          <TouchableOpacity
            style={[styles.collapseToggle, collapsed && styles.collapseToggleCollapsed]}
            onPress={onToggleCollapse}
          >
            <Ionicons name={collapsed ? 'chevron-forward' : 'chevron-back'} size={16} color="rgba(226,232,255,0.85)" />
            {!collapsed && <Text style={styles.collapseToggleText}>Collapse Menu</Text>}
          </TouchableOpacity>
        )}

        <View style={styles.glassDivider} />

        <TouchableOpacity
          style={[styles.sidebarButton, collapsed && styles.sidebarButtonCollapsed, styles.logoutButton]}
          onPress={() => supabase.auth.signOut()}
        >
          <Ionicons name="log-out-outline" size={18} color="#f87171" style={!collapsed && styles.sidebarIcon} />
          {!collapsed && <Text style={styles.logoutText}>Log Out</Text>}
        </TouchableOpacity>

        {!collapsed && <Text style={styles.versionText}>v{packageJson.version}</Text>}
      </View>
    </LinearGradient>
  );
}

export default function Page() {
  const [session, setSession] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [passwordRecoveryMode, setPasswordRecoveryMode] = useState(false);
  // Mirrors passwordRecoveryMode for the auth-listener effect below to read
  // -- that effect only runs once on mount, so its closure over the state
  // variable would otherwise stay stale forever once this flips true from
  // a completely separate effect.
  const passwordRecoveryModeRef = useRef(false);
  const [currentTab, setCurrentTab] = useState(() => readStoredTab() || 'home');
  // Set on a genuine interactive SIGNED_IN event (never on a refresh merely
  // restoring an existing session -- see the readyForSignInEvents guard
  // below), consumed once access loads to send an Admin to Admin Dashboard
  // first. Kept as a ref rather than state since it only needs to be read
  // once, inside an effect, not drive a render itself.
  const justSignedInRef = useRef(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [access, setAccess] = useState(null);
  const [accessLoading, setAccessLoading] = useState(true);

  const [unreadMessageCount, setUnreadMessageCount] = useState(0);
  const [pendingChangeRequestCount, setPendingChangeRequestCount] = useState(0);
  const [messageToast, setMessageToast] = useState(null);
  // Set by MemberChangeQueue's "Message" button so Messages knows which
  // conversation to jump straight into once it mounts on the tab switch
  // below -- cleared once Messages has consumed it, so returning to the
  // Messages tab normally afterward doesn't keep re-opening it.
  const [pendingConversationId, setPendingConversationId] = useState(null);
  const [disclaimerVisible, setDisclaimerVisible] = useState(false);
  const [forceUpdateInfo, setForceUpdateInfo] = useState(null); // { storeUrl, message } | null once behind, checked below
  const currentTabRef = useRef(currentTab);

  // Track window dimensions for real-time web/mobile switching
  const [screenWidth, setScreenWidth] = useState(Dimensions.get('window').width);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    currentTabRef.current = currentTab;
    writeStoredTab(currentTab);
  }, [currentTab]);

  // Force-update gate (native only -- see src/lib/appVersionGate.js): runs
  // independent of auth, since an outdated build shouldn't even reach the
  // Login screen. Also re-checks live if an Admin changes the requirement
  // while this app instance is already open.
  useEffect(() => {
    let cancelled = false;
    checkForceUpdate().then((info) => { if (!cancelled) setForceUpdateInfo(info); });
    const unsubscribe = subscribeToForceUpdateChanges((info) => { if (!cancelled) setForceUpdateInfo(info); });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // Password-reset emails (Login's "Forgot Password") link back here with
  // a recovery token in the URL hash. detectSessionInUrl is off (see
  // lib/supabase.js) to avoid touching the auth-timing behavior tuned
  // elsewhere in this file, so that token is parsed and applied by hand
  // instead of relying on the client library's own URL detection.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const hash = window.location.hash;
    if (!hash || !hash.includes('type=recovery')) return;

    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (!accessToken || !refreshToken) return;

    passwordRecoveryModeRef.current = true;
    setPasswordRecoveryMode(true);

    supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(({ error }) => {
      if (error) {
        console.error('Error establishing password recovery session:', error.message);
        passwordRecoveryModeRef.current = false;
        setPasswordRecoveryMode(false);
      }
    });

    // Strip the token out of the URL right away regardless of outcome, so
    // it's never left sitting in the address bar/browser history and a
    // refresh doesn't try to process it a second time.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, []);

  useEffect(() => {
    // Listen for auth state changes. Supabase fires a "SIGNED_IN" event both
    // for an actual interactive login AND for restoring an already-persisted
    // session on page load/refresh -- the event name alone can't tell them
    // apart, and racing it against getSession()'s own resolution isn't
    // reliable either (both settle around the same time on mount). Instead,
    // "SIGNED_IN" is only trusted once this component has been mounted for
    // a moment -- a real login always happens well after that, since it
    // requires the user to actually type credentials and submit first.
    let readyForSignInEvents = false;
    const readyTimer = setTimeout(() => {
      readyForSignInEvents = true;
    }, 500);

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthChecked(true);
    });
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setAuthChecked(true);
      if (event === 'SIGNED_IN' && readyForSignInEvents && !passwordRecoveryModeRef.current) {
        setDisclaimerVisible(true);
        justSignedInRef.current = true;
      }
    });

    // Handle screen resize events (critical for web testing & rotation)
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      setScreenWidth(window.width);
    });
    return () => {
      clearTimeout(readyTimer);
      subscription?.remove();
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session?.user?.id) {
      setAccess(null);
      // A subsequent login on the same page (no full reload) reuses this
      // component, so accessLoading must be reset here too -- otherwise it's
      // still false from the previous session and the accessLoading gate
      // below lets the render through with access still null.
      setAccessLoading(true);
      // `session` starts null on every mount and only becomes truthy once
      // getSession() resolves (async) -- authChecked is what actually marks
      // "we've confirmed there's no session" vs. "haven't checked yet".
      // Without this guard, that transient null-session window on every
      // single page load (refresh included) would immediately wipe the
      // just-restored tab below, before the real session even had a chance
      // to come back -- which was quietly undoing the whole "stay on
      // refresh" fix every time.
      if (authChecked) {
        // Clears whatever tab was remembered for the account that just
        // signed out, so a different account signing in on this same
        // browser afterward never inherits it.
        clearStoredTab();
        setCurrentTab('home');
      }
      return;
    }
    loadAccess(session.user.id);
  }, [session?.user?.id, authChecked]);

  // Once access loads: an Admin on a genuine fresh sign-in (never a refresh
  // -- see justSignedInRef above) lands on Admin Dashboard first. Otherwise,
  // steer away from the default 'home' tab only if the signed-in account
  // isn't allowed to see it -- a refreshed page's restored tab (read from
  // storage into currentTab's initial state) is left alone either way.
  useEffect(() => {
    if (accessLoading || !access) return;

    if (justSignedInRef.current) {
      justSignedInRef.current = false;
      if (access.roleName === 'Admin' && access.allowedPages.includes('adminDashboard')) {
        setCurrentTab('adminDashboard');
        return;
      }
    }

    if (currentTab !== 'home') return;
    if (access.allowedPages.includes('home')) return;
    setCurrentTab(access.allowedPages[0] || 'profile');
  }, [accessLoading, access]);

  // Only the very first load should block the screen with the full-page
  // spinner below. Later calls (e.g. onAccessChanged firing after a Roles &
  // Page Access checkbox toggle) must update `access` silently in the
  // background — flipping accessLoading back to true here would unmount
  // the whole dashboard (including whatever screen triggered the refresh)
  // and remount it, which reads as the page reloading on every click.
  async function loadAccess(userId) {
    try {
      const context = await fetchAccessContext(userId);
      setAccess(context);
    } catch (err) {
      console.error('Error loading access context:', err.message);
      setAccess((prev) => prev ?? { profile: null, roleName: null, isAdmin: false, allowedPages: [] });
    } finally {
      setAccessLoading(false);
    }
  }

  async function loadUnreadMessageCount() {
    try {
      const { data, error } = await supabase.rpc('get_my_conversations');
      if (error) throw error;
      setUnreadMessageCount((data || []).reduce((sum, c) => sum + (c.unread_count || 0), 0));
    } catch (err) {
      console.error('Error loading unread message count:', err.message);
    }
  }

  // Messaging: an app-wide subscription (independent of whether the
  // Messages screen is mounted) drives the sidebar/header unread badge and
  // a toast when a message arrives while the account is looking at
  // something else. RLS on "messages" limits delivery to rows this
  // account can actually see (its own conversations), so no manual
  // filtering by conversation id is needed here.
  useEffect(() => {
    if (!session?.user?.id) {
      setUnreadMessageCount(0);
      return undefined;
    }

    loadUnreadMessageCount();

    const channel = supabase
      .channel('global_messages_watch')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        async (payload) => {
          if (payload.new.sender_id === session.user.id) return;
          loadUnreadMessageCount();
          if (currentTabRef.current !== 'messages') {
            const { data: senderProfile } = await supabase
              .from('profiles')
              .select('full_name, email')
              .eq('id', payload.new.sender_id)
              .maybeSingle();
            setMessageToast({
              name: senderProfile?.full_name || senderProfile?.email || 'Someone',
              body: payload.new.body,
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id]);

  async function loadPendingChangeRequestCount() {
    try {
      const { count, error } = await supabase
        .from('member_change_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending');
      if (error) throw error;
      setPendingChangeRequestCount(count || 0);
    } catch (err) {
      console.error('Error loading pending change request count:', err.message);
    }
  }

  // Drives the "Change Requests" sidebar badge -- only fetched/subscribed
  // for accounts that can actually see that page (Admins/Moderators; RLS on
  // member_change_requests also only exposes the full pending count to
  // them), same app-wide-regardless-of-current-tab approach as the
  // messages unread count above.
  useEffect(() => {
    if (!session?.user?.id || !access?.allowedPages?.includes('memberChangeQueue')) {
      setPendingChangeRequestCount(0);
      return undefined;
    }

    loadPendingChangeRequestCount();

    const channel = supabase
      .channel('global_change_requests_watch')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'member_change_requests' },
        () => loadPendingChangeRequestCount()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id, access?.allowedPages]);

  useEffect(() => {
    if (!messageToast) return undefined;
    const timer = setTimeout(() => setMessageToast(null), 5000);
    return () => clearTimeout(timer);
  }, [messageToast]);

  // Registers this device for push notifications once signed in -- no-ops
  // on web and fails soft (see src/lib/pushNotifications.js) when running
  // in Expo Go or before `eas init` has populated a real projectId.
  useEffect(() => {
    if (!session?.user?.id) return;
    registerForPushNotificationsAsync(session.user.id);
  }, [session?.user?.id]);

  // Marks this session "online" on the shared presence channel for as long
  // as a session exists -- see src/lib/presence.js. Portal Users reads the
  // live result of this. Cleanup (untrack) runs on sign-out; a closed
  // tab/killed app is handled by Realtime itself once the socket drops.
  useEffect(() => {
    if (!session?.user?.id) return undefined;
    return trackPresence(session.user.id);
  }, [session?.user?.id]);

  // Tapping a delivered push notification routes to wherever it's about:
  // a message notification jumps straight to that conversation (reusing
  // the same mechanism MemberChangeQueue's "Message" button uses to do
  // the same thing from inside the app); a change-request notification
  // jumps to the Change Requests queue, if this account can still see it.
  useEffect(() => {
    const subscription = addNotificationTapListener((data) => {
      if (data.conversationId) {
        openConversationInMessages(data.conversationId);
      } else if (data.type === 'changeRequest' && access?.allowedPages?.includes('memberChangeQueue')) {
        handleSelectTab('memberChangeQueue');
      }
    });
    return () => subscription.remove();
  }, [access?.allowedPages]);

  // Checked before everything else, including auth -- an outdated native
  // build shouldn't be able to reach the Login screen, let alone the app
  // itself. Nothing renders behind the modal.
  if (forceUpdateInfo) {
    return (
      <SafeAreaView style={[styles.container, styles.centeredFull]}>
        <ForceUpdateModal visible storeUrl={forceUpdateInfo.storeUrl} message={forceUpdateInfo.message} />
      </SafeAreaView>
    );
  }

  // Reading the persisted session out of storage is async -- until that
  // first check resolves, "no session yet" doesn't mean "logged out". Show
  // a neutral spinner instead of flashing the Login screen every refresh.
  if (!authChecked) {
    return (
      <SafeAreaView style={[styles.container, styles.centeredFull]}>
        <ActivityIndicator size="large" color="#002060" />
      </SafeAreaView>
    );
  }

  // Checked before the normal !session branch -- setSession() from the
  // recovery link's token already makes `session` truthy, but the whole
  // point of that link is letting the user pick a new password, not
  // silently dropping them into the dashboard with their old one intact.
  if (passwordRecoveryMode) {
    return <ResetPassword onDone={() => setPasswordRecoveryMode(false)} />;
  }

  if (!session) {
    return <Login />;
  }

  if (accessLoading) {
    return (
      <SafeAreaView style={[styles.container, styles.centeredFull]}>
        <ActivityIndicator size="large" color="#002060" />
      </SafeAreaView>
    );
  }

  const isLargeScreen = screenWidth >= 768; // Desktop / Tablet breakpoint

  const allowedPageKeys = new Set(access?.allowedPages || []);
  const visibleNavItems = NAV_ITEMS.filter((item) => allowedPageKeys.has(item.key));
  const canView = (pageKey) => allowedPageKeys.has(pageKey);
  const headerPortalLabel = access?.roleName ? `${access.roleName.toUpperCase()} PORTAL` : 'MEMBERS PORTAL';

  // The effect above steers to the right tab once access loads, but that's
  // a state update applied after render -- there's an in-between render,
  // right as access finishes loading, where currentTab hasn't caught up
  // yet. Computing the effective tab here instead of waiting for that
  // effect to land means the very first render after access loads already
  // shows the right page: Admin Dashboard for an Admin's fresh sign-in, or
  // (same as before) the first allowed page if the restored/default tab
  // turns out to be 'home' and this account can't see it.
  const effectiveTab = justSignedInRef.current && access?.roleName === 'Admin' && access.allowedPages.includes('adminDashboard')
    ? 'adminDashboard'
    : currentTab === 'home' && access && !canView('home')
      ? (access.allowedPages[0] || 'profile')
      : currentTab;

  function handleSelectTab(tabKey) {
    if (tabKey !== currentTab) logPageView(tabKey);
    setCurrentTab(tabKey);
    setIsMobileMenuOpen(false);
  }

  function openConversationInMessages(conversationId) {
    setPendingConversationId(conversationId);
    handleSelectTab('messages');
  }

  // Page views have no underlying table row to trigger off of, so they're
  // logged directly from here into the same audit_log the System Audit Log
  // screen reads -- table_name is prefixed "page:" so it can never collide
  // with (or be mistaken for) an actual data table's rows in that log.
  function logPageView(tabKey) {
    if (!session?.user?.id) return;
    supabase
      .from('audit_log')
      .insert([{
        table_name: `page:${tabKey}`,
        action: 'PAGE_VIEW',
        actor_id: session.user.id,
        actor_email: session.user.email,
        new_data: { page: PAGE_VIEW_LABELS[tabKey] || tabKey },
      }])
      .then(({ error }) => {
        if (error) console.error('Error logging page view:', error.message);
      });
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Header Row */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          {!isLargeScreen && (
            <TouchableOpacity
              style={styles.menuToggleButton}
              onPress={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name={isMobileMenuOpen ? 'close' : 'menu'} size={24} color="#fff" />
            </TouchableOpacity>
          )}
          <Text style={styles.headerTitle}>ORACLE</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>{headerPortalLabel}</Text>
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.headerMessagesButton}
            onPress={() => handleSelectTab('messages')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="chatbubbles-outline" size={20} color="#fff" />
            {unreadMessageCount > 0 && (
              <View style={styles.headerMessagesBadge}>
                <Text style={styles.headerMessagesBadgeText}>{unreadMessageCount > 99 ? '99+' : unreadMessageCount}</Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.headerAvatarButton}
            onPress={() => handleSelectTab('profile')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {session.user?.user_metadata?.avatar_url ? (
              <Image source={{ uri: session.user.user_metadata.avatar_url }} style={styles.headerAvatarImage} />
            ) : (
              <View style={styles.headerAvatarFallback}>
                <Text style={styles.headerAvatarFallbackText}>
                  {(session.user?.email || '?').slice(0, 2).toUpperCase()}
                </Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.headerLogoutButton}
            onPress={() => supabase.auth.signOut()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="log-out-outline" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Primary Workspace Layout */}
      <View style={styles.dashboardBody}>
        
        {/* SIDEBAR: Rendered permanently on Web/Desktop, collapsible to icon-only */}
        {isLargeScreen && (
          <View style={[styles.permanentSidebar, isSidebarCollapsed && styles.permanentSidebarCollapsed]}>
            <SidebarPanel
              currentTab={currentTab}
              onSelectTab={handleSelectTab}
              collapsed={isSidebarCollapsed}
              session={session}
              showCollapseToggle
              onToggleCollapse={() => setIsSidebarCollapsed((v) => !v)}
              navItems={visibleNavItems}
              roleName={access?.roleName}
              badgeCounts={{ memberChangeQueue: pendingChangeRequestCount }}
            />
          </View>
        )}

        {/* MOBILE OVERLAY DRAWER: Slid open temporarily on smaller screens (always expanded) */}
        {!isLargeScreen && isMobileMenuOpen && (
          <View style={styles.mobileDrawerOverlay}>
            <View style={styles.mobileDrawerContent}>
              <SidebarPanel
                currentTab={currentTab}
                onSelectTab={handleSelectTab}
                collapsed={false}
                session={session}
                showCollapseToggle={false}
                navItems={visibleNavItems}
                roleName={access?.roleName}
                badgeCounts={{ memberChangeQueue: pendingChangeRequestCount }}
              />
            </View>
            <TouchableOpacity style={styles.drawerDismissZone} onPress={() => setIsMobileMenuOpen(false)} />
          </View>
        )}

        {/* MAIN DYNAMIC SCREEN CONTENT */}
        <View style={styles.mainContentPane}>
          {effectiveTab === 'home' && canView('home') && <DashboardHome onNavigate={setCurrentTab} roleName={access?.roleName} />}
          {effectiveTab === 'adminDashboard' && canView('adminDashboard') && <AdminDashboard />}
          {effectiveTab === 'members' && canView('members') && <MembersList roleName={access?.roleName} />}
          {effectiveTab === 'myChangeRequests' && canView('myChangeRequests') && <MyChangeRequests />}
          {effectiveTab === 'manageMembers' && canView('manageMembers') && <ManageMembers />}
          {effectiveTab === 'pfo' && canView('pfo') && <PfoList />}
          {effectiveTab === 'pfoReports' && canView('pfoReports') && <PfoReport />}
          {effectiveTab === 'pfoStats' && canView('pfoStats') && <PfoStatGenerator />}
          {effectiveTab === 'clp' && canView('clp') && <ClpMaintenance />}
          {effectiveTab === 'portalUsers' && canView('portalUsers') && (
            <PortalUsers onAccessChanged={() => loadAccess(session.user.id)} />
          )}
          {effectiveTab === 'logs' && canView('logs') && <Logs />}
          {effectiveTab === 'memberChangeQueue' && canView('memberChangeQueue') && (
            <MemberChangeQueue onOpenConversation={openConversationInMessages} />
          )}
          {effectiveTab === 'settings' && canView('settings') && (
            <Settings onAccessChanged={() => loadAccess(session.user.id)} />
          )}
          {effectiveTab === 'predictor' && <PredictorScreen />}
          {effectiveTab === 'profile' && <ProfileScreen />}
          {effectiveTab === 'messages' && (
            <Messages
              onConversationsChanged={(convos) => setUnreadMessageCount(convos.reduce((sum, c) => sum + (c.unread_count || 0), 0))}
              initialConversationId={pendingConversationId}
              onInitialConversationHandled={() => setPendingConversationId(null)}
            />
          )}
          {NAV_ITEMS.some((item) => item.key === effectiveTab) && !canView(effectiveTab) && (
            <View style={styles.noAccessWrap}>
              <Ionicons name="lock-closed-outline" size={28} color="#94a3b8" />
              <Text style={styles.noAccessText}>
                {access?.roleName
                  ? "You don't have access to this page yet. Ask an Admin to grant it."
                  : 'Your account has no role assigned yet. Ask an Admin to assign one.'}
              </Text>
            </View>
          )}
        </View>
      </View>

      {messageToast && (
        <TouchableOpacity
          style={styles.toast}
          activeOpacity={0.9}
          onPress={() => { setMessageToast(null); handleSelectTab('messages'); }}
        >
          <Ionicons name="chatbubble-ellipses" size={18} color="#60a5fa" style={styles.toastIcon} />
          <View style={{ flex: 1 }}>
            <Text style={styles.toastName} numberOfLines={1}>{messageToast.name}</Text>
            <Text style={styles.toastBody} numberOfLines={2}>{messageToast.body}</Text>
          </View>
          <TouchableOpacity
            style={styles.toastClose}
            onPress={() => setMessageToast(null)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close" size={16} color="rgba(255,255,255,0.7)" />
          </TouchableOpacity>
        </TouchableOpacity>
      )}

      <Modal visible={disclaimerVisible} transparent animationType="fade" onRequestClose={() => setDisclaimerVisible(false)}>
        <View style={styles.disclaimerOverlay}>
          <View style={styles.disclaimerCard}>
            <View style={styles.disclaimerIconRing}>
              <Ionicons name="information-circle-outline" size={26} color="#002060" />
            </View>
            <Text style={styles.disclaimerTitle}>Before You Continue</Text>

            <ScrollView style={styles.disclaimerScroll} showsVerticalScrollIndicator={false}>
              <Text style={styles.disclaimerText}>
                This application is not intended to replace the official OGD portal. It is only being used as a
                tool to generate reports.
              </Text>
              <Text style={styles.disclaimerText}>
                Because of this, it should always be kept up to date whenever there are changes or movement in
                the OGD data.
              </Text>
              <Text style={styles.disclaimerText}>
                If you have any concerns, please don&apos;t hesitate to message the moderators — they&apos;ll get back to
                you as soon as they see it.
              </Text>

              <Text style={styles.disclaimerSectionTitle}>Data Privacy Notice</Text>
              <Text style={styles.disclaimerText}>
                As a portal account, you can access CFC member records — including names, Area/Chapter
                assignments, and Pastoral Formation (PFO) / Christian Life Program (CLP) records — scoped to
                whatever your assigned role and Area allow. Every view, add, edit, and delete you make is
                logged (System Audit Log) for accountability.
              </Text>
              <Text style={styles.disclaimerText}>
                Handle this data the same way you&apos;d want your own handled: only for legitimate formation
                and reporting purposes, never shared outside authorized channels. Data is stored with
                Supabase, our cloud database provider.
              </Text>
              <Text style={styles.disclaimerText}>
                Under the Data Privacy Act of 2012 (RA 10173), members whose data you can see have the right
                to access, correct, or request deletion of their own information — direct such requests to
                the moderators below.
              </Text>

              <TouchableOpacity
                style={styles.disclaimerEmailRow}
                onPress={() => Linking.openURL('mailto:jamesryanpatiag@gmail.com')}
              >
                <Ionicons name="mail-outline" size={14} color="#334155" style={{ marginRight: 6 }} />
                <Text style={styles.disclaimerEmailText}>jamesryanpatiag@gmail.com</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.disclaimerEmailRow}
                onPress={() => Linking.openURL('mailto:markjosephreyes1513@gmail.com')}
              >
                <Ionicons name="mail-outline" size={14} color="#334155" style={{ marginRight: 6 }} />
                <Text style={styles.disclaimerEmailText}>markjosephreyes1513@gmail.com</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.disclaimerEmailRow}
                onPress={() => Linking.openURL('mailto:bryanmunoz28@yahoo.com')}
              >
                <Ionicons name="mail-outline" size={14} color="#334155" style={{ marginRight: 6 }} />
                <Text style={styles.disclaimerEmailText}>bryanmunoz28@yahoo.com</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.disclaimerEmailRow}
                onPress={() => Linking.openURL('mailto:bentiung02421@gmail.com')}
              >
                <Ionicons name="mail-outline" size={14} color="#334155" style={{ marginRight: 6 }} />
                <Text style={styles.disclaimerEmailText}>bentiung02421@gmail.com</Text>
              </TouchableOpacity>
            </ScrollView>

            <View style={styles.disclaimerActions}>
              <TouchableOpacity
                style={styles.disclaimerSecondaryBtn}
                onPress={() => { setDisclaimerVisible(false); handleSelectTab('messages'); }}
              >
                <Ionicons name="chatbubbles-outline" size={14} color="#002060" style={{ marginRight: 6 }} />
                <Text style={styles.disclaimerSecondaryBtnText}>Message a Moderator</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.disclaimerPrimaryBtn} onPress={() => setDisclaimerVisible(false)}>
                <Text style={styles.disclaimerPrimaryBtnText}>I Understand</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  centeredFull: { justifyContent: 'center', alignItems: 'center' },

  // Header Adjustments
  header: { backgroundColor: '#002060', paddingVertical: 14, paddingHorizontal: 20, borderBottomWidth: 1, borderColor: '#001540', zIndex: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerContent: { flexDirection: 'row', alignItems: 'center' },
  menuToggleButton: { marginRight: 16, padding: 4 },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#fff', letterSpacing: 2 },
  headerSubtitle: { fontSize: 11, color: '#93c5fd', marginLeft: 10, letterSpacing: 1, fontWeight: '500', marginTop: 4 },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  headerMessagesButton: { marginRight: 14, padding: 4, position: 'relative' },
  headerMessagesBadge: {
    position: 'absolute', top: -2, right: -4, backgroundColor: '#ef4444', borderRadius: 9,
    minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
    borderWidth: 1.5, borderColor: '#002060',
  },
  headerMessagesBadgeText: { color: '#ffffff', fontSize: 9, fontWeight: '800' },

  toast: {
    position: 'absolute', top: 70, right: 16, maxWidth: 340, backgroundColor: '#0f172a', borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'flex-start', zIndex: 200,
    ...Platform.select({
      web: { boxShadow: '0 8px 24px rgba(2,6,23,0.35)' },
      default: { shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 10 },
    }),
  },
  toastIcon: { marginRight: 10, marginTop: 2 },
  toastName: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
  toastBody: { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 2 },
  toastClose: { marginLeft: 10, padding: 2 },

  disclaimerOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  disclaimerCard: {
    backgroundColor: '#ffffff', borderRadius: 18, padding: 22, width: '100%', maxWidth: 600, maxHeight: '88%',
    ...Platform.select({
      web: { boxShadow: '0 12px 32px rgba(2,6,23,0.3)' },
      default: { shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 12 },
    }),
  },
  disclaimerIconRing: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: '#eff6ff',
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  disclaimerTitle: { fontSize: 17, fontWeight: '800', color: '#0f172a', marginBottom: 12 },
  // flexShrink lets this scrollable section give up space to the title and
  // the action buttons below it when the card hits its own maxHeight,
  // instead of a fixed pixel value that's cramped on a big screen or
  // overflowing on a small one.
  disclaimerScroll: { flexShrink: 1 },
  disclaimerSectionTitle: { fontSize: 13, fontWeight: '800', color: '#0f172a', marginTop: 6, marginBottom: 8 },
  disclaimerText: { fontSize: 13, color: '#334155', lineHeight: 19, marginBottom: 10 },
  disclaimerEmailRow: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: '#f8fafc',
    borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, marginTop: 4, marginBottom: 4,
  },
  disclaimerEmailText: { fontSize: 12, fontWeight: '700', color: '#334155' },
  disclaimerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
  disclaimerSecondaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#eff6ff',
    borderWidth: 1, borderColor: '#bfdbfe', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, flex: 1,
  },
  disclaimerSecondaryBtnText: { fontSize: 13, fontWeight: '700', color: '#002060' },
  disclaimerPrimaryBtn: { backgroundColor: '#002060', borderRadius: 10, paddingHorizontal: 18, paddingVertical: 11, flex: 1, alignItems: 'center' },
  disclaimerPrimaryBtnText: { fontSize: 13, fontWeight: '700', color: '#ffffff' },
  headerAvatarButton: { marginRight: 12 },
  headerAvatarImage: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
  headerAvatarFallback: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#1e3a8a', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
  headerAvatarFallbackText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  headerLogoutButton: { padding: 6, borderRadius: 8 },
  
  // Dashboard Structure split
  dashboardBody: { flex: 1, flexDirection: 'row', position: 'relative' },
  
  // Web Admin Sidebar Architecture — transparent "glass" card floating over a gradient backdrop
  permanentSidebar: { width: 260 },
  permanentSidebarCollapsed: { width: 92 },
  sidebarGradient: { flex: 1, padding: 12 },
  glassPanel: {
    flex: 1, borderRadius: 22, padding: 16,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
    ...Platform.select({
      web: { backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', boxShadow: '0 8px 32px rgba(2, 6, 23, 0.45)' },
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 20, elevation: 8 },
    }),
  },
  glassPanelCollapsed: { paddingHorizontal: 8, alignItems: 'center' },
  glassDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.16)', marginVertical: 14 },

  trafficLights: { flexDirection: 'row', gap: 6 },
  trafficLightsCollapsed: { justifyContent: 'center' },
  trafficDot: { width: 10, height: 10, borderRadius: 5 },

  brandRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
  brandRowCollapsed: { marginTop: 12 },
  brandMark: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center', justifyContent: 'center', marginRight: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
  },
  brandMarkLogo: { width: 21, height: 18 },
  brandTitle: { color: '#fff', fontWeight: '800', fontSize: 15, letterSpacing: 1.5 },
  brandSubtitle: { color: 'rgba(226,232,255,0.65)', fontSize: 10, fontWeight: '500', letterSpacing: 0.5, marginTop: 2 },

  accountRow: { flexDirection: 'row', alignItems: 'center' },
  accountRowCollapsed: { justifyContent: 'center' },
  accountAvatar: { width: 34, height: 34, borderRadius: 17, marginRight: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  accountAvatarFallback: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center', justifyContent: 'center', marginRight: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)',
  },
  accountAvatarFallbackText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  accountTextWrap: { flexShrink: 1 },
  accountName: { color: '#fff', fontSize: 13, fontWeight: '700', maxWidth: 150 },
  accountCaption: { color: 'rgba(226,232,255,0.6)', fontSize: 11, fontWeight: '500', marginTop: 1 },

  menuLabel: { color: 'rgba(226,232,255,0.5)', fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: 10 },

  collapseToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    width: '100%', paddingVertical: 10, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', marginBottom: 14,
  },
  collapseToggleCollapsed: { width: 44, paddingVertical: 10, paddingHorizontal: 0, alignSelf: 'center' },
  collapseToggleText: { marginLeft: 8, fontSize: 13, fontWeight: '700', color: 'rgba(226,232,255,0.85)' },
  navScroll: { flex: 1 },
  navLinksContainer: {},
  sidebarButton: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, marginBottom: 6 },
  sidebarButtonCollapsed: { justifyContent: 'center', paddingHorizontal: 0 },
  activeSidebarButton: { backgroundColor: 'rgba(255,255,255,0.16)' },
  sidebarButtonText: { fontSize: 14, color: 'rgba(226,232,255,0.75)', fontWeight: '600', flexShrink: 1 },
  sidebarIcon: { marginRight: 10 },
  sidebarIconWrapCollapsed: { position: 'relative' },
  sidebarIconBadge: {
    position: 'absolute', top: -6, right: -8, backgroundColor: '#ef4444', borderRadius: 8,
    minWidth: 15, height: 15, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
    borderWidth: 1.5, borderColor: '#1d3f9e',
  },
  sidebarIconBadgeText: { color: '#ffffff', fontSize: 8, fontWeight: '800' },
  sidebarPillBadge: {
    marginLeft: 8, backgroundColor: '#ef4444', borderRadius: 20,
    minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
  },
  sidebarPillBadgeText: { color: '#ffffff', fontSize: 11, fontWeight: '800' },
  activeSidebarText: { color: '#ffffff', fontWeight: '700' },
  logoutButton: { backgroundColor: 'rgba(248,113,113,0.14)', marginTop: 0, marginBottom: 0 },
  logoutText: { color: '#f87171', fontWeight: '600' },
  versionText: { fontSize: 10, color: 'rgba(226,232,255,0.45)', textAlign: 'center', marginTop: 10, fontWeight: '500' },

  // Mobile Modal Drawer Styling
  mobileDrawerOverlay: { ...StyleSheet.absoluteFillObject, flexDirection: 'row', zIndex: 5 },
  mobileDrawerContent: { width: 250, height: '100%' },
  drawerDismissZone: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.4)' },
  
  // Content view pane
  mainContentPane: { flex: 1, backgroundColor: '#f8fafc' },
  noAccessWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  noAccessText: { marginTop: 12, fontSize: 13, color: '#64748b', textAlign: 'center', maxWidth: 320 },
});
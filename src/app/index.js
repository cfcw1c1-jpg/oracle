import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { supabase } from '../../lib/supabase';
import packageJson from '../../package.json';
import Login from '../auth/Login';
import { fetchAccessContext } from '../lib/access';
import Areas from '../screens/Areas';
import AuditLogs from '../screens/AuditLogs';
import ClpMaintenance from '../screens/ClpMaintenance'; // Imported the new CLP Maintenance screen
import DashboardHome from '../screens/DashboardHome';
import ImportCsv from '../screens/ImportCsv';
import MembersList from '../screens/MembersList';
import PfoList from '../screens/PfoList';
import PfoReport from '../screens/PfoReports';
import PfoStatGenerator from '../screens/PfoStatGenerator';
import PortalUsers from '../screens/PortalUsers';
import PredictorScreen from '../screens/PredictorScreen';
import ProfileScreen from '../screens/ProfileScreen';
import RolesAccess from '../screens/RolesAccess';

const NAV_ITEMS = [
  { key: 'home', label: 'Dashboard', icon: 'home-outline' },
  { key: 'members', label: 'Directory', icon: 'people-outline' },
  { key: 'pfo', label: 'PFO Trainings', icon: 'bar-chart-outline' },
  { key: 'pfoReports', label: 'PFO Reports', icon: 'trending-up-outline' },
  { key: 'pfoStats', label: 'Formation Stats', icon: 'analytics-outline' },
  { key: 'clp', label: 'CLP Maintenance', icon: 'construct-outline' },
  { key: 'auditLogs', label: 'Audit Logs', icon: 'terminal-outline' },
  { key: 'portalUsers', label: 'Portal Users', icon: 'people-circle-outline' },
  { key: 'rolesAccess', label: 'Roles & Page Access', icon: 'key-outline' },
  { key: 'areas', label: 'Areas', icon: 'git-network-outline' },
  { key: 'csvImport', label: 'Import CSV', icon: 'cloud-upload-outline' },
];

const SIDEBAR_GRADIENT = ['#05061a', '#0b1e4d', '#1d3f9e', '#5b21b6'];

// Shared by the permanent (wide-screen) sidebar and the mobile drawer.
// Renders a floating "glass" card (blurred/translucent) over a navy-to-violet
// gradient backdrop, matching the transparent sidebar design reference.
function SidebarPanel({ currentTab, onSelectTab, collapsed, session, showCollapseToggle, onToggleCollapse, navItems, roleName }) {
  const avatarUrl = session?.user?.user_metadata?.avatar_url;
  const email = session?.user?.email;
  const portalLabel = roleName ? `${roleName} Portal` : 'Members Portal';

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
            <Text style={styles.brandMarkText}>O</Text>
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

        {!collapsed && <Text style={styles.menuLabel}>MENU</Text>}

        <View style={styles.navLinksContainer}>
          {navItems.map((item) => {
            const isActive = currentTab === item.key;
            return (
              <TouchableOpacity
                key={item.key}
                style={[styles.sidebarButton, collapsed && styles.sidebarButtonCollapsed, isActive && styles.activeSidebarButton]}
                onPress={() => onSelectTab(item.key)}
              >
                <Ionicons name={item.icon} size={18} color={isActive ? '#ffffff' : 'rgba(226,232,255,0.65)'} style={!collapsed && styles.sidebarIcon} />
                {!collapsed && (
                  <Text style={[styles.sidebarButtonText, isActive && styles.activeSidebarText]} numberOfLines={1}>{item.label}</Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

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
  const [currentTab, setCurrentTab] = useState('home');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [access, setAccess] = useState(null);
  const [accessLoading, setAccessLoading] = useState(true);

  // Track window dimensions for real-time web/mobile switching
  const [screenWidth, setScreenWidth] = useState(Dimensions.get('window').width);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    // Listen for auth state changes
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
    supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    // Handle screen resize events (critical for web testing & rotation)
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      setScreenWidth(window.width);
    });
    return () => subscription?.remove();
  }, []);

  useEffect(() => {
    if (!session?.user?.id) {
      setAccess(null);
      return;
    }
    loadAccess(session.user.id);
  }, [session?.user?.id]);

  // Once access loads, steer away from the default 'home' tab if the
  // signed-in account isn't allowed to see it.
  useEffect(() => {
    if (accessLoading || !access) return;
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

  function handleSelectTab(tabKey) {
    setCurrentTab(tabKey);
    setIsMobileMenuOpen(false);
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
            >
              <Ionicons name={isMobileMenuOpen ? 'close' : 'menu'} size={24} color="#fff" />
            </TouchableOpacity>
          )}
          <Text style={styles.headerTitle}>ORACLE</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>{headerPortalLabel}</Text>
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.headerAvatarButton}
            onPress={() => handleSelectTab('profile')}
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
              />
            </View>
            <TouchableOpacity style={styles.drawerDismissZone} onPress={() => setIsMobileMenuOpen(false)} />
          </View>
        )}

        {/* MAIN DYNAMIC SCREEN CONTENT */}
        <View style={styles.mainContentPane}>
          {currentTab === 'home' && canView('home') && <DashboardHome onNavigate={setCurrentTab} />}
          {currentTab === 'members' && canView('members') && <MembersList />}
          {currentTab === 'pfo' && canView('pfo') && <PfoList />}
          {currentTab === 'pfoReports' && canView('pfoReports') && <PfoReport />}
          {currentTab === 'pfoStats' && canView('pfoStats') && <PfoStatGenerator />}
          {currentTab === 'clp' && canView('clp') && <ClpMaintenance />}
          {currentTab === 'auditLogs' && canView('auditLogs') && <AuditLogs />}
          {currentTab === 'portalUsers' && canView('portalUsers') && (
            <PortalUsers onAccessChanged={() => loadAccess(session.user.id)} />
          )}
          {currentTab === 'rolesAccess' && canView('rolesAccess') && (
            <RolesAccess onAccessChanged={() => loadAccess(session.user.id)} />
          )}
          {currentTab === 'areas' && canView('areas') && <Areas />}
          {currentTab === 'csvImport' && canView('csvImport') && <ImportCsv />}
          {currentTab === 'predictor' && <PredictorScreen />}
          {currentTab === 'profile' && <ProfileScreen />}
          {NAV_ITEMS.some((item) => item.key === currentTab) && !canView(currentTab) && (
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

      {/* MOBILE BOTTOM NAV BAR FALLBACK */}
      {!isLargeScreen && (
        <View style={styles.bottomTabBar}>
          {canView('home') && (
            <TouchableOpacity
              style={[styles.tabBarItem, currentTab === 'home' && styles.activeTabItem]}
              onPress={() => setCurrentTab('home')}
            >
              <Text style={[styles.tabBarItemText, currentTab === 'home' && styles.activeTabBarText]}>Home</Text>
            </TouchableOpacity>
          )}

          {canView('members') && (
            <TouchableOpacity
              style={[styles.tabBarItem, currentTab === 'members' && styles.activeTabItem]}
              onPress={() => setCurrentTab('members')}
            >
              <Text style={[styles.tabBarItemText, currentTab === 'members' && styles.activeTabBarText]}>Directory</Text>
            </TouchableOpacity>
          )}

          {canView('pfo') && (
            <TouchableOpacity
              style={[styles.tabBarItem, currentTab === 'pfo' && styles.activeTabItem]}
              onPress={() => setCurrentTab('pfo')}
            >
              <Text style={[styles.tabBarItemText, currentTab === 'pfo' && styles.activeTabBarText]}>PFO</Text>
            </TouchableOpacity>
          )}

          {/* Replaced PFO Reports tag with CLP on the bottom mobile bar shortcut row since spacing is finite on small mobile frames */}
          {canView('clp') && (
            <TouchableOpacity
              style={[styles.tabBarItem, currentTab === 'clp' && styles.activeTabItem]}
              onPress={() => setCurrentTab('clp')}
            >
              <Text style={[styles.tabBarItemText, currentTab === 'clp' && styles.activeTabBarText]}>CLP</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
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
  brandMarkText: { color: '#fff', fontWeight: '800', fontSize: 14 },
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
  navLinksContainer: { flex: 1 },
  sidebarButton: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, marginBottom: 6 },
  sidebarButtonCollapsed: { justifyContent: 'center', paddingHorizontal: 0 },
  activeSidebarButton: { backgroundColor: 'rgba(255,255,255,0.16)' },
  sidebarButtonText: { fontSize: 14, color: 'rgba(226,232,255,0.75)', fontWeight: '600', flexShrink: 1 },
  sidebarIcon: { marginRight: 10 },
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

  // Compact Bottom Navbar layout fallback
  bottomTabBar: { flexDirection: 'row', height: 56, backgroundColor: '#ffffff', borderTopWidth: 1, borderColor: '#e2e8f0', paddingBottom: Platform.OS === 'ios' ? 16 : 0 },
  tabBarItem: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  activeTabItem: { backgroundColor: '#f8fafc' },
  tabBarItemText: { fontSize: 12, color: '#64748b', fontWeight: '500' },
  activeTabBarText: { color: '#002060', fontWeight: '700' }
});
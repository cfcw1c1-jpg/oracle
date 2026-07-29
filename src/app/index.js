import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
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
import Login from '../auth/Login';
import ClpMaintenance from '../screens/ClpMaintenance'; // Imported the new CLP Maintenance screen
import DashboardHome from '../screens/DashboardHome';
import MembersList from '../screens/MembersList';
import PfoList from '../screens/PfoList';
import PfoReport from '../screens/PfoReports';
import PfoStatGenerator from '../screens/PfoStatGenerator';
import PredictorScreen from '../screens/PredictorScreen';
import ProfileScreen from '../screens/ProfileScreen';
import packageJson from '../../package.json';

const NAV_ITEMS = [
  { key: 'home', label: 'Dashboard', icon: 'home-outline' },
  { key: 'members', label: 'Directory', icon: 'people-outline' },
  { key: 'pfo', label: 'PFO Trainings', icon: 'bar-chart-outline' },
  { key: 'pfoReports', label: 'PFO Reports', icon: 'trending-up-outline' },
  { key: 'pfoStats', label: 'Formation Stats', icon: 'analytics-outline' },
  { key: 'clp', label: 'CLP Maintenance', icon: 'construct-outline' },
];

// Shared by the permanent (wide-screen) sidebar and the mobile drawer.
function NavigationLinks({ currentTab, onSelectTab, collapsed }) {
  return (
    <View style={styles.navLinksContainer}>
      {NAV_ITEMS.map((item) => {
        const isActive = currentTab === item.key;
        return (
          <TouchableOpacity
            key={item.key}
            style={[styles.sidebarButton, collapsed && styles.sidebarButtonCollapsed, isActive && styles.activeSidebarButton]}
            onPress={() => onSelectTab(item.key)}
          >
            <Ionicons name={item.icon} size={18} color={isActive ? '#ffffff' : '#64748b'} style={!collapsed && styles.sidebarIcon} />
            {!collapsed && (
              <Text style={[styles.sidebarButtonText, isActive && styles.activeSidebarText]}>{item.label}</Text>
            )}
          </TouchableOpacity>
        );
      })}

      <View style={styles.spacer} />

      <TouchableOpacity
        style={[styles.sidebarButton, collapsed && styles.sidebarButtonCollapsed, currentTab === 'profile' && styles.activeSidebarButton]}
        onPress={() => onSelectTab('profile')}
      >
        <Ionicons name="person-circle-outline" size={18} color={currentTab === 'profile' ? '#ffffff' : '#64748b'} style={!collapsed && styles.sidebarIcon} />
        {!collapsed && (
          <Text style={[styles.sidebarButtonText, currentTab === 'profile' && styles.activeSidebarText]}>My Profile</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.sidebarButton, collapsed && styles.sidebarButtonCollapsed, styles.logoutButton]}
        onPress={() => supabase.auth.signOut()}
      >
        <Ionicons name="log-out-outline" size={18} color="#ef4444" style={!collapsed && styles.sidebarIcon} />
        {!collapsed && <Text style={styles.logoutText}>Sign Out</Text>}
      </TouchableOpacity>

      {!collapsed && <Text style={styles.versionText}>v{packageJson.version}</Text>}
    </View>
  );
}

export default function Page() {
  const [session, setSession] = useState(null);
  const [currentTab, setCurrentTab] = useState('home');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

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

  if (!session) {
    return <Login />;
  }

  const isLargeScreen = screenWidth >= 768; // Desktop / Tablet breakpoint

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
          <Text style={styles.headerSubtitle}>MEMBERS PORTAL</Text>
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
            <TouchableOpacity
              style={[styles.collapseToggle, isSidebarCollapsed && styles.collapseToggleCollapsed]}
              onPress={() => setIsSidebarCollapsed((v) => !v)}
            >
              <Ionicons name={isSidebarCollapsed ? 'chevron-forward' : 'chevron-back'} size={16} color="#64748b" />
              {!isSidebarCollapsed && <Text style={styles.collapseToggleText}>Collapse Menu</Text>}
            </TouchableOpacity>
            <NavigationLinks currentTab={currentTab} onSelectTab={handleSelectTab} collapsed={isSidebarCollapsed} />
          </View>
        )}

        {/* MOBILE OVERLAY DRAWER: Slid open temporarily on smaller screens (always expanded) */}
        {!isLargeScreen && isMobileMenuOpen && (
          <View style={styles.mobileDrawerOverlay}>
            <View style={styles.mobileDrawerContent}>
              <NavigationLinks currentTab={currentTab} onSelectTab={handleSelectTab} collapsed={false} />
            </View>
            <TouchableOpacity style={styles.drawerDismissZone} onPress={() => setIsMobileMenuOpen(false)} />
          </View>
        )}

        {/* MAIN DYNAMIC SCREEN CONTENT */}
        <View style={styles.mainContentPane}>
          {currentTab === 'home' && <DashboardHome onNavigate={setCurrentTab} />}
          {currentTab === 'members' && <MembersList />}
          {currentTab === 'pfo' && <PfoList />}
          {currentTab === 'pfoReports' && <PfoReport />}
          {currentTab === 'pfoStats' && <PfoStatGenerator />}
          {currentTab === 'clp' && <ClpMaintenance />}
          {currentTab === 'predictor' && <PredictorScreen />}
          {currentTab === 'profile' && <ProfileScreen />}
        </View>
      </View>

      {/* MOBILE BOTTOM NAV BAR FALLBACK */}
      {!isLargeScreen && (
        <View style={styles.bottomTabBar}>
          <TouchableOpacity
            style={[styles.tabBarItem, currentTab === 'home' && styles.activeTabItem]}
            onPress={() => setCurrentTab('home')}
          >
            <Text style={[styles.tabBarItemText, currentTab === 'home' && styles.activeTabBarText]}>Home</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabBarItem, currentTab === 'members' && styles.activeTabItem]}
            onPress={() => setCurrentTab('members')}
          >
            <Text style={[styles.tabBarItemText, currentTab === 'members' && styles.activeTabBarText]}>Directory</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.tabBarItem, currentTab === 'pfo' && styles.activeTabItem]} 
            onPress={() => setCurrentTab('pfo')}
          >
            <Text style={[styles.tabBarItemText, currentTab === 'pfo' && styles.activeTabBarText]}>PFO</Text>
          </TouchableOpacity>

          {/* Replaced PFO Reports tag with CLP on the bottom mobile bar shortcut row since spacing is finite on small mobile frames */}
          <TouchableOpacity 
            style={[styles.tabBarItem, currentTab === 'clp' && styles.activeTabItem]} 
            onPress={() => setCurrentTab('clp')}
          >
            <Text style={[styles.tabBarItemText, currentTab === 'clp' && styles.activeTabBarText]}>CLP</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  
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
  
  // Web Admin Sidebar Architecture
  permanentSidebar: { width: 260, backgroundColor: '#f5f6fb', borderRightWidth: 1, borderColor: '#e7e8f2', padding: 16 },
  permanentSidebarCollapsed: { width: 76, paddingHorizontal: 10 },
  collapseToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    width: '100%', paddingVertical: 10, borderRadius: 8, backgroundColor: '#ffffff',
    borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 14,
  },
  collapseToggleCollapsed: { width: 44, paddingVertical: 10, paddingHorizontal: 0, alignSelf: 'center' },
  collapseToggleText: { marginLeft: 8, fontSize: 13, fontWeight: '700', color: '#475569' },
  navLinksContainer: { flex: 1 },
  sidebarButton: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, marginBottom: 6 },
  sidebarButtonCollapsed: { justifyContent: 'center', paddingHorizontal: 0 },
  activeSidebarButton: { backgroundColor: '#002060' },
  sidebarButtonText: { fontSize: 14, color: '#475569', fontWeight: '600' },
  sidebarIcon: { marginRight: 10 },
  activeSidebarText: { color: '#ffffff', fontWeight: '700' },
  spacer: { flex: 1 },
  logoutButton: { backgroundColor: '#fef2f2', marginTop: 'auto' },
  logoutText: { color: '#ef4444', fontWeight: '600' },
  versionText: { fontSize: 10, color: '#94a3b8', textAlign: 'center', marginTop: 10, fontWeight: '500' },
  
  // Mobile Modal Drawer Styling 
  mobileDrawerOverlay: { ...StyleSheet.absoluteFillObject, flexDirection: 'row', zIndex: 5 },
  mobileDrawerContent: { width: 250, backgroundColor: '#ffffff', padding: 16, height: '100%', borderRightWidth: 1, borderColor: '#e2e8f0' },
  drawerDismissZone: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.4)' },
  
  // Content view pane
  mainContentPane: { flex: 1, backgroundColor: '#f8fafc' },

  // Compact Bottom Navbar layout fallback
  bottomTabBar: { flexDirection: 'row', height: 56, backgroundColor: '#ffffff', borderTopWidth: 1, borderColor: '#e2e8f0', paddingBottom: Platform.OS === 'ios' ? 16 : 0 },
  tabBarItem: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  activeTabItem: { backgroundColor: '#f8fafc' },
  tabBarItemText: { fontSize: 12, color: '#64748b', fontWeight: '500' },
  activeTabBarText: { color: '#002060', fontWeight: '700' }
});
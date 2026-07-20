import { useEffect, useState } from 'react';
import {
    Dimensions,
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
import MembersList from '../screens/MembersList';
import PfoList from '../screens/PfoList';
import PfoReport from '../screens/PfoReports';
import PredictorScreen from '../screens/PredictorScreen';

export default function Page() {
  const [session, setSession] = useState(null);
  const [currentTab, setCurrentTab] = useState('members'); 
  
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

  // Reusable Sidebar Nav Links Component
  const NavigationLinks = () => (
    <View style={styles.navLinksContainer}>
      <TouchableOpacity 
        style={[styles.sidebarButton, currentTab === 'members' && styles.activeSidebarButton]} 
        onPress={() => { setCurrentTab('members'); setIsMobileMenuOpen(false); }}
      >
        <Text style={[styles.sidebarButtonText, currentTab === 'members' && styles.activeSidebarText]}>👥 Directory</Text>
      </TouchableOpacity>

      <TouchableOpacity 
        style={[styles.sidebarButton, currentTab === 'pfo' && styles.activeSidebarButton]} 
        onPress={() => { setCurrentTab('pfo'); setIsMobileMenuOpen(false); }}
      >
        <Text style={[styles.sidebarButtonText, currentTab === 'pfo' && styles.activeSidebarText]}>📊 PFO Trainings</Text>
      </TouchableOpacity>

      <TouchableOpacity 
        style={[styles.sidebarButton, currentTab === 'pfoReports' && styles.activeSidebarButton]} 
        onPress={() => { setCurrentTab('pfoReports'); setIsMobileMenuOpen(false); }}
      >
        <Text style={[styles.sidebarButtonText, currentTab === 'pfoReports' && styles.activeSidebarText]}>📈 PFO Reports</Text>
      </TouchableOpacity>

      {/* Added CLP Maintenance to the Navigation Drawer Menu */}
      <TouchableOpacity 
        style={[styles.sidebarButton, currentTab === 'clp' && styles.activeSidebarButton]} 
        onPress={() => { setCurrentTab('clp'); setIsMobileMenuOpen(false); }}
      >
        <Text style={[styles.sidebarButtonText, currentTab === 'clp' && styles.activeSidebarText]}>🛠️ CLP Maintenance</Text>
      </TouchableOpacity>

      <TouchableOpacity 
        style={[styles.sidebarButton, currentTab === 'predictor' && styles.activeSidebarButton]} 
        onPress={() => { setCurrentTab('predictor'); setIsMobileMenuOpen(false); }}
      >
        <Text style={[styles.sidebarButtonText, currentTab === 'predictor' && styles.activeSidebarText]}>🔮 The ORACLE</Text>
      </TouchableOpacity>

      <View style={styles.spacer} />

      <TouchableOpacity 
        style={[styles.sidebarButton, styles.logoutButton]} 
        onPress={() => supabase.auth.signOut()}
      >
        <Text style={styles.logoutText}>🚪 Sign Out</Text>
      </TouchableOpacity>
    </View>
  );

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
              <Text style={styles.menuToggleText}>{isMobileMenuOpen ? '✕' : '☰'}</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.headerTitle}>ORACLE</Text>
          <Text style={styles.headerSubtitle}>MEMBERS PORTAL</Text>
        </View>
      </View>

      {/* Primary Workspace Layout */}
      <View style={styles.dashboardBody}>
        
        {/* SIDEBAR: Rendered permanently on Web/Desktop */}
        {isLargeScreen && (
          <View style={styles.permanentSidebar}>
            <NavigationLinks />
          </View>
        )}

        {/* MOBILE OVERLAY DRAWER: Slid open temporarily on smaller screens */}
        {!isLargeScreen && isMobileMenuOpen && (
          <View style={styles.mobileDrawerOverlay}>
            <View style={styles.mobileDrawerContent}>
              <NavigationLinks />
            </View>
            <TouchableOpacity style={styles.drawerDismissZone} onPress={() => setIsMobileMenuOpen(false)} />
          </View>
        )}

        {/* MAIN DYNAMIC SCREEN CONTENT */}
        <View style={styles.mainContentPane}>
          {currentTab === 'members' && <MembersList />}
          {currentTab === 'pfo' && <PfoList />}
          {currentTab === 'pfoReports' && <PfoReport />}
          {currentTab === 'clp' && <ClpMaintenance />}
          {currentTab === 'predictor' && <PredictorScreen />}
        </View>
      </View>

      {/* MOBILE BOTTOM NAV BAR FALLBACK */}
      {!isLargeScreen && (
        <View style={styles.bottomTabBar}>
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
  header: { backgroundColor: '#002060', paddingVertical: 14, paddingHorizontal: 20, borderBottomWidth: 1, borderColor: '#001540', zIndex: 10 },
  headerContent: { width: '100%', flexDirection: 'row', alignItems: 'center' },
  menuToggleButton: { marginRight: 16, padding: 4 },
  menuToggleText: { color: '#fff', fontSize: 22, fontWeight: '700' },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#fff', letterSpacing: 2 },
  headerSubtitle: { fontSize: 11, color: '#93c5fd', marginLeft: 10, letterSpacing: 1, fontWeight: '500', marginTop: 4 },
  
  // Dashboard Structure split
  dashboardBody: { flex: 1, flexDirection: 'row', position: 'relative' },
  
  // Web Admin Sidebar Architecture
  permanentSidebar: { width: 260, backgroundColor: '#ffffff', borderRightWidth: 1, borderColor: '#e2e8f0', padding: 16 },
  navLinksContainer: { flex: 1 },
  sidebarButton: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 8, marginBottom: 6 },
  activeSidebarButton: { backgroundColor: '#eff6ff' },
  sidebarButtonText: { fontSize: 14, color: '#475569', fontWeight: '600' },
  activeSidebarText: { color: '#002060', fontWeight: '700' },
  spacer: { flex: 1 },
  logoutButton: { backgroundColor: '#fef2f2', marginTop: 'auto' },
  logoutText: { color: '#ef4444', fontWeight: '600' },
  
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
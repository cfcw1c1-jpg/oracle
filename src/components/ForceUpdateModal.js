import { Ionicons } from '@expo/vector-icons';
import { Linking, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const NAVY = '#002060';

// Deliberately has no close/cancel affordance, no onRequestClose handler
// that dismisses it, and android_back button presses do nothing (Modal's
// default onRequestClose is a no-op if you don't pass one) -- this is a
// hard gate blocking the whole app until the required update is
// installed, not a dismissible prompt. See src/lib/appVersionGate.js for
// when it's shown.
export default function ForceUpdateModal({ visible, storeUrl, message }) {
  const storeLabel = Platform.OS === 'ios' ? 'the App Store' : 'the Play Store';
  const body = message || `A new version of this app is required to continue. Please update from ${storeLabel} to keep using it.`;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="cloud-download-outline" size={30} color={NAVY} />
          </View>
          <Text style={styles.title}>Update Required</Text>
          <Text style={styles.body}>{body}</Text>

          {!!storeUrl && (
            <TouchableOpacity style={styles.updateBtn} onPress={() => Linking.openURL(storeUrl)}>
              <Ionicons name="arrow-up-circle-outline" size={16} color="#ffffff" style={{ marginRight: 8 }} />
              <Text style={styles.updateBtnText}>Update Now</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(5,6,26,0.92)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { backgroundColor: '#ffffff', borderRadius: 20, padding: 28, width: '100%', maxWidth: 380, alignItems: 'center' },
  iconWrap: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: '#eff6ff',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  title: { fontSize: 19, fontWeight: '800', color: '#0f172a', marginBottom: 10, textAlign: 'center' },
  body: { fontSize: 13, color: '#475569', lineHeight: 19, textAlign: 'center', marginBottom: 22 },
  updateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: NAVY, borderRadius: 10, paddingVertical: 13, paddingHorizontal: 24, width: '100%',
  },
  updateBtnText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
});

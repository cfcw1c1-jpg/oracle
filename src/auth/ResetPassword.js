import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '../../lib/supabase';

const NAVY = '#002060';
const NAVY_DARK = '#001540';

function showAlert(title, message) {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
}

// Shown instead of the normal Login/Dashboard flow once src/app/index.js
// detects a password-recovery link and establishes a session from its
// token -- that session is real and valid, but the whole point of the
// email link was to let the user pick a NEW known password, so they must
// not be dropped straight into the dashboard with their old (forgotten)
// one still unchanged.
export default function ResetPassword({ onDone }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSetPassword() {
    if (!newPassword || !confirmPassword) {
      showAlert('Missing Information', 'Please fill in both password fields.');
      return;
    }
    if (newPassword.length < 6) {
      showAlert('Password Too Short', 'New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      showAlert('Passwords Do Not Match', 'New password and confirmation must match.');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      onDone();
    } catch (err) {
      showAlert('Could Not Set Password', err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.outerContainer}>
      <View style={styles.card}>
        <View style={styles.brandMarkRing}>
          <Ionicons name="key-outline" size={28} color="#ffffff" />
        </View>
        <Text style={styles.title}>Set a New Password</Text>
        <Text style={styles.subtitle}>Choose a new password for your account to finish resetting it.</Text>

        <TextInput
          placeholder="New Password"
          placeholderTextColor="#94a3b8"
          onChangeText={setNewPassword}
          value={newPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
          returnKeyType="next"
          style={styles.flatInput}
        />

        <TextInput
          placeholder="Confirm New Password"
          placeholderTextColor="#94a3b8"
          onChangeText={setConfirmPassword}
          value={confirmPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
          returnKeyType="go"
          onSubmitEditing={handleSetPassword}
          style={styles.flatInput}
        />

        <TouchableOpacity style={styles.saveButton} onPress={handleSetPassword} disabled={saving}>
          {saving ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <>
              <Text style={styles.saveText}>Save Password</Text>
              <Ionicons name="chevron-forward" size={18} color="#ffffff" />
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: NAVY_DARK,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    ...Platform.select({
      web: {
        experimental_backgroundImage:
          `radial-gradient(circle at 22% 18%, rgba(255,255,255,0.10), transparent 55%), linear-gradient(150deg, ${NAVY} 0%, ${NAVY_DARK} 100%)`,
      },
      default: {},
    }),
  },
  card: { width: '100%', maxWidth: 360, alignItems: 'center' },
  brandMarkRing: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.35)',
    borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', marginBottom: 18,
  },
  title: { fontSize: 22, fontWeight: '800', color: '#ffffff', textAlign: 'center' },
  subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.75)', textAlign: 'center', marginTop: 8, marginBottom: 24, lineHeight: 19 },

  flatInput: {
    backgroundColor: '#ffffff', borderRadius: 4, paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 15, color: '#1e293b', marginBottom: 16, width: '100%',
  },

  saveButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.15)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: 6, paddingVertical: 14, width: '100%', marginTop: 4,
  },
  saveText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
});

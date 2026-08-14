import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
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

export default function Login() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= 760;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const passwordInputRef = useRef(null);

  async function handleLogin() {
    if (loading) return;
    if (!email || !password) {
      showAlert('Missing Information', 'Please fill in all fields.');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) showAlert('Authentication Failed', error.message);
    setLoading(false);
  }

  async function handleForgotPassword() {
    if (!email.trim()) {
      showAlert('Email Required', 'Please enter your email address above, then tap "Forgot Password".');
      return;
    }

    setResetLoading(true);
    try {
      // Send the user back to wherever this app is actually running (dev
      // or prod) rather than relying on the Supabase project's configured
      // default Site URL, which may not match. That URL must also be
      // listed in Supabase's Auth -> URL Configuration -> Redirect URLs,
      // or Supabase will silently fall back to the Site URL instead.
      const redirectTo = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : undefined;
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), redirectTo ? { redirectTo } : undefined);
      if (error) throw error;
      showAlert('Check Your Email', `A password reset link has been sent to ${email.trim()}.`);
    } catch (error) {
      showAlert('Reset Failed', error.message);
    } finally {
      setResetLoading(false);
    }
  }

  return (
    <View style={styles.outerContainer}>
      <View style={[styles.splitPanel, isWide ? styles.splitPanelWide : styles.splitPanelNarrow]}>
        <View style={[styles.brandColumn, isWide && styles.brandColumnWide]}>
          <View style={styles.brandMarkRing}>
            <Image source={require('../../assets/images/oracle-logo.png')} style={styles.brandMarkLogo} resizeMode="contain" />
          </View>
          <Text style={styles.brandTitle}>ORACLE</Text>
          <Text style={styles.brandSubtitle}>MEMBERS PORTAL</Text>
        </View>

        <View style={isWide ? styles.dividerVertical : styles.dividerHorizontal} />

        <View style={[styles.formColumn, isWide && styles.formColumnWide]}>
          <Text style={styles.signInTitle}>Sign In</Text>

          <TextInput
            placeholder="Email Address"
            placeholderTextColor="#94a3b8"
            onChangeText={setEmail}
            value={email}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete={Platform.OS === 'web' ? 'email' : 'username'}
            returnKeyType="next"
            onSubmitEditing={() => passwordInputRef.current?.focus()}
            blurOnSubmit={false}
            style={styles.flatInput}
          />

          <View style={styles.passwordFieldWrap}>
            <TextInput
              ref={passwordInputRef}
              placeholder="Password"
              placeholderTextColor="#94a3b8"
              onChangeText={setPassword}
              value={password}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoComplete="current-password"
              returnKeyType="go"
              onSubmitEditing={handleLogin}
              style={[styles.flatInput, styles.passwordInputField]}
            />
            <TouchableOpacity
              style={styles.passwordToggleBtn}
              onPress={() => setShowPassword((v) => !v)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color="#64748b" />
            </TouchableOpacity>
          </View>

          <View style={styles.actionsRow}>
            <TouchableOpacity onPress={handleForgotPassword} disabled={resetLoading}>
              <Text style={styles.forgotText}>{resetLoading ? 'Sending…' : 'Forgot Password'}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.goButton} onPress={handleLogin} disabled={loading}>
              {loading ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <>
                  <Text style={styles.goText}>Go</Text>
                  <Ionicons name="chevron-forward" size={20} color="#ffffff" />
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <TouchableOpacity style={styles.privacyLink} onPress={() => router.push('/privacy-policy')}>
        <Text style={styles.privacyLinkText}>Privacy Policy</Text>
      </TouchableOpacity>
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

  splitPanel: { width: '100%', maxWidth: 880 },
  splitPanelWide: { flexDirection: 'row', alignItems: 'center' },
  splitPanelNarrow: { alignItems: 'center' },

  brandColumn: { alignItems: 'center', marginBottom: 32 },
  brandColumnWide: { flex: 1, marginBottom: 0, paddingRight: 48 },
  brandMarkRing: {
    width: 84, height: 84, borderRadius: 42, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.35)',
    borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', marginBottom: 16,
  },
  brandMarkLogo: { width: 48, height: 42 },
  brandTitle: { fontSize: 34, fontWeight: '800', color: '#ffffff', letterSpacing: 3 },
  brandSubtitle: { fontSize: 12, color: 'rgba(255,255,255,0.75)', letterSpacing: 2, marginTop: 6, fontWeight: '600' },

  dividerVertical: { width: 1, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.25)', marginVertical: 8 },
  dividerHorizontal: { height: 1, width: '60%', backgroundColor: 'rgba(255,255,255,0.25)', marginBottom: 32 },

  formColumn: { width: '100%', maxWidth: 340 },
  formColumnWide: { flex: 1, paddingLeft: 48, maxWidth: 400 },
  signInTitle: { fontSize: 26, fontWeight: '700', color: '#ffffff', marginBottom: 20 },

  flatInput: {
    backgroundColor: '#ffffff', borderRadius: 4, paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 15, color: '#1e293b', marginBottom: 16, width: '100%',
  },
  passwordFieldWrap: { position: 'relative', width: '100%', justifyContent: 'center' },
  passwordInputField: { paddingRight: 46 },
  passwordToggleBtn: { position: 'absolute', right: 14, top: 0, bottom: 16, justifyContent: 'center' },

  actionsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  forgotText: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontStyle: 'italic' },
  goButton: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 4, paddingLeft: 12 },
  goText: { color: '#ffffff', fontSize: 18, fontWeight: '700' },

  privacyLink: { marginTop: 28, padding: 6 },
  privacyLinkText: { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '600', textDecorationLine: 'underline' },
});

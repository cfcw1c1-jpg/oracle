import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const NAVY = '#002060';

// Bumping this forces every visitor to re-agree (e.g. if the notice text
// changes materially) -- old keys just become unread, harmless clutter.
const CONSENT_STORAGE_KEY = 'oracle_privacy_consent_v1';

const MODERATOR_EMAILS = [
  'jamesryanpatiag@gmail.com',
  'markjosephreyes1513@gmail.com',
  'bryanmunoz28@yahoo.com',
  'bentiung02421@gmail.com',
];

// Gates the two public, unauthenticated pages (Training Lookup, CLP
// Registration) behind an explicit Data Privacy Act notice + consent
// checkbox before any personal data is looked up -- these pages' visitors
// are the actual data subjects (church members), not portal staff, so
// this is the notice that most directly matters for DPA's transparency
// principle. Agreement is remembered per-device via AsyncStorage so
// returning visitors aren't re-blocked every time.
export default function PrivacyConsentGate({ purpose, children }) {
  const [agreed, setAgreed] = useState(null); // null = not checked yet
  const [checkboxChecked, setCheckboxChecked] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(CONSENT_STORAGE_KEY).then((value) => {
      setAgreed(value === 'true');
    });
  }, []);

  function handleAgree() {
    setAgreed(true);
    AsyncStorage.setItem(CONSENT_STORAGE_KEY, 'true').catch(() => {});
  }

  if (agreed === null) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={NAVY} />
      </SafeAreaView>
    );
  }

  if (agreed) return children;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        <View style={styles.iconRing}>
          <Ionicons name="shield-checkmark-outline" size={26} color={NAVY} />
        </View>
        <Text style={styles.title}>Data Privacy Notice</Text>

        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.text}>
            To {purpose}, this page looks up personal information — including your name, Area/Chapter,
            and Pastoral Formation (PFO) and Christian Life Program (CLP) training history — using the
            Member ID and Last Name you provide below.
          </Text>
          <Text style={styles.text}>
            This information is used only to {purpose}. It is stored with Supabase, our cloud database
            provider, and is otherwise handled the same way as the rest of CFC&apos;s membership records —
            access is restricted to authorized portal accounts.
          </Text>
          <Text style={styles.text}>
            Under the Data Privacy Act of 2012 (RA 10173), you have the right to access, correct, or
            request deletion of your personal data. For any privacy concerns or requests, contact the
            moderators below.
          </Text>

          {MODERATOR_EMAILS.map((email) => (
            <TouchableOpacity key={email} style={styles.emailRow} onPress={() => Linking.openURL(`mailto:${email}`)}>
              <Ionicons name="mail-outline" size={13} color="#334155" style={{ marginRight: 6 }} />
              <Text style={styles.emailText}>{email}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <TouchableOpacity style={styles.checkboxRow} onPress={() => setCheckboxChecked((v) => !v)}>
          <Ionicons
            name={checkboxChecked ? 'checkbox' : 'square-outline'}
            size={20}
            color={checkboxChecked ? '#2563eb' : '#94a3b8'}
            style={{ marginRight: 10, marginTop: 1 }}
          />
          <Text style={styles.checkboxText}>
            I have read this notice and confirm this is my own record.
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.agreeBtn, !checkboxChecked && styles.agreeBtnDisabled]}
          onPress={handleAgree}
          disabled={!checkboxChecked}
        >
          <Text style={styles.agreeBtnText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, backgroundColor: '#f8fafc', justifyContent: 'center', alignItems: 'center' },
  container: { flex: 1, backgroundColor: '#f8fafc', justifyContent: 'center', alignItems: 'center', padding: 20 },
  card: {
    backgroundColor: '#ffffff', borderRadius: 18, padding: 22, width: '100%', maxWidth: 600, maxHeight: '88%',
    borderWidth: 1, borderColor: '#e2e8f0',
  },
  iconRing: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: '#eff6ff',
    alignItems: 'center', justifyContent: 'center', marginBottom: 12, alignSelf: 'center',
  },
  title: { fontSize: 17, fontWeight: '800', color: '#0f172a', marginBottom: 12, textAlign: 'center' },
  // flexShrink lets the scroll area give up space to the title/checkbox/
  // button when the card hits its own maxHeight, instead of a fixed pixel
  // value that's either cramped on a big screen or overflowing on a small
  // one -- it just takes whatever room is actually left.
  scroll: { flexShrink: 1, marginBottom: 14 },
  text: { fontSize: 13, color: '#334155', lineHeight: 19, marginBottom: 10 },
  emailRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  emailText: { fontSize: 12, color: '#334155', fontWeight: '600' },

  checkboxRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  checkboxText: { flex: 1, fontSize: 12, color: '#334155', fontWeight: '600', lineHeight: 17 },

  agreeBtn: { backgroundColor: NAVY, borderRadius: 10, paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
  agreeBtnDisabled: { opacity: 0.5 },
  agreeBtnText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
});

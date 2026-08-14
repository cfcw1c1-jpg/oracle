import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const NAVY = '#002060';

const DPO_EMAILS = [
  'jamesryanpatiag@gmail.com',
  'markjosephreyes1513@gmail.com',
  'bryanmunoz28@yahoo.com',
  'bentiung02421@gmail.com',
];

const LAST_UPDATED = 'August 14, 2026';

function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Paragraph({ children }) {
  return <Text style={styles.paragraph}>{children}</Text>;
}

function Bullet({ children }) {
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bulletDot} />
      <Text style={styles.bulletText}>{children}</Text>
    </View>
  );
}

// Public, unauthenticated route -- reachable at /privacy-policy on the web
// build and linked from Login, the Training Lookup / CLP Registration
// consent gate, and Profile (for signed-in members), so it's visible both
// before and after account creation, matching DPA's transparency
// principle.
export default function PrivacyPolicy() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        {router.canGoBack() && (
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back-outline" size={20} color="#fff" />
          </TouchableOpacity>
        )}
        <Image source={require('../../assets/images/oracle-logo.png')} style={styles.headerLogo} resizeMode="contain" />
        <Text style={styles.headerTitle}>ORACLE</Text>
        <Text style={styles.headerSubtitle}>PRIVACY POLICY</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Text style={styles.updatedText}>Last updated: {LAST_UPDATED}</Text>

          <Paragraph>
            This Privacy Policy explains how CFC West1C1 collects, uses, stores, and protects personal
            data through Oracle, our Members Portal, covering both registered portal accounts (Admins,
            Moderators, Area Coordinators, and other staff) and the members whose records are managed
            within it.
          </Paragraph>

          <Section title="1. Information We Collect">
            <Paragraph>Depending on how you use Oracle, we collect:</Paragraph>
            <Bullet>
              <Text style={styles.bulletBold}>Account information</Text> — your email address and password
              (managed securely by our authentication provider, never stored in plain text) for portal
              accounts, plus an optional profile photo.
            </Bullet>
            <Bullet>
              <Text style={styles.bulletBold}>Membership records</Text> — name, Member ID, gender, status,
              Area/Chapter assignment, household head, year registered, and Pastoral Service role, as
              encoded by your Area's authorized portal accounts.
            </Bullet>
            <Bullet>
              <Text style={styles.bulletBold}>Formation and training history</Text> — Pastoral Formation
              (PFO) and Christian Life Program (CLP) module completion records used to track your
              formation progress.
            </Bullet>
            <Bullet>
              <Text style={styles.bulletBold}>Messages</Text> — direct messages exchanged between portal
              accounts within Oracle (e.g. between a moderator and a member submitting a record change).
            </Bullet>
            <Bullet>
              <Text style={styles.bulletBold}>Device push notification tokens</Text> — if you enable
              notifications on the mobile app, a token identifying your device so we can deliver
              notifications to it. No message content is stored by the notification service itself.
            </Bullet>
            <Bullet>
              <Text style={styles.bulletBold}>Usage and audit logs</Text> — a record of changes made to
              membership data (who changed what, and when), page-view activity for administrators, and
              training-lookup activity, kept for accountability and troubleshooting.
            </Bullet>
          </Section>

          <Section title="2. How We Use Your Information">
            <Bullet>To maintain accurate membership, household, and Area/Chapter records.</Bullet>
            <Bullet>To track Pastoral Formation and CLP training completion.</Bullet>
            <Bullet>To let you look up your own training record or self-register for a session using your Member ID.</Bullet>
            <Bullet>To let authorized portal accounts communicate about a record (e.g. a proposed change to your information).</Bullet>
            <Bullet>To detect, review, and correct erroneous or unauthorized changes through our change-request and audit history.</Bullet>
            <Bullet>To send you notifications about activity relevant to your portal account, if enabled.</Bullet>
          </Section>

          <Section title="3. Legal Basis">
            <Paragraph>
              We process personal data under the Data Privacy Act of 2012 (Republic Act No. 10173), on
              the basis of your consent (for the public lookup/registration pages), our legitimate
              interest in maintaining accurate ministry and formation records, and, for portal staff
              accounts, the performance of your role within the organization.
            </Paragraph>
          </Section>

          <Section title="4. Who Can Access Your Data">
            <Paragraph>
              Access within Oracle is role-based and scoped by Area — portal accounts only see the pages
              and records their assigned role and Area permit. Edits made by accounts without direct
              editing rights are queued as change requests and must be reviewed and approved by an Admin
              or Moderator before they take effect. We do not sell, rent, or share your personal data with
              third parties for marketing purposes.
            </Paragraph>
          </Section>

          <Section title="5. Data Storage and Security">
            <Paragraph>
              Your data is stored with Supabase, our cloud database and authentication provider, protected
              by row-level access policies enforced at the database layer, encrypted in transit, and
              restricted to authorized portal accounts. No system is completely immune to risk, but we
              apply reasonable organizational and technical safeguards proportionate to the sensitivity of
              the data involved.
            </Paragraph>
          </Section>

          <Section title="6. Data Retention">
            <Paragraph>
              Membership and formation records are retained for as long as needed to serve their ministry
              purpose. Audit and training-lookup logs are kept according to a retention period configured
              by our Admins and are purged automatically once that period elapses.
            </Paragraph>
          </Section>

          <Section title="7. Your Rights">
            <Paragraph>
              Under the Data Privacy Act, you have the right to be informed, to access your personal data,
              to request correction of inaccurate data, to object to or withdraw consent for its
              processing, and to request its deletion, subject to our legitimate record-keeping needs as a
              ministry organization. To exercise any of these rights, contact us using the details below.
            </Paragraph>
          </Section>

          <Section title="8. Children's Data">
            <Paragraph>
              Some CFC ministries serve minors under a parent or guardian's supervision. Where we hold
              formation or membership records for a minor, we treat that data with the same safeguards
              described above, and a parent or guardian may exercise the rights in Section 7 on the
              minor's behalf.
            </Paragraph>
          </Section>

          <Section title="9. Changes to This Policy">
            <Paragraph>
              We may update this policy as Oracle's features change. Material changes will update the
              "Last updated" date above; continued use of the portal after a change constitutes
              acknowledgement of the revised policy.
            </Paragraph>
          </Section>

          <Section title="10. Contact Us">
            <Paragraph>
              For questions, concerns, or to exercise your data privacy rights, reach out to any of our
              moderators:
            </Paragraph>
            {DPO_EMAILS.map((email) => (
              <TouchableOpacity key={email} style={styles.emailRow} onPress={() => Linking.openURL(`mailto:${email}`)}>
                <Ionicons name="mail-outline" size={14} color="#334155" style={{ marginRight: 8 }} />
                <Text style={styles.emailText}>{email}</Text>
              </TouchableOpacity>
            ))}
          </Section>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { backgroundColor: NAVY, paddingVertical: 20, paddingHorizontal: 20, alignItems: 'center' },
  backButton: { position: 'absolute', left: 16, top: 20, padding: 4, zIndex: 1 },
  headerLogo: { width: 46, height: 40, marginBottom: 8 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#fff', letterSpacing: 2 },
  headerSubtitle: { fontSize: 11, color: '#93c5fd', letterSpacing: 1, fontWeight: '500', marginTop: 4 },

  body: { padding: 16, paddingBottom: 40 },
  card: {
    backgroundColor: '#ffffff', borderRadius: 16, padding: 22, width: '100%', maxWidth: 720,
    alignSelf: 'center', borderWidth: 1, borderColor: '#e2e8f0',
  },
  updatedText: { fontSize: 12, color: '#94a3b8', fontWeight: '600', marginBottom: 14 },

  section: { marginTop: 18 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#0f172a', marginBottom: 8 },
  paragraph: { fontSize: 13.5, color: '#334155', lineHeight: 21, marginBottom: 6 },

  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8, paddingRight: 4 },
  bulletDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#94a3b8', marginTop: 7, marginRight: 10 },
  bulletText: { flex: 1, fontSize: 13.5, color: '#334155', lineHeight: 20 },
  bulletBold: { fontWeight: '700', color: '#0f172a' },

  emailRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  emailText: { fontSize: 13, color: '#334155', fontWeight: '600' },
});

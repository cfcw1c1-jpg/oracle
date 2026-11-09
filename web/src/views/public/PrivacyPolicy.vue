<script setup>
import { ArrowLeft, Mail } from 'lucide-vue-next';
import { useRouter } from 'vue-router';
import PublicShell from '@/components/PublicShell.vue';

const router = useRouter();
const canGoBack = window.history.length > 1;
const LAST_UPDATED = 'August 14, 2026';
const CONTACT_EMAILS = ['jamesryanpatiag@gmail.com', 'markjosephreyes1513@gmail.com', 'bryanmunoz28@yahoo.com', 'bentiung02421@gmail.com'];

const SECTIONS = [
  {
    title: '1. Information We Collect',
    intro: 'Depending on how you use Oracle, we collect:',
    items: [
      ['Account information', ' — your email address and password (managed securely by our authentication provider, never stored in plain text) for portal accounts, plus an optional profile photo.'],
      ['Membership records', " — name, Member ID, gender, status, Area/Chapter assignment, household head, year registered, and Pastoral Service role, as encoded by your Area's authorized portal accounts."],
      ['Formation and training history', ' — Pastoral Formation (PFO) and Christian Life Program (CLP) module completion records used to track your formation progress.'],
      ['Messages', ' — direct messages exchanged between portal accounts within Oracle (e.g. between a moderator and a member submitting a record change).'],
      ['Device push notification tokens', ' — if you enable notifications on the mobile app, a token identifying your device so we can deliver notifications to it. No message content is stored by the notification service itself.'],
      ['Usage and audit logs', ' — a record of changes made to membership data (who changed what, and when), page-view activity for administrators, and training-lookup activity, kept for accountability and troubleshooting.'],
    ],
  },
  {
    title: '2. How We Use Your Information',
    items: [
      ['', 'To maintain accurate membership, household, and Area/Chapter records.'],
      ['', 'To track Pastoral Formation and CLP training completion.'],
      ['', 'To let you look up your own training record or self-register for a session using your Member ID.'],
      ['', 'To let authorized portal accounts communicate about a record (e.g. a proposed change to your information).'],
      ['', 'To detect, review, and correct erroneous or unauthorized changes through our change-request and audit history.'],
      ['', 'To send you notifications about activity relevant to your portal account, if enabled.'],
    ],
  },
  { title: '3. Legal Basis', intro: 'We process personal data under the Data Privacy Act of 2012 (Republic Act No. 10173), on the basis of your consent (for the public lookup/registration pages), our legitimate interest in maintaining accurate ministry and formation records, and, for portal staff accounts, the performance of your role within the organization.' },
  { title: '4. Who Can Access Your Data', intro: 'Access within Oracle is role-based and scoped by Area — portal accounts only see the pages and records their assigned role and Area permit. Edits made by accounts without direct editing rights are queued as change requests and must be reviewed and approved by an Admin or Moderator before they take effect. We do not sell, rent, or share your personal data with third parties for marketing purposes.' },
  { title: '5. Data Storage and Security', intro: 'Your data is stored with Supabase, our cloud database and authentication provider, protected by row-level access policies enforced at the database layer, encrypted in transit, and restricted to authorized portal accounts. No system is completely immune to risk, but we apply reasonable organizational and technical safeguards proportionate to the sensitivity of the data involved.' },
  { title: '6. Data Retention', intro: 'Membership and formation records are retained for as long as needed to serve their ministry purpose. Audit and training-lookup logs are kept according to a retention period configured by our Admins and are purged automatically once that period elapses.' },
  { title: '7. Your Rights', intro: 'Under the Data Privacy Act, you have the right to be informed, to access your personal data, to request correction of inaccurate data, to object to or withdraw consent for its processing, and to request its deletion, subject to our legitimate record-keeping needs as a ministry organization. To exercise any of these rights, contact us using the details below.' },
  { title: "8. Children's Data", intro: "Some CFC ministries serve minors under a parent or guardian's supervision. Where we hold formation or membership records for a minor, we treat that data with the same safeguards described above, and a parent or guardian may exercise the rights in Section 7 on the minor's behalf." },
  { title: '9. Changes to This Policy', intro: 'We may update this policy as Oracle\'s features change. Material changes will update the "Last updated" date above; continued use of the portal after a change constitutes acknowledgement of the revised policy.' },
];
</script>

<template>
  <PublicShell subtitle="PRIVACY POLICY">
    <template #start>
      <button v-if="canGoBack" class="back" aria-label="Go back" @click="router.back()"><ArrowLeft :size="20" /></button>
    </template>
    <article class="card card-pad policy">
      <p class="muted small">Last updated: {{ LAST_UPDATED }}</p>
      <p>This Privacy Policy explains how CFC West1C1 collects, uses, stores, and protects personal data through Oracle, our Members Portal, covering both registered portal accounts (Admins, Moderators, Area Coordinators, and other staff) and the members whose records are managed within it.</p>
      <section v-for="section in SECTIONS" :key="section.title">
        <h2>{{ section.title }}</h2>
        <p v-if="section.intro">{{ section.intro }}</p>
        <ul v-if="section.items"><li v-for="[lead, text] in section.items" :key="text"><strong v-if="lead">{{ lead }}</strong>{{ text }}</li></ul>
      </section>
      <section>
        <h2>10. Contact Us</h2>
        <p>For questions, concerns, or to exercise your data privacy rights, reach out to any of our moderators:</p>
        <a v-for="email in CONTACT_EMAILS" :key="email" class="row small strong email" :href="`mailto:${email}`"><Mail :size="14" />{{ email }}</a>
      </section>
    </article>
  </PublicShell>
</template>

<style scoped>
.back { border: 0; background: none; color: inherit; padding: 2px; display: flex; }
.policy { display: flex; flex-direction: column; gap: 14px; font-size: 13.5px; line-height: 1.6; color: var(--ink-2); }
h2 { font-size: 14.5px; font-weight: var(--fw-heading); color: var(--ink); margin-bottom: 6px; }
ul { margin: 6px 0 0; padding-left: 18px; display: grid; gap: 6px; }
.email { padding: 3px 0; }
</style>

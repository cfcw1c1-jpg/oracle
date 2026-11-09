<script setup>
import { ChevronLeft, ChevronRight, Info, Lock, LogOut, Mail, MessageCircle, MessagesSquare, Search, X } from 'lucide-vue-next';
import { computed, defineAsyncComponent, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppModal from '@/components/AppModal.vue';
import { useIsWide } from '@/composables/useIsWide';
import { mobileTabsForRole, NAV_ITEMS, PAGE_LABELS } from '@/lib/navigation';
import { canView, loadAccess, logPageView, sessionState, signOut } from '@/stores/session';

const MODERATOR_EMAILS = ['jamesryanpatiag@gmail.com', 'markjosephreyes1513@gmail.com', 'bryanmunoz28@yahoo.com', 'bentiung02421@gmail.com'];
const LAST_TAB_KEY = 'oracle_current_tab';
const OPEN_TO_ALL = ['profile', 'messages', 'predictor'];

const pages = import.meta.glob('../views/app/*.vue');
const SCREENS = {
  home: 'DashboardHome', adminDashboard: 'AdminDashboard', members: 'MembersList', myChangeRequests: 'MyChangeRequests',
  manageMembers: 'ManageMembers', pfo: 'PfoList', pfoReports: 'PfoReports', pfoStats: 'PfoStatGenerator', clp: 'ClpMaintenance',
  materials: 'Materials', ogdAccounts: 'OgdAccounts', ogdChapters: 'OgdAccounts', monthlyPastoralReports: 'MonthlyPastoralReports',
  portalUsers: 'PortalUsers', logs: 'Logs', memberChangeQueue: 'MemberChangeQueue', settings: 'Settings', predictor: 'PredictorScreen',
  profile: 'ProfileScreen', messages: 'Messages',
};
const screens = Object.fromEntries(
  Object.entries(SCREENS).map(([key, file]) => [key, pages[`../views/app/${file}.vue`] ? defineAsyncComponent(pages[`../views/app/${file}.vue`]) : null]),
);

const route = useRoute();
const router = useRouter();
const isWide = useIsWide();
const isCollapsed = ref(false);
const openGroupKey = ref(null);
const pageSearch = ref('');
const previousTab = ref('home');

const access = computed(() => sessionState.access);
const user = computed(() => sessionState.session?.user);
const roleName = computed(() => access.value?.roleName);
const portalLabel = computed(() => (roleName.value ? `${roleName.value} Portal` : 'Members Portal'));
const avatarUrl = computed(() => user.value?.user_metadata?.avatar_url);
const initials = computed(() => (user.value?.email || '?').slice(0, 2).toUpperCase());
const appVersion = __APP_VERSION__;

// ogdAccounts and ogdChapters are one screen, so a role holding both sees one item.
const navItems = computed(() => NAV_ITEMS.filter((item) => canView(item.key) && !(item.key === 'ogdChapters' && canView('ogdAccounts'))));
const ungroupedItems = computed(() => navItems.value.filter((item) => !item.group));
const navGroups = computed(() => {
  const groups = new Map();
  navItems.value.filter((item) => item.group).forEach((item) => groups.set(item.group, [...(groups.get(item.group) || []), item]));
  return [...groups].map(([name, items]) => ({ name, items }));
});
const badgeCounts = computed(() => ({ memberChangeQueue: sessionState.pendingChangeRequests }));

function firstAllowedTab() {
  return access.value?.allowedPages?.[0] || 'profile';
}

function storedTab() {
  try {
    return window.localStorage.getItem(LAST_TAB_KEY);
  } catch {
    return null;
  }
}

function initialTab() {
  if (sessionState.landOnAdminDashboard && roleName.value === 'Admin' && canView('adminDashboard')) return 'adminDashboard';
  const stored = storedTab();
  if (stored && (canView(stored) || OPEN_TO_ALL.includes(stored))) return stored;
  return canView('home') ? 'home' : firstAllowedTab();
}

const currentTab = computed(() => route.params.tab || null);

watch(
  currentTab,
  (tab, previous) => {
    if (!tab) {
      const target = initialTab();
      sessionState.landOnAdminDashboard = false;
      router.replace(`/${target}`);
      return;
    }
    sessionState.activeTab = tab;
    if (previous && previous !== 'messages') previousTab.value = previous;
    try {
      window.localStorage.setItem(LAST_TAB_KEY, tab);
    } catch {
      // Private browsing can refuse storage; the URL still holds the page.
    }
    if (previous) logPageView(tab, PAGE_LABELS[tab]);
  },
  { immediate: true },
);

const isAllowed = computed(() => (currentTab.value && OPEN_TO_ALL.includes(currentTab.value)) || canView(currentTab.value));
const isKnownPage = computed(() => Boolean(currentTab.value && Object.hasOwn(SCREENS, currentTab.value)));
const activeScreen = computed(() => (isAllowed.value && isKnownPage.value ? screens[currentTab.value] : null));
const pageTitle = computed(() => PAGE_LABELS[currentTab.value] || 'Oracle');

const screenProps = computed(() => {
  switch (currentTab.value) {
    case 'home': case 'members': return { roleName: roleName.value };
    case 'materials': return { isAdmin: Boolean(access.value?.isAdmin) };
    case 'ogdAccounts': case 'ogdChapters':
      return { scopes: [canView('ogdAccounts') && 'accounts', canView('ogdChapters') && 'sector'].filter(Boolean) };
    case 'portalUsers': case 'settings': return { onAccessChanged: () => loadAccess() };
    case 'memberChangeQueue': return { onOpenConversation: openConversation };
    case 'messages': return isWide.value ? {} : { onExit: () => selectTab(previousTab.value) };
    default: return {};
  }
});

function selectTab(tab) {
  openGroupKey.value = null;
  pageSearch.value = '';
  router.push(`/${tab}`);
}

function openConversation(conversationId) {
  sessionState.pendingConversationId = conversationId;
  selectTab('messages');
}

const pageMatches = computed(() => {
  const query = pageSearch.value.trim().toLowerCase();
  return query ? navItems.value.filter((item) => item.label.toLowerCase().includes(query)).slice(0, 7) : [];
});

function goToFirstMatch() {
  if (pageMatches.value[0]) selectTab(pageMatches.value[0].key);
}

const mobileTabs = computed(() => mobileTabsForRole(roleName.value)
  .map((tab) => (tab.children ? { ...tab, children: tab.children.filter((child) => canView(child.key)) } : tab))
  .filter((tab) => (tab.children ? tab.children.length > 0 : canView(tab.key))));
const openGroup = computed(() => mobileTabs.value.find((tab) => tab.key === openGroupKey.value));

function isTabActive(tab) {
  return tab.children ? tab.children.some((child) => child.key === currentTab.value) : currentTab.value === tab.key;
}

function pressMobileTab(tab) {
  if (tab.children?.length > 1) openGroupKey.value = tab.key;
  else selectTab(tab.children ? tab.children[0].key : tab.key);
}

function openToast() {
  sessionState.messageToast = null;
  selectTab('messages');
}

function openMessagesFromDisclaimer() {
  sessionState.disclaimerVisible = false;
  selectTab('messages');
}
</script>

<template>
  <div class="shell" :class="{ collapsed: isCollapsed }">
    <aside v-if="isWide" class="side">
      <div class="side-brand">
        <span class="brand-mark"><img src="/oracle-logo.png" alt="" /></span>
        <span v-if="!isCollapsed" class="brand-text">
          <strong>ORACLE</strong>
          <small class="clamp">{{ portalLabel }}</small>
        </span>
      </div>

      <nav class="side-nav" aria-label="Main">
        <button
          v-for="item in ungroupedItems" :key="item.key" class="nav-item" :class="{ on: currentTab === item.key }"
          :title="isCollapsed ? item.label : undefined" :aria-current="currentTab === item.key ? 'page' : undefined" @click="selectTab(item.key)"
        >
          <component :is="item.icon" :size="17" />
          <span v-if="!isCollapsed" class="clamp">{{ item.label }}</span>
        </button>
        <template v-for="group in navGroups" :key="group.name">
          <p v-if="!isCollapsed" class="nav-group">{{ group.name }}</p>
          <button
            v-for="item in group.items" :key="item.key" class="nav-item" :class="{ on: currentTab === item.key }"
            :title="isCollapsed ? item.label : undefined" @click="selectTab(item.key)"
          >
            <component :is="item.icon" :size="17" />
            <span v-if="!isCollapsed" class="clamp grow">{{ item.label }}</span>
            <span v-if="badgeCounts[item.key]" class="nav-count">{{ badgeCounts[item.key] > 99 ? '99+' : badgeCounts[item.key] }}</span>
          </button>
        </template>
      </nav>

      <div class="side-foot">
        <button class="nav-item" :title="isCollapsed ? 'Expand menu' : undefined" @click="isCollapsed = !isCollapsed">
          <component :is="isCollapsed ? ChevronRight : ChevronLeft" :size="17" />
          <span v-if="!isCollapsed">Collapse Menu</span>
        </button>
        <button class="nav-item logout" :title="isCollapsed ? 'Log Out' : undefined" @click="signOut">
          <LogOut :size="17" />
          <span v-if="!isCollapsed">Log Out</span>
        </button>
        <p v-if="!isCollapsed" class="side-version">v{{ appVersion }}</p>
      </div>
    </aside>

    <div class="main">
      <header class="top">
        <template v-if="isWide">
          <div class="grow">
            <h2 class="top-title">{{ pageTitle }}</h2>
            <p class="top-sub clamp">{{ user?.email }}</p>
          </div>
          <div class="top-search">
            <label class="search-input">
              <Search :size="15" />
              <span class="sr-only">Find a page</span>
              <input v-model="pageSearch" class="input" type="search" placeholder="Find a page..." @keydown.enter="goToFirstMatch" />
            </label>
            <ul v-if="pageMatches.length" class="top-results">
              <li v-for="item in pageMatches" :key="item.key">
                <button @click="selectTab(item.key)"><component :is="item.icon" :size="15" />{{ item.label }}</button>
              </li>
            </ul>
          </div>
          <button class="icon-btn" aria-label="Messages" @click="selectTab('messages')">
            <MessageCircle :size="19" />
            <span v-if="sessionState.unreadMessages" class="badge">{{ sessionState.unreadMessages > 99 ? '99+' : sessionState.unreadMessages }}</span>
          </button>
        </template>
        <template v-else>
          <div class="m-brand grow">
            <strong>ORACLE</strong>
            <small class="clamp">{{ portalLabel.toUpperCase() }}</small>
          </div>
        </template>
        <button class="avatar-btn" aria-label="My profile" @click="selectTab('profile')">
          <img v-if="avatarUrl" :src="avatarUrl" class="avatar" alt="" />
          <span v-else class="avatar">{{ initials }}</span>
        </button>
        <button v-if="!isWide" class="m-logout" aria-label="Log out" @click="signOut"><LogOut :size="20" /></button>
      </header>

      <main class="content">
        <component :is="activeScreen" v-if="activeScreen" v-bind="screenProps" :key="currentTab" />
        <div v-else-if="isKnownPage || !isAllowed" class="no-access">
          <Lock :size="28" />
          <p>{{ roleName ? "You don't have access to this page yet. Ask an Admin to grant it." : 'Your account has no role assigned yet. Ask an Admin to assign one.' }}</p>
        </div>
      </main>
    </div>

    <template v-if="!isWide && currentTab !== 'messages'">
      <nav class="bottom" aria-label="Main">
        <button v-for="tab in mobileTabs" :key="tab.key" class="bottom-item" :class="{ on: isTabActive(tab) }" @click="pressMobileTab(tab)">
          <span class="bottom-icon">
            <component :is="tab.icon" :size="22" />
            <span v-if="badgeCounts[tab.badgeKey]" class="badge">{{ badgeCounts[tab.badgeKey] > 9 ? '9+' : badgeCounts[tab.badgeKey] }}</span>
          </span>
          <span class="clamp">{{ tab.label }}</span>
        </button>
      </nav>
      <button class="fab" aria-label="Messages" @click="selectTab('messages')">
        <MessagesSquare :size="24" />
        <span v-if="sessionState.unreadMessages" class="badge">{{ sessionState.unreadMessages > 9 ? '9+' : sessionState.unreadMessages }}</span>
      </button>
    </template>

    <div v-if="openGroup" class="sheet-back" @click.self="openGroupKey = null">
      <section class="sheet">
        <p class="sheet-title">{{ openGroup.label }}</p>
        <button v-for="child in openGroup.children" :key="child.key" class="sheet-item" :class="{ on: currentTab === child.key }" @click="selectTab(child.key)">
          <component :is="child.icon" :size="17" />{{ child.label }}
        </button>
        <button class="sheet-cancel" @click="openGroupKey = null">Cancel</button>
      </section>
    </div>

    <div v-if="sessionState.messageToast" class="toast" role="status">
      <button class="toast-open" @click="openToast">
        <strong class="clamp">{{ sessionState.messageToast.name }}</strong>
        <span>{{ sessionState.messageToast.body }}</span>
      </button>
      <button class="toast-close" aria-label="Dismiss" @click="sessionState.messageToast = null"><X :size="15" /></button>
    </div>

    <AppModal v-if="sessionState.disclaimerVisible" title="Before You Continue" :width="600" locked>
      <div class="stack">
        <span class="icon-chip"><Info :size="18" /></span>
        <p>This application is not intended to replace the official OGD portal. It is only being used as a tool to generate reports.</p>
        <p>Because of this, it should always be kept up to date whenever there are changes or movement in the OGD data.</p>
        <p>If you have any concerns, please don't hesitate to message the moderators — they'll get back to you as soon as they see it.</p>
        <h3 class="strong">Data Privacy Notice</h3>
        <p>As a portal account, you can access CFC member records — including names, Area/Chapter assignments, and Pastoral Formation (PFO) / Christian Life Program (CLP) records — scoped to whatever your assigned role and Area allow. Every view, add, edit, and delete you make is logged (System Audit Log) for accountability.</p>
        <p>Handle this data the same way you'd want your own handled: only for legitimate formation and reporting purposes, never shared outside authorized channels. Data is stored with Supabase, our cloud database provider.</p>
        <p>Under the Data Privacy Act of 2012 (RA 10173), members whose data you can see have the right to access, correct, or request deletion of their own information — direct such requests to the moderators below.</p>
        <a v-for="email in MODERATOR_EMAILS" :key="email" :href="`mailto:${email}`" class="row small strong"><Mail :size="14" />{{ email }}</a>
      </div>
      <template #footer>
        <button class="btn" @click="openMessagesFromDisclaimer"><MessageCircle :size="14" />Message a Moderator</button>
        <button class="btn btn-primary" @click="sessionState.disclaimerVisible = false">I Understand</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.shell { --side: 228px; height: 100%; display: flex; gap: 0; padding: 16px; background: var(--bg); }
.shell.collapsed { --side: 76px; }
.side { width: var(--side); flex: none; display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--line); border-right: 0; border-radius: 22px 0 0 22px; padding: 22px 14px 14px; transition: width 0.18s; }
.side-brand { display: flex; align-items: center; gap: 11px; padding: 0 4px 20px; }
.collapsed .side-brand { justify-content: center; padding-inline: 0; }
.brand-mark { width: 40px; height: 40px; border-radius: 11px; background: var(--primary); flex: none; display: flex; align-items: center; justify-content: center; }
.brand-mark img { width: 24px; height: 21px; object-fit: contain; }
.brand-text { display: flex; flex-direction: column; min-width: 0; }
.brand-text strong { font-size: 14px; letter-spacing: 0.1em; }
.brand-text small { font-size: 11px; color: var(--muted); }
.side-nav { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 3px; scrollbar-width: none; }
.nav-item { display: flex; align-items: center; gap: 11px; width: 100%; border: 0; background: none; border-radius: 10px; padding: 9px 11px; font-size: 13px; font-weight: 500; color: var(--ink-2); text-align: left; transition: background 0.15s; }
.collapsed .nav-item { justify-content: center; padding-inline: 0; }
.nav-item svg { flex: none; }
.nav-item:hover { background: var(--surface-hover); }
.nav-item.on { background: var(--accent-soft); color: var(--ink); font-weight: var(--fw-medium); }
.nav-item.logout { color: var(--danger); }
.nav-group { font-size: 10.5px; font-weight: var(--fw-medium); letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); padding: 14px 11px 5px; }
.nav-count { background: #e5484d; color: #fff; font-size: 10.5px; font-weight: 700; border-radius: 10px; padding: 1px 7px; }
.side-foot { display: flex; flex-direction: column; gap: 3px; padding-top: 10px; border-top: 1px solid var(--line); }
.side-version { font-size: 10px; color: var(--muted); text-align: center; margin-top: 6px; }
.main { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--line); border-left: 0; border-radius: 0 22px 22px 0; overflow: hidden; }
.top { display: flex; align-items: center; gap: 12px; padding: 22px 28px 12px; }
.top-title { font-size: 18px; font-weight: var(--fw-heading); }
.top-sub { font-size: 12.5px; color: var(--muted); }
.top-search { position: relative; width: 250px; }
.top-results { position: absolute; z-index: 30; top: calc(100% + 6px); left: 0; right: 0; list-style: none; margin: 0; padding: 5px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-md); box-shadow: var(--shadow-pop); }
.top-results button { width: 100%; display: flex; align-items: center; gap: 9px; border: 0; background: none; border-radius: 8px; padding: 8px 10px; font-size: 13px; text-align: left; }
.top-results button:hover { background: var(--surface-hover); }
.avatar-btn { border: 0; background: none; padding: 0; border-radius: 50%; }
.content { flex: 1; overflow-y: auto; background: #fbfaf8; position: relative; }
.no-access { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--muted); text-align: center; padding: 32px; font-size: 13px; }
.no-access p { max-width: 320px; }
.toast { position: fixed; z-index: 90; top: 70px; right: 16px; width: min(340px, calc(100vw - 32px)); display: flex; align-items: flex-start; background: #1c1a17; color: #fff; border-radius: 12px; padding: 12px 10px 12px 14px; box-shadow: var(--shadow-pop); }
.toast-open { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; border: 0; background: none; color: inherit; text-align: left; padding: 0; font-size: 12.5px; }
.toast-open span { opacity: 0.8; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.toast-close { border: 0; background: none; color: rgba(255, 255, 255, 0.7); padding: 2px; }

/* Phone layout: the existing navy header, bottom tabs, and floating Messages button. */
@media (max-width: 767.98px) {
  .shell { display: flex; flex-direction: column; padding: 0; }
  .main { border: 0; border-radius: 0; flex: 1; min-height: 0; background: var(--bg); }
  .top { background: #002060; border-bottom: 1px solid #001540; padding: 14px 20px; padding-top: calc(14px + env(safe-area-inset-top)); color: #fff; }
  .m-brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .m-brand strong { font-size: 20px; font-weight: 800; letter-spacing: 2px; }
  .m-brand small { font-size: 11px; color: #93c5fd; letter-spacing: 1px; font-weight: 500; margin-top: 4px; }
  .avatar { width: 32px; height: 32px; background: #1e3a8a; color: #fff; border: 1px solid rgba(255, 255, 255, 0.4); }
  .m-logout { border: 0; background: none; color: #fff; padding: 6px; display: flex; }
  .content { background: var(--bg); }
  .bottom { flex: none; display: flex; background: #fff; border-top: 1px solid #e2e8f0; padding: 8px 4px calc(8px + env(safe-area-inset-bottom)); box-shadow: 0 -4px 16px rgba(2, 6, 23, 0.06); }
  .bottom-item { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 3px; border: 0; background: none; padding: 4px 2px; font-size: 10px; font-weight: 700; color: #94a3b8; }
  .bottom-item.on { color: #002060; }
  .bottom-icon { position: relative; display: flex; }
  .bottom-icon .badge { top: -6px; right: -10px; border-color: #fff; }
  .fab { position: fixed; z-index: 20; right: 16px; bottom: calc(92px + env(safe-area-inset-bottom)); width: 56px; height: 56px; border-radius: 50%; border: 0; color: #fff; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #1d3f9e, #5b21b6); box-shadow: 0 6px 16px rgba(29, 63, 158, 0.45); }
  .fab .badge { top: -3px; right: -3px; min-width: 20px; height: 20px; font-size: 11px; border: 2px solid #fff; }
  .sheet-back { position: fixed; inset: 0; z-index: 60; display: flex; align-items: flex-end; background: rgba(15, 23, 42, 0.45); }
  .sheet { width: 100%; background: #fff; border-radius: 20px 20px 0 0; padding: 14px 8px 28px; }
  .sheet-title { font-size: 11px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; padding: 0 14px; margin-bottom: 8px; }
  .sheet-item { width: calc(100% - 12px); margin: 0 6px; display: flex; align-items: center; gap: 12px; border: 0; background: none; border-radius: 10px; padding: 13px 14px; font-size: 15px; font-weight: var(--fw-medium); color: #334155; text-align: left; }
  .sheet-item.on { background: #eff6ff; color: #002060; font-weight: 700; }
  .sheet-cancel { width: calc(100% - 12px); margin: 4px 6px 0; border: 0; background: #f8fafc; border-radius: 10px; padding: 13px; font-size: 14px; font-weight: 700; color: #64748b; }
}
</style>

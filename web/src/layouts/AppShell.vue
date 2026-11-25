<script setup>
import { ChevronLeft, ChevronRight, Info, Lock, LogOut, Mail, MessageCircle, MessagesSquare, Search, X } from 'lucide-vue-next';
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppModal from '@/components/AppModal.vue';
import CreditFooter from '@/components/CreditFooter.vue';
import OgdStatus from '@/components/OgdStatus.vue';
import { useIsWide } from '@/composables/useIsWide';
import { mobileTabsFor, NAV_ITEMS, PAGE_LABELS } from '@/lib/navigation';
import { canView, isOgdRole, loadAccess, logPageView, sessionState, signOut } from '@/stores/session';

const MODERATOR_EMAILS = ['jamesryanpatiag@gmail.com', 'markjosephreyes1513@gmail.com', 'bryanmunoz28@yahoo.com', 'bentiung02421@gmail.com'];
const LAST_TAB_KEY = 'oracle_current_tab';
const OPEN_TO_ALL = ['profile', 'messages', 'predictor'];

const pages = import.meta.glob('../views/app/*.vue');
const SCREENS = {
  home: 'DashboardHome', adminDashboard: 'AdminDashboard', members: 'MembersList', myChangeRequests: 'MyChangeRequests',
  manageMembers: 'ManageMembers', pfo: 'PfoList', pfoReports: 'PfoReports', pfoStats: 'PfoStatGenerator', clp: 'ClpMaintenance',
  materials: 'Materials', ogdAccounts: 'OgdAccounts', ogdChapters: 'OgdAccounts', monthlyPastoralReports: 'MonthlyPastoralReports', reports: 'Reports', activities: 'Activities',
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

const mobileTabs = computed(() => mobileTabsFor(roleName.value, canView));

// Pages opened from the dashboard's Services grid keep the Dashboard tab lit.
function isTabActive(tab, index) {
  if (currentTab.value === tab.key) return true;
  return index === 0 && !mobileTabs.value.some((other) => other.key === currentTab.value);
}

function openToast() {
  sessionState.messageToast = null;
  selectTab('messages');
}

// On phones the Messages button slides away while scrolling down the page and
// comes back on any scroll up, so it never sits on top of what is being read.
const isFabTucked = ref(false);
let lastScrollTop = 0;
function onContentScroll(event) {
  const top = event.target.scrollTop;
  if (Math.abs(top - lastScrollTop) < 6) return;
  isFabTucked.value = top > lastScrollTop && top > 80;
  lastScrollTop = top;
}
watch(currentTab, () => {
  isFabTucked.value = false;
  lastScrollTop = 0;
});

// The sidebar's glow follows the pointer, at most once per frame.
const sideEl = ref(null);
let glowFrame = 0;
function followPointer(event) {
  if (glowFrame || !sideEl.value) return;
  const { clientX, clientY } = event;
  glowFrame = requestAnimationFrame(() => {
    glowFrame = 0;
    if (!sideEl.value) return;
    const box = sideEl.value.getBoundingClientRect();
    sideEl.value.style.setProperty('--mx', `${((clientX - box.left) / box.width) * 100}%`);
    sideEl.value.style.setProperty('--my', `${((clientY - box.top) / box.height) * 100}%`);
  });
}
onBeforeUnmount(() => cancelAnimationFrame(glowFrame));

function openMessagesFromDisclaimer() {
  sessionState.disclaimerVisible = false;
  selectTab('messages');
}
</script>

<template>
  <div class="shell" :class="{ collapsed: isCollapsed }">
    <aside v-if="isWide" ref="sideEl" class="side" @pointermove="followPointer">
      <div class="side-decor" aria-hidden="true"><span class="blob one" /><span class="blob two" /><span class="spot" /><span class="lines" /></div>
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
            :title="isCollapsed ? item.label : undefined" :aria-current="currentTab === item.key ? 'page' : undefined" @click="selectTab(item.key)"
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
        <span v-if="!isWide" class="top-glow" aria-hidden="true" />
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
          <OgdStatus v-if="isOgdRole()" @open="selectTab('ogdAccounts')" />
          <button class="icon-btn" aria-label="Messages" @click="selectTab('messages')">
            <MessageCircle :size="19" />
            <span v-if="sessionState.unreadMessages" class="badge">{{ sessionState.unreadMessages > 99 ? '99+' : sessionState.unreadMessages }}</span>
          </button>
        </template>
        <template v-else>
          <div class="m-brand grow">
            <span class="m-mark"><img src="/oracle-logo.png" alt="" /></span>
            <strong>ORACLE</strong>
            <small class="clamp">{{ portalLabel.toUpperCase() }}</small>
          </div>
          <OgdStatus v-if="isOgdRole()" @open="selectTab('ogdAccounts')" />
        </template>
        <button class="avatar-btn" aria-label="My profile" @click="selectTab('profile')">
          <img v-if="avatarUrl" :src="avatarUrl" class="avatar" alt="" />
          <span v-else class="avatar">{{ initials }}</span>
        </button>
        <button v-if="!isWide" class="m-logout" aria-label="Log out" @click="signOut"><LogOut :size="20" /></button>
      </header>

      <main class="content" @scroll.passive="onContentScroll">
        <component :is="activeScreen" v-if="activeScreen" v-bind="screenProps" :key="currentTab" />
        <div v-else-if="isKnownPage || !isAllowed" class="no-access">
          <Lock :size="28" />
          <p>{{ roleName ? "You don't have access to this page yet. Ask an Admin to grant it." : 'Your account has no role assigned yet. Ask an Admin to assign one.' }}</p>
        </div>
        <CreditFooter v-if="currentTab !== 'messages'" />
      </main>
    </div>

    <template v-if="!isWide && currentTab !== 'messages'">
      <nav class="bottom" aria-label="Main">
        <button v-for="(tab, index) in mobileTabs" :key="tab.key" class="bottom-item" :class="{ on: isTabActive(tab, index) }" :aria-current="currentTab === tab.key ? 'page' : undefined" @click="selectTab(tab.key)">
          <span class="bottom-icon"><component :is="tab.icon" :size="22" /></span>
          <span class="clamp">{{ tab.label }}</span>
        </button>
      </nav>
      <button class="fab" :class="{ tucked: isFabTucked }" aria-label="Messages" @click="selectTab('messages')">
        <MessagesSquare :size="24" />
        <span v-if="sessionState.unreadMessages" class="badge">{{ sessionState.unreadMessages > 9 ? '9+' : sessionState.unreadMessages }}</span>
      </button>
    </template>

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
/* ---------- Desktop shell: navy sidebar + white workspace, as on the login ---------- */
.shell {
  --side: 236px; --navy: #002060; --navy-deep: #00133d;
  height: 100%; display: flex; padding: 16px;
  background: radial-gradient(1100px 520px at 10% -10%, #fff 0%, transparent 60%), var(--bg);
}
.shell.collapsed { --side: 80px; }

.side {
  --mx: 40%; --my: 15%;
  position: relative; isolation: isolate; overflow: hidden; width: var(--side); flex: none; display: flex; flex-direction: column;
  color: #fff; border-radius: 24px 0 0 24px; padding: 22px 14px 14px; transition: width 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
  background: linear-gradient(170deg, var(--navy) 0%, var(--navy-deep) 70%, #000b26 100%);
  box-shadow: 0 30px 70px -30px rgba(0, 32, 96, 0.45);
}
.side-decor { position: absolute; inset: 0; z-index: -1; pointer-events: none; }
.side-decor .blob { position: absolute; border-radius: 50%; filter: blur(50px); opacity: 0.5; }
.side-decor .one { width: 160%; height: 30%; left: -40%; top: -6%; background: #3b6fd8; animation: side-drift 20s ease-in-out infinite alternate; }
.side-decor .two { width: 140%; height: 26%; left: -20%; bottom: 4%; background: var(--accent); opacity: 0.28; animation: side-drift 26s ease-in-out infinite alternate-reverse; }
.side-decor .spot { position: absolute; inset: 0; background: radial-gradient(260px circle at var(--mx) var(--my), rgba(165, 142, 114, 0.28), rgba(59, 111, 216, 0.1) 45%, transparent 70%); }
.side-decor .lines {
  position: absolute; inset: 0;
  background-image: linear-gradient(rgba(255, 255, 255, 0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.045) 1px, transparent 1px);
  background-size: 36px 36px; mask-image: linear-gradient(180deg, #000 0%, transparent 55%);
}
.side-brand { display: flex; align-items: center; gap: 11px; padding: 0 4px 22px; }
.collapsed .side-brand { justify-content: center; padding-inline: 0; }
.brand-mark {
  width: 42px; height: 42px; border-radius: 13px; flex: none; display: grid; place-items: center;
  background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.18); backdrop-filter: blur(6px);
  transition: transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.side-brand:hover .brand-mark { transform: rotate(-6deg) scale(1.05); }
.brand-mark img { width: 24px; height: 21px; object-fit: contain; filter: brightness(0) invert(1); }
.brand-text { display: flex; flex-direction: column; min-width: 0; }
.brand-text strong { font-size: 14px; letter-spacing: 0.14em; }
.brand-text small { font-size: 11px; color: rgba(255, 255, 255, 0.6); }

.side-nav { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 3px; scrollbar-width: none; margin: 0 -4px; padding: 0 4px; }
.nav-item {
  position: relative; display: flex; align-items: center; gap: 11px; width: 100%; border: 0; background: none; border-radius: 12px;
  padding: 10px 12px; font-size: 13px; font-weight: 500; color: rgba(255, 255, 255, 0.72); text-align: left;
  transition: background 0.25s, color 0.25s, transform 0.25s;
}
.collapsed .nav-item { justify-content: center; padding-inline: 0; }
.nav-item svg { flex: none; transition: transform 0.25s; }
.nav-item:hover { background: rgba(255, 255, 255, 0.08); color: #fff; transform: translateX(3px); }
.collapsed .nav-item:hover { transform: none; }
.nav-item:hover svg { transform: scale(1.1); }
.nav-item:focus-visible { outline: 2px solid rgba(255, 255, 255, 0.6); outline-offset: 1px; }
.nav-item.on {
  color: #fff; font-weight: 600;
  background: linear-gradient(120deg, rgba(165, 142, 114, 0.38), rgba(59, 111, 216, 0.32));
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.16), 0 10px 24px -12px rgba(165, 142, 114, 0.8);
}
.nav-item.on::before { content: ''; position: absolute; left: -4px; top: 22%; bottom: 22%; width: 3px; border-radius: 3px; background: #fff; box-shadow: 0 0 10px rgba(255, 255, 255, 0.8); }
.nav-item.logout { color: #fca5a5; }
.nav-item.logout:hover { background: rgba(248, 113, 113, 0.14); color: #fecaca; }
.nav-group { font-size: 10.5px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(255, 255, 255, 0.45); padding: 16px 12px 6px; }
.nav-count { background: #e5484d; color: #fff; font-size: 10.5px; font-weight: 700; border-radius: 10px; padding: 1px 7px; box-shadow: 0 0 0 2px rgba(0, 19, 61, 0.8); }
.side-foot { display: flex; flex-direction: column; gap: 3px; padding-top: 10px; border-top: 1px solid rgba(255, 255, 255, 0.12); }
.side-version { font-size: 10px; color: rgba(255, 255, 255, 0.45); text-align: center; margin-top: 6px; }

.main {
  flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden;
  background: var(--surface); border: 1px solid var(--line); border-left: 0; border-radius: 0 24px 24px 0;
  box-shadow: 0 30px 70px -40px rgba(0, 32, 96, 0.3);
}
.top {
  position: relative; z-index: 5; display: flex; align-items: center; gap: 12px; padding: 18px 28px 14px;
  background: rgba(255, 255, 255, 0.82); backdrop-filter: saturate(1.4) blur(12px); border-bottom: 1px solid var(--line);
}
.top-title { font-size: 19px; font-weight: 600; letter-spacing: -0.01em; }
.top-sub { font-size: 12.5px; color: var(--muted); }
.top-search { position: relative; width: 260px; }
.top-search .input { border-radius: 12px; background: var(--surface-hover); }
.top-search .input:focus { background: #fff; }
.top-results {
  position: absolute; z-index: 30; top: calc(100% + 8px); left: 0; right: 0; list-style: none; margin: 0; padding: 6px;
  background: var(--surface); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow-pop); animation: pop-in 0.18s ease both;
}
.top-results button { width: 100%; display: flex; align-items: center; gap: 9px; border: 0; background: none; border-radius: 9px; padding: 9px 10px; font-size: 13px; text-align: left; transition: background 0.15s, transform 0.15s; }
.top-results button:hover { background: var(--surface-hover); transform: translateX(2px); }
.avatar-btn { border: 0; background: none; padding: 0; border-radius: 50%; transition: transform 0.2s, box-shadow 0.2s; }
.avatar-btn:hover { transform: scale(1.06); box-shadow: 0 0 0 3px rgba(0, 32, 96, 0.12); }
.content { flex: 1; overflow-y: auto; background: linear-gradient(180deg, #fbfaf8 0%, #f8f6f2 100%); position: relative; }
.no-access { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--muted); text-align: center; padding: 32px; font-size: 13px; }
.no-access p { max-width: 320px; }
.toast {
  position: fixed; z-index: 90; top: 70px; right: 16px; width: min(340px, calc(100vw - 32px)); display: flex; align-items: flex-start;
  background: linear-gradient(150deg, var(--navy), var(--navy-deep)); color: #fff; border-radius: 14px; padding: 12px 10px 12px 14px;
  box-shadow: 0 20px 40px -12px rgba(0, 32, 96, 0.55); animation: toast-in 0.35s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
.toast-open { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; border: 0; background: none; color: inherit; text-align: left; padding: 0; font-size: 12.5px; }
.toast-open span { opacity: 0.8; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.toast-close { border: 0; background: none; color: rgba(255, 255, 255, 0.7); padding: 2px; }

@keyframes side-drift { from { transform: translate(0, 0) scale(1); } to { transform: translate(10%, 8%) scale(1.15); } }
@keyframes pop-in { from { opacity: 0; transform: translateY(-4px) scale(0.98); } to { opacity: 1; transform: none; } }
@keyframes toast-in { from { opacity: 0; transform: translateY(-10px) scale(0.97); } to { opacity: 1; transform: none; } }
@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .side-decor .blob, .top-results, .toast { animation: none; }
}

/* ---------- Phone: glowing navy header, floating glass tab bar ---------- */
@media (max-width: 767.98px) {
  .shell { display: flex; flex-direction: column; padding: 0; background: var(--bg); }
  .main { border: 0; border-radius: 0; flex: 1; min-height: 0; background: var(--bg); box-shadow: none; }
  .top {
    overflow: hidden; isolation: isolate; color: #fff; border: 0; backdrop-filter: none;
    padding: 14px 18px 16px; padding-top: calc(14px + env(safe-area-inset-top)); border-radius: 0 0 22px 22px;
    background: linear-gradient(150deg, var(--navy) 0%, var(--navy-deep) 100%); box-shadow: 0 14px 30px -18px rgba(0, 32, 96, 0.8);
  }
  .top-glow {
    position: absolute; inset: 0; z-index: -1; pointer-events: none;
    background: radial-gradient(220px 120px at 18% 0%, rgba(59, 111, 216, 0.55), transparent 70%), radial-gradient(200px 110px at 95% 100%, rgba(165, 142, 114, 0.4), transparent 70%);
  }
  .m-brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .m-mark { width: 32px; height: 32px; border-radius: 10px; display: grid; place-items: center; flex: none; background: rgba(255, 255, 255, 0.12); border: 1px solid rgba(255, 255, 255, 0.2); }
  .m-mark img { width: 19px; height: 17px; object-fit: contain; filter: brightness(0) invert(1); }
  .m-brand strong { font-size: 18px; font-weight: 800; letter-spacing: 2px; }
  .m-brand small { font-size: 10.5px; color: #a5c8ff; letter-spacing: 1px; font-weight: 600; margin-top: 3px; }
  .avatar { width: 32px; height: 32px; background: rgba(255, 255, 255, 0.14); color: #fff; border: 1px solid rgba(255, 255, 255, 0.35); }
  .avatar-btn:hover { box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.2); }
  .m-logout { border: 0; background: rgba(255, 255, 255, 0.1); color: #fff; padding: 7px; border-radius: 10px; display: flex; }
  /* Room at the end of every page so its last item can scroll clear of the Messages button. */
  .content { background: var(--bg); padding-bottom: 76px; scroll-padding-bottom: 76px; }

  .bottom {
    flex: none; display: flex; margin: 0 10px calc(10px + env(safe-area-inset-bottom)); padding: 6px;
    background: rgba(255, 255, 255, 0.88); backdrop-filter: saturate(1.6) blur(14px); border: 1px solid rgba(226, 232, 240, 0.9);
    border-radius: 22px; box-shadow: 0 16px 36px -14px rgba(0, 32, 96, 0.35);
  }
  .bottom-item {
    flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 3px; border: 0; background: none;
    padding: 4px 2px; font-size: 10px; font-weight: 700; color: #94a3b8; border-radius: 16px; transition: color 0.2s;
  }
  .bottom-item:active .bottom-icon { transform: scale(0.9); }
  .bottom-item.on { color: var(--navy); }
  .bottom-icon { position: relative; display: grid; place-items: center; width: 46px; height: 30px; border-radius: 12px; transition: background 0.25s, transform 0.15s; }
  .bottom-item.on .bottom-icon { background: linear-gradient(120deg, rgba(0, 32, 96, 0.12), rgba(59, 111, 216, 0.16)); }
  .bottom-icon .badge { top: -4px; right: 2px; border-color: #fff; }
  .fab {
    position: fixed; z-index: 20; right: 16px; bottom: calc(96px + env(safe-area-inset-bottom)); width: 56px; height: 56px; border-radius: 18px; border: 0;
    color: #fff; display: flex; align-items: center; justify-content: center; background: linear-gradient(140deg, #1d4ed8, var(--navy));
    box-shadow: 0 14px 28px -10px rgba(0, 32, 96, 0.7); transition: transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.25s;
  }
  .fab:active { transform: scale(0.94); }
  .fab.tucked { transform: translateY(24px) scale(0.6); opacity: 0; pointer-events: none; }
  .fab .badge { top: -5px; right: -5px; min-width: 20px; height: 20px; font-size: 11px; border: 2px solid #fff; }
}
</style>

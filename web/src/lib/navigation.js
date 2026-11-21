import {
  BarChart3, CheckCheck, FileText, FolderOpen, Home, Hourglass, Inbox, KeyRound,
  LayoutDashboard, LineChart, ListChecks, PartyPopper, Settings, TrendingUp, UserCog, UserRound, Users, Wrench,
} from 'lucide-vue-next';

// `group` renders under its own labelled section in the sidebar.
export const NAV_ITEMS = [
  { key: 'home', label: 'Dashboard', icon: Home },
  { key: 'adminDashboard', label: 'Admin Dashboard', icon: LayoutDashboard },
  { key: 'members', label: 'Directory', icon: Users },
  { key: 'myChangeRequests', label: 'My Change Requests', icon: Hourglass },
  { key: 'manageMembers', label: 'Manage Members', icon: ListChecks },
  { key: 'pfo', label: 'PFO Trainings', icon: BarChart3 },
  { key: 'pfoReports', label: 'PFO Reports', icon: TrendingUp },
  { key: 'pfoStats', label: 'Formation Stats', icon: LineChart },
  { key: 'clp', label: 'CLP Maintenance', icon: Wrench },
  { key: 'materials', label: 'Materials', icon: FolderOpen },
  { key: 'ogdAccounts', label: 'OGD Accounts', icon: KeyRound },
  { key: 'ogdChapters', label: 'OGD Accounts', icon: KeyRound },
  { key: 'monthlyPastoralReports', label: 'Monthly Pastoral Reports', icon: FileText },
  { key: 'reports', label: 'Reports', icon: PartyPopper },
  { key: 'portalUsers', label: 'Portal Users', icon: UserCog },
  { key: 'logs', label: 'Logs', icon: Inbox },
  { key: 'settings', label: 'Settings', icon: Settings },
  { key: 'memberChangeQueue', label: 'Change Requests', icon: CheckCheck, group: 'Moderation' },
];

export const PAGE_LABELS = NAV_ITEMS.reduce(
  (labels, item) => ({ ...labels, [item.key]: item.label }),
  { profile: 'My Profile', messages: 'Messages', predictor: 'Predictor' },
);

// Phones: three tabs. Every other page is a tile in the dashboard's Services grid.
export function mobileTabsFor(roleName, canView) {
  const dashboard = roleName === 'Admin' && canView('adminDashboard') ? 'adminDashboard' : 'home';
  const memberPages = roleName === 'Admin' ? ['manageMembers', 'members'] : ['members', 'manageMembers'];
  const members = memberPages.find((key) => canView(key)) || null;
  return [
    { key: dashboard, label: 'Dashboard', icon: Home },
    ...(members ? [{ key: members, label: 'Members', icon: Users }] : []),
    { key: 'profile', label: 'Profile', icon: UserRound },
  ];
}

export function servicesFor(roleName, canView) {
  const tabKeys = new Set(mobileTabsFor(roleName, canView).map((tab) => tab.key));
  return NAV_ITEMS.filter((item) => canView(item.key) && !tabKeys.has(item.key)
    && !(item.key === 'ogdChapters' && canView('ogdAccounts')));
}

import {
  BarChart3, CalendarDays, ClipboardList, CheckCheck, FileText, FolderOpen, Home, Hourglass, Inbox, KeyRound,
  LayoutDashboard, LineChart, ListChecks, PartyPopper, Settings, TrendingUp, UserCog, UserRound, Users, Wrench,
} from 'lucide-vue-next';

// `group` renders under its own labelled section in the sidebar, in the
// order the groups first appear here.
export const NAV_ITEMS = [
  { key: 'home', label: 'Dashboard', icon: Home, group: 'Dashboard' },
  { key: 'adminDashboard', label: 'Admin Dashboard', icon: LayoutDashboard, group: 'Dashboard' },
  { key: 'members', label: 'Directory', icon: Users, group: 'Members' },
  { key: 'myChangeRequests', label: 'My Change Requests', icon: Hourglass, group: 'Members' },
  { key: 'manageMembers', label: 'Manage Members', icon: ListChecks, group: 'Members' },
  { key: 'ogdAccounts', label: 'OGD Accounts', icon: KeyRound, group: 'OGD' },
  { key: 'ogdChapters', label: 'OGD Accounts', icon: KeyRound, group: 'OGD' },
  { key: 'activities', label: 'Activities', icon: CalendarDays, group: 'OGD' },
  { key: 'pfo', label: 'PFO Trainings', icon: BarChart3, group: 'PFO' },
  { key: 'pfoReports', label: 'PFO Reports', icon: TrendingUp, group: 'PFO' },
  { key: 'pfoStats', label: 'Formation Stats', icon: LineChart, group: 'PFO' },
  { key: 'clp', label: 'CLP Maintenance', icon: Wrench, group: 'Others' },
  { key: 'materials', label: 'Materials', icon: FolderOpen, group: 'Others' },
  { key: 'monthlyPastoralReports', label: 'Monthly Pastoral Reports', icon: FileText, group: 'Others' },
  { key: 'memberReports', label: 'Reports', icon: ClipboardList, group: 'Others' },
  { key: 'reports', label: 'OGD Celebrants', icon: PartyPopper, group: 'Others' },
  { key: 'portalUsers', label: 'Portal Users', icon: UserCog, group: 'Others' },
  { key: 'logs', label: 'Logs', icon: Inbox, group: 'Others' },
  { key: 'settings', label: 'Settings', icon: Settings, group: 'Others' },
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

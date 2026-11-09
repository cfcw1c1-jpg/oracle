import {
  BarChart3, BookOpen, CheckCheck, FileText, FolderOpen, Home, Hourglass, Inbox, KeyRound, Layers,
  LayoutDashboard, LineChart, ListChecks, Settings, TrendingUp, UserCog, Users, Wrench,
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
  { key: 'portalUsers', label: 'Portal Users', icon: UserCog },
  { key: 'logs', label: 'Logs', icon: Inbox },
  { key: 'settings', label: 'Settings', icon: Settings },
  { key: 'memberChangeQueue', label: 'Change Requests', icon: CheckCheck, group: 'Moderation' },
];

export const PAGE_LABELS = NAV_ITEMS.reduce(
  (labels, item) => ({ ...labels, [item.key]: item.label }),
  { profile: 'My Profile', messages: 'Messages', predictor: 'Predictor' },
);

const PFO_CHILDREN = [
  { key: 'pfo', label: 'Trainings', icon: BarChart3 },
  { key: 'pfoReports', label: 'Reports', icon: TrendingUp },
  { key: 'pfoStats', label: 'Formation Stats', icon: LineChart },
];

const DEFAULT_TABS = [
  { key: 'home', label: 'Dashboard', icon: Home },
  { key: 'members', label: 'Directory', icon: Users },
  { key: 'pfoGroup', label: 'PFO', icon: Layers, children: PFO_CHILDREN },
  { key: 'clp', label: 'CLP', icon: Wrench },
  { key: 'materials', label: 'Materials', icon: FolderOpen },
];

const MODERATOR_TABS = [
  { key: 'home', label: 'Dashboard', icon: Home },
  {
    key: 'membersGroup', label: 'Members', icon: Users,
    children: [
      { key: 'members', label: 'Directory', icon: Users },
      { key: 'portalUsers', label: 'Portal Users', icon: UserCog },
      { key: 'clp', label: 'CLP', icon: Wrench },
    ],
  },
  { key: 'memberChangeQueue', label: 'Change Request', icon: CheckCheck, badgeKey: 'memberChangeQueue' },
  { key: 'pfoGroup', label: 'PFO', icon: Layers, children: PFO_CHILDREN },
  { key: 'materials', label: 'Materials', icon: FolderOpen },
];

const ADMIN_TABS = [
  { key: 'adminDashboard', label: 'Dashboard', icon: Home },
  {
    key: 'membersGroup', label: 'Members', icon: Users,
    children: [
      { key: 'manageMembers', label: 'Manage Members', icon: ListChecks },
      { key: 'clp', label: 'CLP Maintenance', icon: Wrench },
      { key: 'portalUsers', label: 'Portal Users', icon: UserCog },
      { key: 'memberChangeQueue', label: 'Change Requests', icon: CheckCheck },
    ],
  },
  { key: 'materials', label: 'Materials', icon: FolderOpen },
  { key: 'logs', label: 'Logs', icon: Inbox },
  { key: 'settings', label: 'Settings', icon: Settings },
];

export function mobileTabsForRole(roleName) {
  return { Moderator: MODERATOR_TABS, Admin: ADMIN_TABS }[roleName] || DEFAULT_TABS;
}

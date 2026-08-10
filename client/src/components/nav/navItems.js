import {
  IconCash,
  IconClipboardList,
  IconFileText,
  IconHelpCircle,
  IconHistory,
  IconLayoutDashboard,
  IconUser,
  IconWallet,
} from '@tabler/icons-react';

/**
 * Navigation entries per role. Single source — the sidebar and the bottom nav both
 * read from here, so they can never drift out of sync.
 *
 * `primary: true` marks the items that survive into the mobile bottom nav, which
 * fits four comfortably at 375px. Everything else stays sidebar-only.
 */
export const studentNav = [
  { to: '/app', label: 'Home', icon: IconLayoutDashboard, primary: true, end: true },
  { to: '/app/ask', label: "I'm stuck", icon: IconHelpCircle, primary: true },
  { to: '/app/wallet', label: 'Wallet', icon: IconWallet, primary: true },
  { to: '/app/history', label: 'History', icon: IconHistory, primary: true },
];

export const teacherNav = [
  { to: '/teach', label: 'Dashboard', icon: IconLayoutDashboard, primary: true, end: true },
  { to: '/teach/earnings', label: 'Earnings', icon: IconCash, primary: true },
  { to: '/teach/profile', label: 'Profile', icon: IconUser, primary: true },
  { to: '/teach/onboarding', label: 'Onboarding', icon: IconClipboardList, primary: false },
];

export const adminNav = [
  { to: '/admin/documents', label: 'Documents', icon: IconFileText, primary: true },
  { to: '/admin/sessions', label: 'Sessions', icon: IconClipboardList, primary: true },
];

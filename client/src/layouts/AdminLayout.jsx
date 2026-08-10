import AppLayout from '@/layouts/AppLayout';
import { adminNav } from '@/components/nav/navItems';

/**
 * Not in the PR 0.5 brief, which listed three layouts — but MVP.md §14.1 has two
 * /admin routes and nowhere to put them. Minimal on purpose: admin is an internal
 * surface (E9) and gets no design investment.
 */
export default function AdminLayout() {
  return <AppLayout navItems={adminNav} brandLabel="Admin" brandHref="/admin" />;
}

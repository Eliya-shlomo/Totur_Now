import AppLayout from '@/layouts/AppLayout';
import { studentNav } from '@/components/nav/navItems';

export default function StudentLayout() {
  return <AppLayout navItems={studentNav} brandLabel="Student" brandHref="/app" />;
}

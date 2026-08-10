import AppLayout from '@/layouts/AppLayout';
import { teacherNav } from '@/components/nav/navItems';

export default function TeacherLayout() {
  return <AppLayout navItems={teacherNav} brandLabel="Teach" brandHref="/teach" />;
}

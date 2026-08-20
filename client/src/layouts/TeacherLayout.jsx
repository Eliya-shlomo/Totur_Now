import OfferHost from '@/components/offer/OfferHost';
import AppLayout from '@/layouts/AppLayout';
import { teacherNav } from '@/components/nav/navItems';

/**
 * `/teach/*`. The shell, plus the one thing a teacher must not be able to walk away
 * from — PR 6b.3.
 *
 * `OfferHost` is here rather than on the dashboard because an offer is addressed to
 * the teacher, not to a screen. This layout is mounted for every `/teach/*` route, so
 * the listener lives as long as the teacher is anywhere in their own area. It is a
 * sibling of the shell rather than a child of the outlet: the modal portals to the
 * document body either way, and a route change must not unmount it.
 */
export default function TeacherLayout() {
  return (
    <>
      <AppLayout navItems={teacherNav} brandLabel="Teach" brandHref="/teach" />
      <OfferHost />
    </>
  );
}

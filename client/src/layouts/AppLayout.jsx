import { AppShell, Burger, Group, Text, useMantineTheme } from '@mantine/core';
import { useDisclosure, useMediaQuery } from '@mantine/hooks';
import { Outlet, Link } from 'react-router-dom';

import SidebarNav from '@/components/nav/SidebarNav';
import BottomNav from '@/components/nav/BottomNav';

/**
 * The shared shell behind the student, teacher and admin layouts.
 *
 * Responsive behaviour, MVP.md §14.4:
 *   < 768px    single column, no sidebar, fixed bottom nav
 *   768–1024   sidebar collapsed behind a burger
 *   > 1024px   sidebar always visible
 *
 * The three role layouts differ only in their nav items and brand label, so they
 * pass those in rather than duplicating this file three times.
 */
export default function AppLayout({ navItems, brandLabel, brandHref }) {
  const theme = useMantineTheme();
  const [opened, { toggle, close }] = useDisclosure(false);

  // MVP.md §14.4 boundaries. `sm` is 48em/768px, `md` is 64em/1024px.
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const isTablet = useMediaQuery(
    `(min-width: ${theme.breakpoints.sm}) and (max-width: ${theme.breakpoints.md})`,
  );

  const { headerHeight, sidebarWidth, bottomNavHeight } = theme.other.layout;

  return (
    <AppShell
      header={{ height: headerHeight }}
      navbar={
        isMobile
          ? undefined
          : {
              width: sidebarWidth,
              // 'sm' keeps AppShell in desktop mode for every width we render a
              // navbar at. Driving the collapse from `desktop` rather than `mobile`
              // is what makes the tablet sidebar a real 260px column that slides,
              // instead of Mantine's full-width mobile overlay.
              breakpoint: 'sm',
              collapsed: { mobile: true, desktop: isTablet ? !opened : false },
            }
      }
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" gap="sm">
          {isTablet && (
            <Burger
              opened={opened}
              onClick={toggle}
              size="sm"
              aria-label={opened ? 'Close navigation' : 'Open navigation'}
            />
          )}
          <Text component={Link} to={brandHref} fw={700} size="lg" td="none" c="inherit">
            TutorNow
          </Text>
          <Text size="sm" c="dimmed">
            {brandLabel}
          </Text>
        </Group>
      </AppShell.Header>

      {!isMobile && (
        <AppShell.Navbar p="sm">
          <SidebarNav items={navItems} onNavigate={close} />
        </AppShell.Navbar>
      )}

      <AppShell.Main pb={isMobile ? bottomNavHeight + 16 : undefined}>
        <Outlet />
      </AppShell.Main>

      {isMobile && <BottomNav items={navItems} />}
    </AppShell>
  );
}

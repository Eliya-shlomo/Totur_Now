import { AppShell, Burger, Group, Text, useMantineTheme } from '@mantine/core';
import { useDisclosure, useMediaQuery } from '@mantine/hooks';
import { Outlet, Link, useLocation } from 'react-router-dom';

import ErrorBoundary from '@/components/ErrorBoundary';
import SidebarNav from '@/components/nav/SidebarNav';
import BottomNav from '@/components/nav/BottomNav';
import UserMenu from '@/components/nav/UserMenu';

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
 *
 * **The second `ErrorBoundary` is here rather than in `App.jsx` — PR 10.3.** The outer
 * one wraps the router, so a throw in any screen took the header, the sidebar and the
 * bottom nav down with it. This one wraps the `Outlet` only: a screen that throws is a
 * screen-sized hole in a working application. `resetKey` is the pathname, so navigating
 * away clears it — without that the nav would be rendered and every link in it dead.
 */
export default function AppLayout({ navItems, brandLabel, brandHref }) {
  const theme = useMantineTheme();
  const { pathname } = useLocation();
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
        {/*
          Brand on the left, account on the right. The header is the only chrome
          present in all three layouts at every width — the sidebar is gone below
          768px and the bottom nav is four fixed icons — so it is where the account
          menu, and with it the way to log out, has to live.
        */}
        <Group h="100%" px="md" gap="sm" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
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
            <Text size="sm" c="dimmed" visibleFrom="xs">
              {brandLabel}
            </Text>
          </Group>

          <UserMenu />
        </Group>
      </AppShell.Header>

      {!isMobile && (
        <AppShell.Navbar p="sm">
          <SidebarNav items={navItems} onNavigate={close} />
        </AppShell.Navbar>
      )}

      <AppShell.Main pb={isMobile ? bottomNavHeight + 16 : undefined}>
        <ErrorBoundary variant="inline" resetKey={pathname}>
          <Outlet />
        </ErrorBoundary>
      </AppShell.Main>

      {isMobile && <BottomNav items={navItems} />}
    </AppShell>
  );
}

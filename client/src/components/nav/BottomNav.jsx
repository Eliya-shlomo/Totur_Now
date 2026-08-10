import { Paper, Stack, Text, UnstyledButton } from '@mantine/core';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMantineTheme } from '@mantine/core';

/**
 * Mobile navigation — MVP.md §14.4 requires bottom nav below 768px.
 *
 * Mantine has no bottom-nav component, so this is hand-built. It is fixed to the
 * viewport bottom and sits above the safe-area inset, which matters on iPhones where
 * the home indicator would otherwise overlap the tap targets.
 *
 * Only `primary` items appear here; four is what fits at 375px.
 */
export default function BottomNav({ items }) {
  const theme = useMantineTheme();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const primary = items.filter((item) => item.primary);

  return (
    <Paper
      withBorder
      shadow="sm"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 200,
        display: 'flex',
        borderRadius: 0,
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {primary.map(({ to, label, icon: Icon, end }) => {
        const active = end ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);

        return (
          <UnstyledButton
            key={to}
            onClick={() => navigate(to)}
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            style={{
              flex: 1,
              // 44px is the minimum comfortable tap target; the theme value is taller
              // to leave room for the label underneath the icon.
              minHeight: theme.other.layout.bottomNavHeight,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: active
                ? `var(--mantine-color-${theme.primaryColor}-6)`
                : 'var(--mantine-color-dimmed)',
            }}
          >
            <Stack gap={2} align="center">
              <Icon size={22} stroke={active ? 2 : 1.5} />
              <Text size="xs" fw={active ? 600 : 400}>
                {label}
              </Text>
            </Stack>
          </UnstyledButton>
        );
      })}
    </Paper>
  );
}

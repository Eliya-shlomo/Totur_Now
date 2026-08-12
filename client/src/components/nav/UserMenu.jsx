import { Avatar, Group, Menu, Text, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconLogout } from '@tabler/icons-react';

import { useAuthStore } from '@/stores/authStore';

/**
 * The account control in the app header — who you are, and the way out.
 *
 * It lives in the header rather than at the bottom of the sidebar because the
 * sidebar does not exist below 768px, where the nav is four fixed icons at the foot
 * of the screen with no room for a fifth. The header is the one piece of chrome
 * that is on screen in all three layouts at every width, which makes it the only
 * place a logout can always be found.
 *
 * The name is hidden below `sm` and the avatar carries the initials on its own —
 * "Log out" is what the menu is for on a phone, and a full name in a 375px header
 * pushes the wordmark off the line.
 */

/** "Dana Levi" → "DL". One letter if there is only one word, and never more than two. */
function initials(fullName) {
  return (fullName ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

export default function UserMenu() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  // The layouts render behind `ProtectedRoute`, so this is only ever null for the
  // frame between a hard reload and `/auth/me` answering. Rendering nothing for that
  // frame is better than a menu with an empty name in it.
  if (!user) return null;

  // Rendered inline rather than through Mantine's default portal. A portal exists to
  // escape a clipping or stacking context, and the header has neither — it is
  // `overflow: visible`, and the dropdown carries a z-index above it — so the portal
  // would buy nothing and only adds a mount that has to happen before the menu can
  // appear.
  return (
    <Menu position="bottom-end" shadow="md" width={220} withinPortal={false}>
      <Menu.Target>
        <UnstyledButton aria-label="Account menu" px="xs" py={4}>
          <Group gap="xs" wrap="nowrap">
            <Avatar src={user.avatarUrl} alt="" radius="xl" size={34} color="teal">
              {initials(user.fullName)}
            </Avatar>

            <Text size="sm" fw={500} visibleFrom="sm" lineClamp={1} maw={160}>
              {user.fullName}
            </Text>

            <IconChevronDown size={16} stroke={1.5} />
          </Group>
        </UnstyledButton>
      </Menu.Target>

      <Menu.Dropdown>
        {/*
          The email rather than the name: the name is already on the button, and the
          question this answers is "which of my accounts am I in right now", which a
          display name shared by a test student and a test teacher cannot settle.
        */}
        <Menu.Label>{user.email}</Menu.Label>

        <Menu.Divider />

        {/*
          `logout()` clears the cookie server-side, drops the store, and hard-loads
          `/login`. No confirmation dialog: signing back in is two fields, and the
          session is not something that can be lost by ending it.
        */}
        <Menu.Item leftSection={<IconLogout size={16} stroke={1.5} />} onClick={logout}>
          Log out
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

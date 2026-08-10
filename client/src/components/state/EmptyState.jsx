import { Button, Center, Stack, Text, Title } from '@mantine/core';
import { IconInbox } from '@tabler/icons-react';

/**
 * "Every list has an empty state" (docs/CONVENTIONS.md → Client). This component
 * existing is what turns that from a wish into something a reviewer can check.
 *
 * An empty state without a next action is a dead end, so `action` is the point of
 * the component — e.g. "No teachers available right now" + "Notify me".
 *
 * @param {React.ComponentType} [icon]  a Tabler icon component, not an element
 * @param {string} title
 * @param {string} [message]
 * @param {string} [actionLabel]
 * @param {() => void} [onAction]  both action props are needed for a button to render
 */
export default function EmptyState({
  icon: Icon = IconInbox,
  title,
  message,
  actionLabel,
  onAction,
  minHeight = 200,
}) {
  return (
    <Center mih={minHeight} p="md">
      <Stack gap="sm" align="center" maw={340}>
        <Icon size={40} stroke={1.5} color="var(--mantine-color-dimmed)" />

        <Stack gap={4} align="center">
          <Title order={4} ta="center">
            {title}
          </Title>
          {message && (
            <Text size="sm" c="dimmed" ta="center">
              {message}
            </Text>
          )}
        </Stack>

        {actionLabel && onAction && (
          <Button variant="light" onClick={onAction} mt="xs">
            {actionLabel}
          </Button>
        )}
      </Stack>
    </Center>
  );
}

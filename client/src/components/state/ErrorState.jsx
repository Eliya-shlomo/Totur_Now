import { Button, Center, Stack, Text, Title } from '@mantine/core';
import { IconAlertCircle, IconRefresh } from '@tabler/icons-react';

/**
 * The error half of an async view. Use it when a fetch failed and the screen has
 * nothing to show; use `notify.apiError` when the screen still has content and the
 * failure was an action.
 *
 * @param {ApiError|Error|string} [error] rendered as its `message` — always safe
 *                                        to display, see ApiError
 * @param {string} [title]
 * @param {() => void} [onRetry]  omit and no button renders
 * @param {string} [retryLabel]
 */
export default function ErrorState({
  error,
  title = 'Could not load this',
  onRetry,
  retryLabel = 'Try again',
  minHeight = 200,
}) {
  const message =
    (typeof error === 'string' ? error : error?.message) ??
    'Something went wrong. Please try again.';

  return (
    <Center mih={minHeight} p="md">
      <Stack gap="sm" align="center" maw={340}>
        <IconAlertCircle size={40} stroke={1.5} color="var(--mantine-color-red-6)" />

        <Stack gap={4} align="center">
          <Title order={4} ta="center">
            {title}
          </Title>
          <Text size="sm" c="dimmed" ta="center">
            {message}
          </Text>
        </Stack>

        {onRetry && (
          <Button variant="light" leftSection={<IconRefresh size={16} />} onClick={onRetry} mt="xs">
            {retryLabel}
          </Button>
        )}
      </Stack>
    </Center>
  );
}

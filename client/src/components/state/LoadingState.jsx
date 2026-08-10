import { Center, Loader, Stack, Text } from '@mantine/core';

/**
 * The loading half of "every async view has a loading and an error state"
 * (docs/CONVENTIONS.md → Client). A review item, not a polish item.
 *
 * @param {string} [label]   what is being waited on, e.g. "Finding teachers…"
 * @param {number} [minHeight] reserve vertical space so the layout does not jump
 *                             when the content arrives
 */
export default function LoadingState({ label = 'Loading…', minHeight = 200 }) {
  return (
    <Center mih={minHeight} p="md">
      <Stack gap="sm" align="center">
        <Loader size="md" />
        {label && (
          <Text size="sm" c="dimmed" ta="center">
            {label}
          </Text>
        )}
      </Stack>
    </Center>
  );
}

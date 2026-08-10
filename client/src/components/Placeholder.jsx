import { Badge, Card, Code, Group, Stack, Text, Title } from '@mantine/core';
import { useLocation, useParams } from 'react-router-dom';

/**
 * Stand-in for a screen that has not been built yet.
 *
 * One component instead of twenty near-identical page files: when a real screen
 * lands, its PR swaps a single line in the relevant `routes.*.jsx` array and adds
 * one page file. Nothing to delete, and the route tree stays reviewable today.
 *
 * @param {string} title  what this screen will be
 * @param {string} pr     the PR that replaces it, e.g. "1.3"
 */
export default function Placeholder({ title, pr }) {
  const { pathname } = useLocation();
  const params = useParams();
  const paramEntries = Object.entries(params);

  return (
    <Card withBorder padding="lg">
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap">
          <Title order={2}>{title}</Title>
          {pr && <Badge variant="light">PR {pr}</Badge>}
        </Group>

        <Text c="dimmed" size="sm">
          Placeholder — the route resolves, the screen is not built yet.
        </Text>

        <Code>{pathname}</Code>

        {paramEntries.length > 0 && (
          <Group gap="xs">
            {paramEntries.map(([key, value]) => (
              <Badge key={key} variant="outline" color="gray">
                {key}: {value}
              </Badge>
            ))}
          </Group>
        )}
      </Stack>
    </Card>
  );
}

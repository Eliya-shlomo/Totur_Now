import { Card, List, Stack, Text, Title } from '@mantine/core';

/**
 * What a block is and why billing works this way — MVP.md §5.1.
 *
 * Every number comes from the `block` payload of `/public/pricing`, which the
 * server derives from `config/constants/session.js`. Nothing is written as a
 * literal here, including the ones that feel permanent: "10 minutes" is
 * `openingMinutes`, because it is `BLOCK_MINUTES × OPENING_BLOCKS` on the server
 * and a page that hardcodes the product goes stale the day either factor moves.
 *
 * @param {object} block  `{ minutes, openingBlocks, openingMinutes, extensionBlocks,
 *                          extensionMinutes, warningSeconds }`
 */
export default function BlocksExplainer({ block }) {
  return (
    <Card withBorder radius="md" padding="lg">
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={3}>How a session is billed</Title>
          <Text size="sm" c="dimmed">
            In blocks of {block.minutes} minutes — never by the second.
          </Text>
        </Stack>

        <List spacing="sm" size="sm">
          <List.Item>
            <Text span fw={600}>
              The opening block is {block.openingMinutes} minutes
            </Text>{' '}
            ({block.openingBlocks} blocks). It is charged when the session starts and cannot be
            cancelled — the teacher has already shown up.
          </List.Item>

          <List.Item>
            <Text span fw={600}>
              Each extension adds {block.extensionMinutes} minutes
            </Text>{' '}
            and only ever happens because you approved it.
          </List.Item>

          <List.Item>
            You are asked {block.warningSeconds} seconds before a block ends. No answer means the
            session closes — silence never costs you money.
          </List.Item>
        </List>

        <Text size="sm" c="dimmed">
          A per-second meter makes you rush, and rushing is how you leave still stuck. Blocks turn
          the clock into a few clear decisions instead, and every extension you approve is the only
          thing a teacher earns more from — which makes their incentive to explain well rather than
          to stretch it out.
        </Text>
      </Stack>
    </Card>
  );
}

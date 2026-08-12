import { Badge, Card, Group, Stack, Text, Title } from '@mantine/core';

/**
 * Credits, top-ups and the budget cap — MVP.md §5.4, §5.1.
 *
 * "1 credit = ₪1" is a definition rather than a price, which is why it is the one
 * ratio written in this file: it is what makes every other number on the page
 * readable as shekels. The amounts themselves — packages and the default cap —
 * come from `/public/pricing`.
 *
 * @param {number[]} topupPackages
 * @param {object} budget  `{ defaultCap }`
 */
export default function CreditsPanel({ topupPackages, budget }) {
  return (
    <Card withBorder radius="md" padding="lg">
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={3}>Credits</Title>
          <Text size="sm" c="dimmed">
            One credit is one shekel. You load credit up front and spend it a block at a time.
          </Text>
        </Stack>

        <Group gap="xs">
          {topupPackages.map((amount) => (
            <Badge key={amount} size="lg" variant="light">
              ₪{amount}
            </Badge>
          ))}
        </Group>

        <Text size="sm" c="dimmed">
          Every question also carries a spending cap you set in advance — ₪{budget.defaultCap} until
          you change it. Once it is reached the session cannot extend again, so a long session can
          never surprise you.
        </Text>
      </Stack>
    </Card>
  );
}

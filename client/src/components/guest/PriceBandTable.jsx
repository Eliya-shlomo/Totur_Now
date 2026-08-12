import { Card, Stack, Table, Text, Title } from '@mantine/core';

/**
 * What a session costs — MVP.md §5.2.
 *
 * The honest answer to "how much is this" is a range, because the teacher sets
 * the price and the platform only bounds it. So the page says that first and
 * shows the bands second: a band is the filter a student picks, not a tier the
 * platform sells.
 *
 * `price` and `bands` both come from `/public/pricing`. The band floors are
 * derived server-side from the ceilings (`#utils/pricing.js`), so the two ends of
 * every range here move together with `money.js` and cannot disagree with it.
 *
 * @param {object} price  `{ min, max, default }` credits per block
 * @param {Array<{ key: string, minPrice: number, maxPrice: number }>} bands
 * @param {number} openingMinutes  used for the worked example
 * @param {number} openingBlocks
 */
export default function PriceBandTable({ price, bands, openingMinutes, openingBlocks }) {
  return (
    <Card withBorder radius="md" padding="lg">
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={3}>
            ₪{price.min}–₪{price.max} per block
          </Title>
          <Text size="sm" c="dimmed">
            The teacher sets their own price inside that range. We do not decide what a teacher is
            worth — we show you their rating, their track record and their price, and you weigh them
            yourself.
          </Text>
        </Stack>

        <Text size="sm">
          At the ₪{price.default} that most teachers start from, an opening block of{' '}
          {openingMinutes} minutes costs ₪{price.default * openingBlocks}.
        </Text>

        <Table
          horizontalSpacing="sm"
          verticalSpacing="xs"
          striped
          withTableBorder
          // A three-row table cannot overflow at 375px, but the container is here
          // so it stays true if a fourth band with a wider label ever lands.
          styles={{ table: { minWidth: 280 } }}
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Band</Table.Th>
              <Table.Th>Per block</Table.Th>
              <Table.Th>You see</Table.Th>
            </Table.Tr>
          </Table.Thead>

          <Table.Tbody>
            {bands.map((band, index) => (
              <Table.Tr key={band.key}>
                <Table.Td fw={600}>{band.key}</Table.Td>
                <Table.Td>
                  ₪{band.minPrice}–₪{band.maxPrice}
                </Table.Td>
                <Table.Td>
                  {/* A band is a ceiling: picking B shows A and B. Listing the
                      keys is clearer than the rule stated abstractly. */}
                  {bands
                    .slice(0, index + 1)
                    .map((visible) => visible.key)
                    .join(', ')}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>

        <Text size="xs" c="dimmed">
          Picking a band sets a ceiling, so a cheaper teacher is never hidden from you. Price never
          changes the ranking — within what you chose to spend, teachers are ordered by how well
          they teach.
        </Text>
      </Stack>
    </Card>
  );
}

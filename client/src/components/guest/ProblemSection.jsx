import { Card, SimpleGrid, Stack, Text, Title } from '@mantine/core';

/**
 * "Why nothing else works at 10 PM" — MVP.md §1, the alternatives table.
 *
 * Kept as the spec wrote it: each option gets its real strength implied and its
 * failure stated plainly. Overstating how bad the alternatives are would be the
 * easy version and the visitor has used all four of these — they know which parts
 * are true.
 */
const ALTERNATIVES = [
  {
    option: 'A private tutor',
    problem: 'Booked in advance, a full hour, ₪150–250 — and not available tonight.',
  },
  {
    option: 'The class WhatsApp group',
    problem: 'An answer in two hours, if one comes, and often the wrong one.',
  },
  {
    option: 'YouTube and solution sites',
    problem: 'They explain a question. Rarely this question, never your specific confusion.',
  },
  {
    option: 'ChatGPT',
    problem: 'Hands you an answer without teaching it — and you cannot tell whether it is right.',
  },
];

export default function ProblemSection() {
  return (
    <Stack gap="lg">
      <Stack gap="xs" maw={640}>
        <Title order={2}>It is 10 PM, a week before the exam</Title>
        <Text c="dimmed">
          You are practising, you hit a question you cannot get past, and every option in front of
          you fails at exactly this moment.
        </Text>
      </Stack>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        {ALTERNATIVES.map(({ option, problem }) => (
          <Card key={option} withBorder padding="lg" radius="md">
            <Stack gap={6}>
              <Text fw={600}>{option}</Text>
              <Text size="sm" c="dimmed">
                {problem}
              </Text>
            </Stack>
          </Card>
        ))}
      </SimpleGrid>
    </Stack>
  );
}

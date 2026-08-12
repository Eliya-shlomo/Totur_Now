import { SimpleGrid, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconCamera, IconUsers, IconVideo } from '@tabler/icons-react';

/**
 * Three steps — MVP.md §1's flow, cut to what a visitor needs before deciding.
 *
 * The spec's flow has seven arrows in it. Three is not a simplification for its
 * own sake: classification, the offer and the rating all happen *around* the
 * student, and a landing page that lists them describes our system instead of
 * their evening.
 */
const STEPS = [
  {
    icon: IconCamera,
    title: 'Photograph the question',
    body: 'A photo or a sentence. It gets read and sorted by topic and level before anyone sees it.',
  },
  {
    icon: IconUsers,
    title: 'Pick from teachers who are online',
    body: 'A short list, ranked by who is actually good at this topic — with their rating, their track record and their price.',
  },
  {
    icon: IconVideo,
    title: 'Talk it through on video',
    body: 'It starts within about a minute. You extend it only if you want more, and it ends when you are unstuck.',
  },
];

export default function HowItWorks() {
  return (
    <Stack gap="lg">
      <Title order={2}>How it works</Title>

      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xl">
        {STEPS.map(({ icon: Icon, title, body }, index) => (
          <Stack key={title} gap="sm">
            <ThemeIcon size={44} radius="md" variant="light">
              <Icon size={24} stroke={1.5} />
            </ThemeIcon>

            <Stack gap={4}>
              <Text fw={600}>
                {index + 1}. {title}
              </Text>
              <Text size="sm" c="dimmed">
                {body}
              </Text>
            </Stack>
          </Stack>
        ))}
      </SimpleGrid>
    </Stack>
  );
}

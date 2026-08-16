import { Badge, Card, Group, Image, Stack, Text, Title } from '@mantine/core';
import { IconAlertTriangle, IconSparkles } from '@tabler/icons-react';

/**
 * What the machine made of the question — or the admission that it could not. PR 3.7,
 * MVP.md §8.1, §4.1.
 *
 * Presentational and stateless: `Classifying.jsx` owns the question and the override,
 * and this file decides what the answer looks like.
 *
 * **One component, two headlines, branching on `classificationOk`.** The fallback is
 * not a second screen and not an error: §8.1 is explicit that a failed classification
 * must not block the flow, so the question is filed under the sentinel topic and the
 * student is *asked* rather than told. Two components would be two places to change
 * when the copy changes, and the fallback is the one nobody would remember.
 *
 * **The sentinel is never rendered as an answer.** On the fallback path `topicId` is
 * `General / Unclassified` and `subtopicId` is null — a real row, and a real answer to
 * a different question. Printing it here would tell the student the machine decided
 * "General", which is exactly what it did not do. So the resolved topic is shown only
 * when the classification succeeded, and the fallback shows the student's own words
 * instead.
 *
 * No confidence number. It is `llm_confidence` in the database and 3.8's retro reads
 * it there; a student choosing whether to agree is not helped by "0.62".
 *
 * @param {import('@tutor/shared').QuestionResponse} question
 * @param {string|null} topicLabel     "Calculus · Integrals", resolved by the page
 */
export default function ClassificationCard({ question, topicLabel }) {
  const { classification, rawText, attachments } = question;
  const isConfident = classification.classificationOk;
  /**
   * The fallback path after the student has answered it themselves.
   *
   * `classificationOk` stays false forever — it records whether the *model* managed
   * it, and 3.8's retro wants that number honest — so the headline cannot be the only
   * thing that moves when an override lands. Without this branch a student who has
   * just picked "Integrals" would still be reading "we could not work out the topic".
   */
  const isAnsweredByStudent = !isConfident && Boolean(topicLabel);

  return (
    <Card withBorder radius="md" padding="lg">
      <Stack gap="md">
        <Group gap="xs" wrap="nowrap" align="flex-start">
          {isConfident || isAnsweredByStudent ? (
            <IconSparkles size={20} color="var(--mantine-color-teal-6)" />
          ) : (
            <IconAlertTriangle size={20} color="var(--mantine-color-orange-6)" />
          )}

          <Stack gap={4}>
            {isConfident && (
              <>
                {/* The one sentence written for the student to read, straight from
                    the model (§8.1). The teacher-facing brief is a different column
                    and does not belong on this screen. */}
                <Title order={3}>{classification.studentConfirmation}</Title>
                {classification.title && (
                  <Text size="sm" c="dimmed">
                    {classification.title}
                  </Text>
                )}
              </>
            )}

            {isAnsweredByStudent && (
              <>
                <Title order={3}>Topic set</Title>
                <Text size="sm" c="dimmed">
                  We could not read this one, so this is your answer — and it is the one we will
                  match on.
                </Text>
              </>
            )}

            {!isConfident && !isAnsweredByStudent && (
              <>
                <Title order={3}>We could not work out the topic</Title>
                <Text size="sm" c="dimmed">
                  That does not stop anything — pick the topic below and we will find you a teacher
                  for it.
                </Text>
              </>
            )}
          </Stack>
        </Group>

        {/*
          Driven by `topicLabel`, which the page resolves from `subtopicId` alone. On
          the fallback path that id is null and no badge renders — the sentinel topic
          is a real row and a real answer to a different question, and printing
          "General / Unclassified" here would tell the student the machine decided
          something when it decided nothing.
        */}
        {(topicLabel || classification.estimatedLevel) && (
          <Group gap="xs" wrap="wrap">
            {topicLabel && (
              <Badge variant="light" size="lg" radius="sm">
                {topicLabel}
              </Badge>
            )}

            {classification.estimatedLevel && (
              <Badge variant="default" size="lg" radius="sm">
                {classification.estimatedLevel} units
              </Badge>
            )}
          </Group>
        )}

        {/* What the student actually sent, kept on screen underneath. Arriving here
            after a reload — or after 3.6's request timed out and this is the recovery
            path — the first question is "is this my question?", and the answer is
            their own words and their own photograph. */}
        <Stack gap="xs">
          <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
            {rawText}
          </Text>

          {attachments.length > 0 && (
            <Group gap="xs" wrap="wrap">
              {attachments.map((attachment) => (
                <Image
                  key={attachment.id}
                  src={attachment.fileUrl}
                  alt="The exercise you photographed"
                  w={72}
                  h={72}
                  radius="sm"
                  fit="cover"
                  style={{ border: '1px solid var(--mantine-color-gray-3)' }}
                />
              ))}
            </Group>
          )}
        </Stack>
      </Stack>
    </Card>
  );
}

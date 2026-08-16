import { Button, Card, Group, Radio, Stack, Text } from '@mantine/core';
import { useState } from 'react';

import TopicPicker from '@/components/teacher/TopicPicker';

/**
 * The student disagreeing with the machine. PR 3.7, MVP.md §8.1.
 *
 * The taxonomy control is `components/teacher/TopicPicker` in its single-selection
 * mode — imported, not copied. It is the same tree from the same
 * `GET /public/topics`, and it already enforces the rule that matters here: parents
 * are headings, leaves are the only thing selectable. A second picker in this folder
 * would be two components that disagree about what a leaf is the week F1's cleanup
 * lands, which is the class of defect E2's retro asked this codebase to stop shipping.
 *
 * **The draft is local; the saved answer is not.** This component holds what the
 * student has picked but not yet sent, the same arrangement `Onboarding.jsx` uses for
 * its step drafts: a rejected `PATCH` leaves the choice on screen to retry rather than
 * snapping back to what the server still holds. `Classifying.jsx` owns the question
 * itself and re-seeds this control by remounting it on a successful save.
 *
 * **Both ids leave together.** The picker answers with a leaf; its parent is looked up
 * here and sent alongside, because §9.2 scores the leaf at 1.0 and the parent at 0.3
 * and the server refuses the pair if they do not match. The student is never asked to
 * pick a parent — that is a question about the taxonomy's shape, not about their
 * exercise.
 */

/** `MATH_LEVELS` — `server/src/config/constants/user.js`. Mirrored; see `Ask.jsx`. */
const MATH_LEVELS = [3, 4, 5];

/**
 * @param {Array} topics  the two-level tree from `GET /public/topics`
 * @param {number|null} subtopicId    what the classification currently holds
 * @param {number|null} estimatedLevel
 * @param {(override: {topicId: number, subtopicId: number, estimatedLevel?: number}) => void} onSave
 * @param {boolean} [saving]
 * @param {string} [error]  a field-level message from the server's `VALIDATION_ERROR`
 * @param {boolean} [primary]  the fallback path, where this is the only thing to do
 */
export default function TopicOverride({
  topics,
  subtopicId,
  estimatedLevel,
  onSave,
  saving = false,
  error,
  primary = false,
}) {
  const [leafId, setLeafId] = useState(subtopicId);
  const [level, setLevel] = useState(estimatedLevel);

  /** The parent of the picked leaf. Null until something is picked, and never guessed. */
  const parent = topics.find((topic) =>
    (topic.children ?? []).some((child) => child.id === leafId),
  );

  const isUnchanged = leafId === subtopicId && level === estimatedLevel;

  function save() {
    if (!parent) return;

    onSave({
      topicId: parent.id,
      subtopicId: leafId,
      // Omitted rather than nulled when the student did not choose one: an absent key
      // leaves whatever the model estimated, which is a better answer than nothing.
      ...(level ? { estimatedLevel: level } : {}),
    });
  }

  return (
    <Card withBorder radius="md" padding="lg">
      <Stack gap="lg">
        <TopicPicker
          topics={topics}
          selection="single"
          value={leafId}
          onChange={setLeafId}
          label={primary ? 'What is this question about?' : 'Not quite? Pick the right one.'}
          description={
            primary
              ? 'Pick the closest subtopic. It is what we match teachers on.'
              : 'Only the subtopics are pickable — that is what teachers are ranked by.'
          }
          error={error}
          disabled={saving}
        />

        <Radio.Group
          // Mantine's groups speak strings; the level is an integer in the contract.
          value={level === null || level === undefined ? null : String(level)}
          onChange={(value) => setLevel(Number(value))}
          label="Which level is this exercise?"
          description="Optional. Leave it if the guess above looks right."
        >
          <Group gap="lg" mt="xs">
            {MATH_LEVELS.map((option) => (
              <Radio
                key={option}
                value={String(option)}
                label={`${option} units`}
                disabled={saving}
              />
            ))}
          </Group>
        </Radio.Group>

        <Group justify="flex-end">
          <Button
            onClick={save}
            loading={saving}
            // Nothing picked is nothing to send, and re-sending what the server
            // already holds is a request that can only fail — a question whose offer
            // went out answers `SESSION_NOT_ACTIVE` even for a no-op.
            disabled={!parent || isUnchanged}
            variant={primary ? 'filled' : 'light'}
          >
            Save this topic
          </Button>
        </Group>

        {!parent && (
          <Text size="xs" c="dimmed">
            Pick a subtopic to save.
          </Text>
        )}
      </Stack>
    </Card>
  );
}

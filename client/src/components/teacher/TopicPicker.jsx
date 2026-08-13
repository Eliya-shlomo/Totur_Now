import { Checkbox, Divider, ScrollArea, Stack, Text } from '@mantine/core';

/**
 * The topic tree as a multi-select — step 1 of the onboarding stepper (PR 2.4).
 *
 * Controlled and stateless. `Onboarding.jsx` owns the selection because it is the
 * thing being saved, and a picker holding its own copy would be a second source of
 * truth that survives a failed `PATCH` while the page's does not.
 *
 * **Parents are headings, not options.** The same rule the server enforces on
 * `topicIds` (`assertLeafTopics` in `teacher.me.service.js`) and the same one 2.5's
 * `TeacherFilters` applies to the student's filter. A parent is not a teachable
 * claim: the matching engine scores on the subtopic (§9.3), so a teacher who declared
 * "Algebra" and nothing under it could not be ranked. A childless root — the seeded
 * `General / Unclassified` sentinel (§8.1) — contributes no heading at all rather
 * than an empty one.
 *
 * `nameEn` is the label. `client/index.html` fixed the UI as English and LTR at PR
 * 0.5, so a Hebrew topic list would be the only Hebrew on the screen; `nameHe` rides
 * along in the payload for the day that changes and for the E3 classifier.
 *
 * @param {Array} topics  the two-level tree from `GET /public/topics`
 * @param {number[]} value  selected leaf ids
 * @param {(ids: number[]) => void} onChange
 * @param {string} [error]  rendered under the group — from the server or the step guard
 * @param {boolean} [disabled]  while a save is in flight
 */
export default function TopicPicker({ topics, value, onChange, error, disabled = false }) {
  const groups = topics.filter((parent) => parent.children?.length > 0);

  return (
    <Checkbox.Group
      // Mantine's group speaks strings; the ids are integers on the wire and in the
      // contract. The conversion happens here, once, so nothing downstream has to
      // remember which of the two it is holding.
      value={value.map(String)}
      onChange={(ids) => onChange(ids.map(Number))}
      error={error}
      label="What do you teach?"
      description="Pick every subtopic you are comfortable being matched on. You can change this later."
      withAsterisk
    >
      {/* A bounded, scrolling list rather than a growing one: the taxonomy is long
          enough that at 375px the Next button would otherwise sit several screens
          below the first checkbox, and a stepper whose action is invisible reads as
          a dead end. */}
      <ScrollArea.Autosize mah={360} type="auto" offsetScrollbars mt="sm">
        <Stack gap="lg" pr="xs">
          {groups.map((parent, index) => (
            <Stack key={parent.id} gap="xs">
              {index > 0 && <Divider />}

              <Text fw={600} size="sm">
                {parent.nameEn}
              </Text>

              <Stack gap={8} pl="xs">
                {parent.children.map((child) => (
                  <Checkbox
                    key={child.id}
                    value={String(child.id)}
                    label={child.nameEn}
                    disabled={disabled}
                  />
                ))}
              </Stack>
            </Stack>
          ))}
        </Stack>
      </ScrollArea.Autosize>

      <SelectionCount count={value.length} />
    </Checkbox.Group>
  );
}

/**
 * How many topics are selected, said in words.
 *
 * The list scrolls, so the checked boxes can all be off-screen while the teacher
 * reads the Next button. Without this, "at least one required" is a rule they can
 * only test by pressing the button.
 */
function SelectionCount({ count }) {
  return (
    <Text size="sm" c={count === 0 ? 'dimmed' : undefined} mt="sm">
      {count === 0
        ? 'Nothing selected yet.'
        : `${count} ${count === 1 ? 'topic' : 'topics'} selected.`}
    </Text>
  );
}

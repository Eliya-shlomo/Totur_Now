import { Checkbox, Divider, Radio, ScrollArea, Stack, Text } from '@mantine/core';

/**
 * The topic tree as a picker — step 1 of the onboarding stepper (PR 2.4), and the
 * override control on the classification screen (PR 3.7).
 *
 * Controlled and stateless. The page owns the selection because it is the thing being
 * saved, and a picker holding its own copy would be a second source of truth that
 * survives a failed request while the page's does not.
 *
 * **Parents are headings, not options.** The same rule the server enforces on
 * `topicIds` (`assertLeafTopics` in `teacher.me.service.js`), the one 2.5's
 * `TeacherFilters` applies to the student's filter, and the one 3.5's
 * `question.classify.service.js` enforces on an override: a parent is not an answer.
 * The matching engine scores on the subtopic (§9.2, §9.3), so a teacher who declared
 * "Algebra" and nothing under it could not be ranked, and a question filed under it
 * would be half a row. A childless root — the seeded `General / Unclassified`
 * sentinel (§8.1) — contributes no heading at all rather than an empty one.
 *
 * **Two selection modes, one tree.** 2.4 checks many leaves; 3.7 picks exactly one.
 * The mode changes the control and the copy and nothing else — the grouping, the
 * leaves-only rule and the scroll behaviour are the parts worth having in one place,
 * and F1's leaf-topic cleanup lands in one file for both screens. A second picker in
 * `components/question/` would be two components that disagree about what a leaf is,
 * which is the defect E2's retro asked this codebase to stop shipping.
 *
 * `nameEn` is the label. `client/index.html` fixed the UI as English and LTR at PR
 * 0.5, so a Hebrew topic list would be the only Hebrew on the screen; `nameHe` rides
 * along in the payload for the day that changes and for the E3 classifier.
 *
 * @param {Array} topics  the two-level tree from `GET /public/topics`
 * @param {number[]|number|null} value  selected leaf ids, or the one selected leaf
 * @param {(selection: number[]|number) => void} onChange  symmetric with `value`
 * @param {'multiple'|'single'} [selection]  the control, and what `value` means
 * @param {string} [label]        defaults to 2.4's teacher-facing question
 * @param {string} [description]
 * @param {string} [error]  rendered under the group — from the server or a page guard
 * @param {boolean} [disabled]  while a save is in flight
 */
export default function TopicPicker({
  topics,
  value,
  onChange,
  selection = 'multiple',
  label = 'What do you teach?',
  description = 'Pick every subtopic you are comfortable being matched on. You can change this later.',
  error,
  disabled = false,
}) {
  const groups = topics.filter((parent) => parent.children?.length > 0);

  if (selection === 'single') {
    return (
      <Radio.Group
        // Mantine's groups speak strings; the ids are integers on the wire and in the
        // contract. The conversion happens here, once, so nothing downstream has to
        // remember which of the two it is holding.
        value={value === null || value === undefined ? null : String(value)}
        onChange={(id) => onChange(Number(id))}
        error={error}
        label={label}
        description={description}
      >
        <TopicTree
          groups={groups}
          renderLeaf={(leaf) => (
            <Radio key={leaf.id} value={String(leaf.id)} label={leaf.nameEn} disabled={disabled} />
          )}
        />
      </Radio.Group>
    );
  }

  return (
    <Checkbox.Group
      value={value.map(String)}
      onChange={(ids) => onChange(ids.map(Number))}
      error={error}
      label={label}
      description={description}
      withAsterisk
    >
      <TopicTree
        groups={groups}
        renderLeaf={(leaf) => (
          <Checkbox key={leaf.id} value={String(leaf.id)} label={leaf.nameEn} disabled={disabled} />
        )}
      />

      <SelectionCount count={value.length} />
    </Checkbox.Group>
  );
}

/**
 * The taxonomy, laid out. Parents are headings and leaves are whatever the caller's
 * control is — the one piece of this file both modes share.
 *
 * A bounded, scrolling list rather than a growing one: the taxonomy is long enough
 * that at 375px the page's own button would otherwise sit several screens below the
 * first option, and a form whose action is invisible reads as a dead end.
 */
function TopicTree({ groups, renderLeaf }) {
  return (
    <ScrollArea.Autosize mah={360} type="auto" offsetScrollbars mt="sm">
      <Stack gap="lg" pr="xs">
        {groups.map((parent, index) => (
          <Stack key={parent.id} gap="xs">
            {index > 0 && <Divider />}

            <Text fw={600} size="sm">
              {parent.nameEn}
            </Text>

            <Stack gap={8} pl="xs">
              {parent.children.map(renderLeaf)}
            </Stack>
          </Stack>
        ))}
      </Stack>
    </ScrollArea.Autosize>
  );
}

/**
 * How many topics are selected, said in words. Multi-select only — with one radio
 * group the answer is the control itself.
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

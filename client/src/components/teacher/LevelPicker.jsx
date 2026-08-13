import { Alert, Group, Radio, Stack, Text } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';

/**
 * The self-declared teaching level — step 2 of the onboarding stepper (PR 2.4).
 *
 * Controlled and stateless, like `TopicPicker`: the page owns the value because the
 * page is what saves it.
 *
 * `levelMax` is a ceiling — "the highest level I can teach" — and the server filters
 * the public list with `levelMax >= level`, so a teacher on 5 also answers questions
 * from a student on 3. The labels say so, because a teacher who reads it as "the
 * level I usually teach" will under-declare and take fewer matches than they wanted.
 *
 * **Nobody verifies it, and the screen says so.** MVP.md §6.1: the platform's actual
 * filter is ratings, not a document check. Stated plainly rather than hidden in a
 * tooltip — a teacher who believes it is checked under-declares, and a teacher who
 * discovers later that it never was has been misled by omission.
 *
 * @param {number|null} value  the selected level
 * @param {(level: number) => void} onChange
 * @param {string} [error]
 * @param {boolean} [disabled]  while a save is in flight
 */
export default function LevelPicker({ value, onChange, error, disabled = false }) {
  return (
    <Radio.Group
      // Mantine's group speaks strings; `levelMax` is an integer in the contract.
      value={value === null || value === undefined ? null : String(value)}
      onChange={(level) => onChange(Number(level))}
      error={error}
      label="What is the highest level you can teach?"
      description="A ceiling, not a specialisation — you will also be matched with students below it."
      withAsterisk
    >
      <Stack gap="xs" mt="sm">
        {LEVEL_OPTIONS.map((option) => (
          <Radio.Card
            key={option.value}
            value={String(option.value)}
            p="md"
            radius="md"
            withBorder
            // A whole card as the hit area rather than the dot alone. At 375px a
            // radio dot is a 20px target next to a full-width row of text, and the
            // text is what a thumb aims at.
            style={disabled ? { opacity: 0.6, pointerEvents: 'none' } : undefined}
          >
            <Group wrap="nowrap" align="flex-start" gap="sm">
              <Radio.Indicator disabled={disabled} />

              <Stack gap={2}>
                <Text fw={600} size="sm">
                  {option.label}
                </Text>
                <Text size="xs" c="dimmed">
                  {option.description}
                </Text>
              </Stack>
            </Group>
          </Radio.Card>
        ))}
      </Stack>

      <Alert
        icon={<IconInfoCircle size={16} />}
        color="gray"
        variant="light"
        mt="md"
        title="This is self-declared"
      >
        Nobody checks it. Your ratings are what students actually judge you on, so declaring a level
        you are not comfortable with costs you more than it gains.
      </Alert>
    </Radio.Group>
  );
}

/**
 * The three teaching levels — Bagrut units, §6.1.
 *
 * A literal list, and the fourth copy of it in this repository: `TEACHING_LEVELS` in
 * `server/src/config/constants/teacher.js` is the source, `MATH_LEVELS` in
 * `components/auth/authRules.js` mirrors it for the register form, and
 * `LEVEL_OPTIONS` in `components/teacher/TeacherFilters.jsx` mirrors it for the
 * student's filter. It is not published through `@tutor/shared` or any `/public`
 * endpoint, so importing it is not available today.
 *
 * Copying it is the convention this codebase already chose twice rather than a
 * shortcut taken here: exposing the constant is a change to a shared contract, which
 * is a chat message before code (the epic README) rather than something to slip into
 * a screen PR. Every copy names the others so the set is greppable, and 2.7 is where
 * the real fix belongs.
 *
 * Wording differs from `TeacherFilters` on purpose. There the levels are a student's
 * "and up" filter; here they are the teacher's own ceiling, which is the other side
 * of the same `levelMax >= level` comparison.
 */
const LEVEL_OPTIONS = [
  {
    value: 3,
    label: '3 units',
    description: 'The standard track. You will be matched with 3-unit students.',
  },
  {
    value: 4,
    label: '4 units',
    description: 'Also covers 3-unit students.',
  },
  {
    value: 5,
    label: '5 units',
    description: 'The full curriculum. Covers students at every level.',
  },
];

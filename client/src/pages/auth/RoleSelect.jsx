import { Group, Paper, Stack, Text, ThemeIcon, Title, UnstyledButton } from '@mantine/core';
import { IconChalkboard, IconSchool } from '@tabler/icons-react';

/**
 * Step 1 of registration: which product you are signing up for.
 *
 * Not a dropdown in the form. The role decides the entire subsequent experience —
 * which profile row is created, which home the user lands on, which half of the app
 * exists for them — and it is immutable once the account exists, so it gets its own
 * step and the visual weight that goes with it. Two large cards also happen to be
 * the easiest thing in the world to hit with a thumb.
 *
 * Tapping a card both chooses and advances. The choice is reversible for as long as
 * the form is open (the back arrow on step 2 returns here, with what was typed still
 * in place), so a mis-tap costs one tap, and asking for a separate "Continue" press
 * would cost every correct tap a second one.
 */

/**
 * The two roles, with the copy that makes the difference concrete. Exported so step 2
 * can name the chosen one without a second copy of these strings.
 */
export const ROLE_OPTIONS = [
  {
    value: 'student',
    label: 'Student',
    title: "I'm a student",
    description: 'Get unstuck in minutes. Pay only for the time you actually use.',
    icon: IconSchool,
  },
  {
    value: 'teacher',
    label: 'Teacher',
    title: 'I want to teach',
    description: 'Set your price, go online when it suits you, and take questions.',
    icon: IconChalkboard,
  },
];

/**
 * @param {'student'|'teacher'|null} value  the current choice, highlighted
 * @param {(role: 'student'|'teacher') => void} onSelect
 */
export default function RoleSelect({ value, onSelect }) {
  return (
    <Stack gap="lg">
      <Stack gap={4}>
        <Title order={2}>Create your account</Title>
        <Text size="sm" c="dimmed">
          Step 1 of 2 — what brings you here?
        </Text>
      </Stack>

      <Stack gap="md" role="radiogroup" aria-label="What brings you here?">
        {ROLE_OPTIONS.map((option) => (
          <RoleCard
            key={option.value}
            option={option}
            selected={value === option.value}
            onSelect={() => onSelect(option.value)}
          />
        ))}
      </Stack>

      <Text size="xs" c="dimmed" ta="center">
        This cannot be changed after your account is created.
      </Text>
    </Stack>
  );
}

/**
 * One card. `UnstyledButton` with the radio role rather than a real `<input>`: a
 * radio's own hit area is a 20px circle, and the whole card needs to be the target.
 * The ARIA role and `aria-checked` are what keep it a radio group to a screen reader.
 *
 * The selected state is carried by the border colour and a tinted background — both
 * from Mantine CSS variables, never a hex, since `theme.js` owns what teal means.
 */
function RoleCard({ option, selected, onSelect }) {
  const Icon = option.icon;

  return (
    <UnstyledButton
      role="radio"
      aria-checked={selected}
      aria-label={option.title}
      onClick={onSelect}
    >
      <Paper
        withBorder
        p="md"
        style={{
          borderColor: selected ? 'var(--mantine-primary-color-filled)' : undefined,
          backgroundColor: selected ? 'var(--mantine-primary-color-light)' : undefined,
        }}
      >
        <Group wrap="nowrap" align="flex-start" gap="md">
          <ThemeIcon size={44} radius="md" variant={selected ? 'filled' : 'light'}>
            <Icon size={24} stroke={1.5} />
          </ThemeIcon>

          <Stack gap={2}>
            <Text fw={700}>{option.title}</Text>
            <Text size="sm" c="dimmed">
              {option.description}
            </Text>
          </Stack>
        </Group>
      </Paper>
    </UnstyledButton>
  );
}

import { Group, Text } from '@mantine/core';

/**
 * The one strip on the session screen that differs by role — PR 6.7, MVP.md §14.3.
 *
 * **The student sees what they have spent and what is left; the teacher sees what they
 * have earned.** Neither sees the other's number, and that is a contract property rather
 * than a layout one: `SessionState` types `balance` and `teacherEarning` as
 * `number | null` and fills exactly one of them per caller. This component renders what
 * it was given and asks for nothing else — a screen that reached for the missing field
 * would render `null` as a number and show a teacher a balance of zero.
 *
 * **Nothing here is computed.** The charge, the cap and the balance are columns; the
 * earning is the column 6.6 wrote at termination, net of §5.3's fee. A commission
 * calculated on the client would be a second answer to "what did I earn", free to
 * disagree with the ledger the moment the rate changes at 14:00.
 *
 * `teacherEarning` is `0` until the session ends — 6.6 credits once, at termination, for
 * the blocks actually consumed — so the teacher's line says *so far* and means it.
 *
 * @param {object} props
 * @param {'student'|'teacher'} props.role
 * @param {number} props.totalCharged
 * @param {number} props.budgetCap
 * @param {number|null} props.balance student only
 * @param {number|null} props.teacherEarning teacher only
 */
export default function MoneyLine({ role, totalCharged, budgetCap, balance, teacherEarning }) {
  if (role === 'teacher') {
    return (
      <Group gap={6}>
        <Text size="sm" c="dimmed">
          You have earned
        </Text>
        <Text size="sm" fw={600}>
          {credits(teacherEarning ?? 0)}
        </Text>
        <Text size="sm" c="dimmed">
          for this session so far
        </Text>
      </Group>
    );
  }

  return (
    <Group gap="lg" wrap="wrap">
      <Group gap={6}>
        <Text size="sm" c="dimmed">
          Charged
        </Text>
        <Text size="sm" fw={600}>
          {credits(totalCharged)}
        </Text>
      </Group>

      <Group gap={6}>
        <Text size="sm" c="dimmed">
          Balance
        </Text>
        {/* `null` is a missing wallet row, which is a data problem rather than a poor
            student — 6.3's ruling, kept here. A dash says nothing; a zero would lie. */}
        <Text size="sm" fw={600}>
          {balance === null ? '—' : credits(balance)}
        </Text>
      </Group>

      <Group gap={6}>
        <Text size="sm" c="dimmed">
          Limit
        </Text>
        <Text size="sm" fw={600}>
          {credits(budgetCap)}
        </Text>
      </Group>
    </Group>
  );
}

/** One credit is one shekel — §11.2, and the symbol lives here rather than in six places. */
function credits(amount) {
  return `₪${amount}`;
}

import { Button, Group, Stack, Text } from '@mantine/core';
import { IconCheck } from '@tabler/icons-react';
import { useId } from 'react';

/**
 * The most a student is willing to pay per block — the control from MVP.md §14.2.
 *
 * Three rules from the mock's own design notes, and all three are easy to lose:
 *
 * **Money, never letters.** The options are keyed `A`, `B`, `C` in the query
 * string and on the server, and the student never learns that. Every label here is
 * a price, and the words "band" and "tier" appear in no string this file renders —
 * they are an implementation detail, and asking a student to translate one into a
 * price is asking them to do the platform's filing.
 *
 * **A ceiling, not a bracket.** Picking an option shows every teacher at that
 * price or less, so the copy says "up to" and each button carries one number. A
 * segmented control of ranges would read as a bracket instead and leave a student
 * wondering where the cheap teachers went. `PriceBandTable.jsx` makes the same
 * distinction on the pricing page, and `TeacherFilters.jsx` in the browse filter.
 *
 * **Controlled and stateless.** The screen owns `value`, because it lives in the
 * query string and drives a re-fetch. A control with its own copy is a second
 * source of truth that disagrees with the address bar the first time somebody
 * presses back — the same arrangement, and the same reason, as `TeacherFilters`.
 *
 * The options come from `GET /public/pricing`, which derives them from
 * `server/src/config/constants/money.js`. There is no band table in this file: if
 * `PRICE_BANDS` grows a fourth entry the control grows a fourth button and nothing
 * here changes.
 *
 * Clicking always emits a key and never clears. `value` of `null` renders nothing
 * selected, which is the no-ceiling state the optional `priceBand` query parameter
 * already expresses; the screen decides when to go back to it.
 *
 * @param {string|null} value                   the selected band key, or `null`
 * @param {(key: string) => void} onChange      called with the key that was clicked
 * @param {Array<{key: string, minPrice: number, maxPrice: number}>} bands  cheapest first
 * @param {boolean} [disabled]
 */
export default function PriceCeiling({ value, onChange, bands, disabled = false }) {
  // `useId` rather than a fixed string: 4.7 renders one of these, but a control
  // that breaks when a screen renders two is a control with a bug waiting.
  const labelId = useId();

  return (
    <Stack gap={6}>
      <Text size="sm" fw={500} id={labelId}>
        Show teachers up to
      </Text>

      {/* Not `Button.Group`: that one joins the buttons into a single strip, which
          is exactly the segmented look that reads as a range. Loose buttons also
          wrap rather than squeeze if a fourth option ever lands at 375px. */}
      <Group gap="xs" wrap="wrap" role="group" aria-labelledby={labelId}>
        {bands.map((band) => {
          const selected = band.key === value;

          return (
            <Button
              key={band.key}
              size="sm"
              variant={selected ? 'filled' : 'default'}
              onClick={() => onChange(band.key)}
              disabled={disabled}
              aria-pressed={selected}
              /* The label is the price and nothing else, so the accessible name
                 has to carry the "up to … a block" the heading gives sighted
                 readers — a screen reader lands on the button, not the heading. */
              aria-label={`Up to ₪${band.maxPrice} per block`}
              rightSection={selected ? <IconCheck size={16} /> : null}
            >
              ₪{band.maxPrice}
            </Button>
          );
        })}
      </Group>

      <Text size="xs" c="dimmed">
        A ceiling, not a range — you still see everyone cheaper.
      </Text>
    </Stack>
  );
}

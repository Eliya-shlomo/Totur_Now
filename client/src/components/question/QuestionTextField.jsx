import { Stack, Text, Textarea } from '@mantine/core';

/**
 * "What are you stuck on?" — the one field this form insists on. PR 3.6, MVP.md §4.1.
 *
 * Controlled and stateless, the same arrangement `TopicPicker` uses: `Ask.jsx` owns
 * the value because the value is what gets submitted, and a field holding its own
 * copy would be a second source of truth that survives a failed submit while the
 * page's does not. Everything Mantine's `form.getInputProps` hands over — value,
 * onChange, onBlur, error — is spread straight through.
 *
 * The counter is the reason this is a component rather than a `<Textarea>` inline in
 * the page. §4.1's own example of a question is "I don't know how to start", so the
 * ceiling is nowhere near what a student normally types; showing the count only once
 * it is close keeps a number off the screen that would otherwise read as a target.
 */

/** Show the count only when the ceiling is actually in reach. */
const COUNTER_VISIBLE_FROM = 200;

/**
 * @param {string} value
 * @param {number} maxLength   mirrors `RAW_TEXT_MAX_LENGTH` — passed in, not read here
 * @param {boolean} [disabled]
 */
export default function QuestionTextField({ value, maxLength, disabled = false, ...inputProps }) {
  const remaining = maxLength - (value?.length ?? 0);

  return (
    <Stack gap={4}>
      <Textarea
        {...inputProps}
        value={value}
        disabled={disabled}
        label="What are you stuck on?"
        description="A sentence is enough. If the exercise is on paper, photograph it below."
        placeholder="I don't know how to start question 3…"
        // Tall enough that a two-line question does not scroll inside a one-line box,
        // and it grows from there rather than pushing the submit button off a phone.
        autosize
        minRows={3}
        maxRows={8}
        size="md"
        withAsterisk
        // Not the place to fight autocorrect: this is prose, in whatever language the
        // student thinks in. `client/index.html` fixes the UI as LTR while the text
        // itself is very often Hebrew, which the browser handles per-paragraph.
        autoCapitalize="sentences"
        // Stops at the ceiling rather than letting the student type past it and be
        // told afterwards. The server enforces the same bound; this only decides
        // where they find out.
        maxLength={maxLength}
      />

      {remaining <= COUNTER_VISIBLE_FROM && (
        <Text size="xs" c={remaining === 0 ? 'red' : 'dimmed'} ta="end">
          {remaining} characters left
        </Text>
      )}
    </Stack>
  );
}

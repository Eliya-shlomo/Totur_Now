import { Button } from '@mantine/core';

import { FIELD_SIZE } from '@/components/auth/sizing';

/**
 * The submit button both auth screens use.
 *
 * `loading` gives the spinner *and* sets `disabled`, so the mouse path to a double
 * submit is closed here and the keyboard path is closed by the in-flight ref in
 * `useAuthSubmit`. Both are needed; neither is enough alone.
 *
 * @param {boolean} pending  a request is in flight
 * @param {React.ReactNode} children  the label
 */
export default function SubmitButton({ pending, children }) {
  return (
    <Button type="submit" size={FIELD_SIZE} fullWidth mt="xs" loading={pending}>
      {children}
    </Button>
  );
}

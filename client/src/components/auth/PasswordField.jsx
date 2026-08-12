import { forwardRef } from 'react';
import { PasswordInput } from '@mantine/core';

import { FIELD_SIZE, MIN_TAP_TARGET } from '@/components/auth/sizing';

/**
 * A password field with a visibility toggle big enough to hit.
 *
 * Mantine's toggle scales with the input, which even at `size="lg"` leaves a 32px
 * button — below the 44px floor, and it is the control most likely to be reached for
 * on a phone, where retyping a password you cannot see is the thing that makes people
 * give up. The size is forced here rather than at the two call sites so the two
 * screens cannot disagree about it.
 *
 * `forwardRef` so the login screen can move focus back to the field after a rejected
 * attempt; the ref lands on the input itself.
 */
const PasswordField = forwardRef(function PasswordField(props, ref) {
  return (
    <PasswordInput
      ref={ref}
      size={FIELD_SIZE}
      visibilityToggleButtonProps={{
        style: { width: MIN_TAP_TARGET, height: MIN_TAP_TARGET },
      }}
      {...props}
    />
  );
});

export default PasswordField;

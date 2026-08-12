import { useRef } from 'react';
import { Stack, Text, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { ERROR_CODES } from '@tutor/shared';
import { zodResolver } from 'mantine-form-zod-resolver';

import PasswordField from '@/components/auth/PasswordField';
import SubmitButton from '@/components/auth/SubmitButton';
import SwitchPrompt from '@/components/auth/SwitchPrompt';
import { loginSchema, toLoginPayload } from '@/components/auth/authRules';
import { FIELD_SIZE } from '@/components/auth/sizing';
import { useAuthSubmit } from '@/components/auth/useAuthSubmit';
import { useAuthStore } from '@/stores/authStore';

/**
 * `/login` — MVP.md §14.1. PR 1.3.
 *
 * Email, password, submit. The screen's one real rule is what it does **not** do:
 * 1.4 answers every failed attempt with the same `'Invalid credentials.'`, on purpose,
 * so that a wrong password and an address with no account are indistinguishable and
 * the endpoint cannot be used to enumerate who has an account here. Anything this
 * screen added — "no account with that email", a different colour for one case, a
 * client-side check that the address exists — would hand back exactly the signal the
 * server withholds. The message is shown as it arrives and nothing is inferred from it.
 */
export default function Login() {
  const login = useAuthStore((state) => state.login);
  const passwordRef = useRef(null);

  const form = useForm({
    initialValues: { email: '', password: '' },
    validate: zodResolver(loginSchema),
    validateInputOnBlur: true,
  });

  const { pending, submit } = useAuthSubmit(login, (error) => {
    // Only ever populated for a malformed request, never for a rejected credential —
    // the generic 401 carries no `details`, which is the whole point of it.
    if (error?.details) form.setErrors(error.details);

    if (error?.is?.(ERROR_CODES.UNAUTHORIZED)) {
      // The email survives, the password does not: retyping an address on a phone to
      // correct a typo in the password is the fastest way to lose someone at the door.
      // Clearing only on a rejected credential leaves the field alone when the failure
      // was the network, where the value is still exactly what should be sent again.
      form.setFieldValue('password', '');
      passwordRef.current?.focus();
    }
  });

  return (
    <Stack gap="xl">
      <Stack gap={4}>
        <Title order={2}>Welcome back</Title>
        <Text size="sm" c="dimmed">
          Log in to pick up where you left off.
        </Text>
      </Stack>

      <form onSubmit={form.onSubmit((values) => submit(toLoginPayload(values)))} noValidate>
        <Stack gap="md">
          <TextInput
            {...form.getInputProps('email')}
            label="Email"
            placeholder="you@example.com"
            type="email"
            inputMode="email"
            size={FIELD_SIZE}
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
          />

          <PasswordField
            {...form.getInputProps('password')}
            ref={passwordRef}
            label="Password"
            autoComplete="current-password"
            required
          />

          <SubmitButton pending={pending}>Log in</SubmitButton>
        </Stack>
      </form>

      <SwitchPrompt question="New here?" to="/register" label="Create an account" />
    </Stack>
  );
}

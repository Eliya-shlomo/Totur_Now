import { useState } from 'react';
import { ActionIcon, Group, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconArrowLeft } from '@tabler/icons-react';
import { ERROR_CODES } from '@tutor/shared';
import { zodResolver } from 'mantine-form-zod-resolver';
import { useSearchParams } from 'react-router-dom';

import RoleSelect, { ROLE_OPTIONS } from '@/pages/auth/RoleSelect';
import PasswordField from '@/components/auth/PasswordField';
import SubmitButton from '@/components/auth/SubmitButton';
import SwitchPrompt from '@/components/auth/SwitchPrompt';
import {
  MATH_LEVELS,
  PASSWORD_MIN_LENGTH,
  STUDENT_GRADES,
  registerSchema,
  toRegisterPayload,
} from '@/components/auth/authRules';
import { FIELD_SIZE } from '@/components/auth/sizing';
import { useAuthSubmit } from '@/components/auth/useAuthSubmit';
import { useAuthStore } from '@/stores/authStore';

/**
 * `/register` — MVP.md §14.1. PR 1.3.
 *
 * Two steps in one component and one form. The wizard is a `step` variable rather
 * than two routes because the second step must keep what the first collected and
 * what the user typed before changing their mind: switching back to step 1, picking
 * the other role and returning leaves every field exactly as it was, since the form
 * is never unmounted.
 *
 * Registration logs the user straight in — 1.2 returns `{ user, accessToken }` and
 * sets the refresh cookie, the same as login — so there is no second login step and
 * no success toast, just the landing.
 *
 * `?role=student` or `?role=teacher` skips step 1 entirely and opens the form with
 * the role already set and named in the heading. That is where the landing page's
 * two calls to action point: a visitor who pressed "Teach with us" has already made
 * the choice, and showing them the same picker both buttons lead to makes the two
 * buttons look like one button. Anything else in the parameter — a typo, a stale
 * link, someone's experiment — falls back to the picker rather than to a role the
 * user did not choose, since the role cannot be changed after the account exists.
 */

const GRADE_DATA = STUDENT_GRADES.map((grade) => ({
  value: String(grade),
  label: `Grade ${grade}`,
}));

const LEVEL_DATA = MATH_LEVELS.map((level) => ({
  value: String(level),
  label: `${level} units`,
}));

/** The role from `?role=`, or `''` if it is absent or not one of the two. */
function roleFromParams(searchParams) {
  const requested = searchParams.get('role');
  return ROLE_OPTIONS.some((option) => option.value === requested) ? requested : '';
}

export default function Register() {
  // Read once, at mount: the parameter chooses the starting step, and after that the
  // user's own navigation owns it. Re-reading would send someone who pressed the back
  // arrow straight back to the details step.
  const [searchParams] = useSearchParams();
  const [preselected] = useState(() => roleFromParams(searchParams));

  const [step, setStep] = useState(preselected ? 'details' : 'role');
  const register = useAuthStore((state) => state.register);

  const form = useForm({
    initialValues: {
      email: '',
      password: '',
      fullName: '',
      role: preselected,
      grade: '',
      mathLevel: '',
    },
    validate: zodResolver(registerSchema),
    validateInputOnBlur: true,
  });

  const { pending, submit } = useAuthSubmit(register, (error) => {
    if (!error?.is?.(ERROR_CODES.VALIDATION_ERROR) || !error.details) return;

    // `fieldErrors()` on the server strips the leading `body.`, so these keys are
    // already the names this form uses — a duplicate email arrives as
    // `{ email: 'That email is already registered.' }` and lands under the field.
    form.setErrors(error.details);

    // An error on a field the current step does not render is an error nobody sees.
    // Only `role` can be in that position, and only if this client sent something the
    // union does not accept, but an invisible validation error is a dead end.
    if (error.details.role) setStep('role');
  });

  function chooseRole(role) {
    form.setFieldValue('role', role);
    setStep('details');
  }

  if (step === 'role') {
    return (
      <Stack gap="xl">
        <RoleSelect value={form.values.role} onSelect={chooseRole} />
        <SwitchPrompt question="Already have an account?" to="/login" label="Log in" />
      </Stack>
    );
  }

  const chosen = ROLE_OPTIONS.find((option) => option.value === form.values.role);

  return (
    <Stack gap="xl">
      <Group wrap="nowrap" align="flex-start" gap="sm">
        <ActionIcon
          variant="subtle"
          color="gray"
          size="xl"
          onClick={() => setStep('role')}
          aria-label="Back to role selection"
        >
          <IconArrowLeft size={22} stroke={1.5} />
        </ActionIcon>

        <Stack gap={4}>
          {/*
            The role is in the heading rather than in a badge beside it. Arriving
            from "Teach with us", the first line has to say which of the two accounts
            this form creates — it is the one thing on the screen that cannot be
            changed afterwards, and the fields below are nearly identical either way.
          */}
          <Title order={2}>Create your {chosen?.label.toLowerCase()} account</Title>
          <Text size="sm" c="dimmed">
            {chosen?.description}
          </Text>
        </Stack>
      </Group>

      <form onSubmit={form.onSubmit((values) => submit(toRegisterPayload(values)))} noValidate>
        <Stack gap="md">
          <TextInput
            {...form.getInputProps('fullName')}
            label="Full name"
            placeholder="Dana Levi"
            size={FIELD_SIZE}
            autoComplete="name"
            required
          />

          <TextInput
            {...form.getInputProps('email')}
            label="Email"
            placeholder="you@example.com"
            type="email"
            inputMode="email"
            size={FIELD_SIZE}
            autoComplete="email"
            // A phone's autocapitalise turns `dana@x.com` into `Dana@x.com`, which
            // registers an account whose lowercase form can never log in. The schema
            // lowercases as well; this stops the user seeing the wrong thing while
            // they type it.
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
          />

          <PasswordField
            {...form.getInputProps('password')}
            label="Password"
            description={`At least ${PASSWORD_MIN_LENGTH} characters`}
            autoComplete="new-password"
            required
          />

          {/*
            Students only, and optional even for them: grade and level sharpen
            matching rather than gate it, and a teacher may not send them at all —
            the server's teacher branch is `.strict()`.
          */}
          {form.values.role === 'student' && (
            <>
              <Select
                {...form.getInputProps('grade')}
                label="Grade"
                placeholder="Optional"
                data={GRADE_DATA}
                size={FIELD_SIZE}
                clearable
              />

              <Select
                {...form.getInputProps('mathLevel')}
                label="Math level"
                placeholder="Optional"
                data={LEVEL_DATA}
                size={FIELD_SIZE}
                clearable
              />
            </>
          )}

          <SubmitButton pending={pending}>Create account</SubmitButton>
        </Stack>
      </form>

      <SwitchPrompt question="Already have an account?" to="/login" label="Log in" />
    </Stack>
  );
}

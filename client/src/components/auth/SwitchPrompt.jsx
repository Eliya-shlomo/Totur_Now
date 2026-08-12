import { Anchor, Group, Text } from '@mantine/core';
import { Link, useLocation } from 'react-router-dom';

import { MIN_TAP_TARGET } from '@/components/auth/sizing';

/**
 * "Already have an account? Log in" — the link between the two auth screens.
 *
 * **It carries the query string across.** Someone bounced out of `/app/wallet` by
 * `ProtectedRoute` arrives at `/login?from=%2Fapp%2Fwallet`; if they decide they need
 * an account first, dropping the parameter on the way to `/register` loses the one
 * thing 1.5 went to the trouble of preserving, and they finish signup on `/app`
 * wondering where the wallet went.
 *
 * The anchor is given an explicit height because Mantine sizes a text link by its
 * text, which on a phone is a target well under the 44px floor.
 *
 * @param {string} question  the lead-in text
 * @param {string} to        `/login` or `/register`
 * @param {string} label     the link text
 */
export default function SwitchPrompt({ question, to, label }) {
  const { search } = useLocation();

  return (
    <Group justify="center" gap="xs">
      <Text size="sm" c="dimmed">
        {question}
      </Text>

      <Anchor
        component={Link}
        to={`${to}${search}`}
        size="sm"
        fw={600}
        style={{ display: 'inline-flex', alignItems: 'center', minHeight: MIN_TAP_TARGET }}
      >
        {label}
      </Anchor>
    </Group>
  );
}

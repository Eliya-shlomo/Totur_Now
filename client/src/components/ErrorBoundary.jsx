import { Component } from 'react';
import { Button, Card, Center, Code, Group, Stack, Text, Title } from '@mantine/core';
import { IconAlertTriangle, IconRefresh } from '@tabler/icons-react';

/**
 * The last line of defence. MVP.md §15.3.
 *
 * A render-time throw anywhere below this unmounts the whole React tree — without
 * a boundary that is a white page with nothing in it, which is the worst failure
 * mode we can ship. This catches it and offers a way out.
 *
 * A class component on purpose: `getDerivedStateFromError` and `componentDidCatch`
 * have no hook equivalent, and will not have one.
 *
 * Note what it does NOT catch: errors inside event handlers, async callbacks, or
 * rejected promises. Those are what `notify.apiError` is for.
 *
 * ## Two altitudes — PR 10.3
 *
 * `App.jsx` mounts one of these around the whole router, and that is right for a throw
 * in the shell. It is wrong for a throw in a screen: it unmounts the header, the
 * sidebar and the bottom nav, and leaves the user with no idea which part of the
 * product broke.
 *
 * So the shells mount a second one around their `Outlet`, with `variant="inline"` and a
 * `resetKey`. Both altitudes are this component; what differs is three props, and every
 * one of them is optional so `App.jsx`'s usage is byte-for-byte the behaviour it had
 * before this PR.
 *
 * | | outer (`App.jsx`) | inner (the shells) |
 * |---|---|---|
 * | fills | the viewport | the content area |
 * | way out | **Back to start** — a full load of `/` | **Try again** — re-render, no reload |
 * | on navigation | nothing to reset; the tree is gone | `resetKey` clears the error |
 *
 * **`resetKey` is what makes the inner one worth having.** Without it the nav is
 * rendered and every link in it is dead: the boundary keeps its stored error across the
 * navigation and re-renders the same card on the next route. The shells pass
 * `useLocation().pathname`.
 *
 * @param {React.ReactNode} children
 * @param {'page'|'inline'} [variant]  'page' is the default and is today's behaviour
 * @param {unknown} [resetKey]  when this changes, a stored error is cleared
 */
export default class ErrorBoundary extends Component {
  state = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error) {
    return { error };
  }

  /**
   * Clear on navigation.
   *
   * This runs before every render, including the one that follows
   * `getDerivedStateFromError` — so the comparison has to be against the *stored* key
   * rather than a previous prop, or a throw would clear itself on the spot and loop.
   * Returning `null` when the key is unchanged is what leaves a caught error standing.
   */
  static getDerivedStateFromProps(props, state) {
    if (props.resetKey === state.resetKey) return null;

    return { error: null, resetKey: props.resetKey };
  }

  componentDidCatch(error, info) {
    // Kept as console until a client-side error reporter exists. The component
    // stack is the part that actually locates the bug, so log it explicitly.
    console.error('Render error caught by ErrorBoundary:', error, info.componentStack);
  }

  /**
   * A full reload rather than clearing `error` in place: whatever state produced
   * the throw is still in memory, so re-rendering the same tree usually throws
   * again. Reloading from `/` gives the user a tree that is known to work.
   *
   * **The inline variant does the opposite**, deliberately. It is surrounded by a
   * working shell that is holding a session, a socket and an auth store, and throwing
   * all three away to re-render one screen is a cure worse than the failure. The user
   * also has ten other ways out — they are all in the nav, which is still on screen.
   */
  handleReset = () => {
    if (this.props.variant === 'inline') {
      this.setState({ error: null });

      return;
    }

    window.location.assign('/');
  };

  render() {
    const { error } = this.state;
    const inline = this.props.variant === 'inline';

    if (!error) return this.props.children;

    return (
      <Center mih={inline ? 240 : '100vh'} p="md">
        <Card withBorder padding="xl" maw={420} w="100%">
          <Stack gap="md" align="center">
            <IconAlertTriangle size={48} stroke={1.5} color="var(--mantine-color-red-6)" />

            <Stack gap={4} align="center">
              <Title order={3} ta="center">
                {inline ? 'This screen broke' : 'Something broke'}
              </Title>
              <Text c="dimmed" size="sm" ta="center">
                {inline
                  ? 'The rest of the app is fine — the navigation still works, and nothing you did is lost. Try this screen again, or go somewhere else and come back.'
                  : 'This screen hit an error it could not recover from. Nothing you did is lost — going back to the start usually fixes it.'}
              </Text>
            </Stack>

            {import.meta.env.DEV && (
              <Code block w="100%">
                {error.message}
              </Code>
            )}

            <Group justify="center">
              <Button leftSection={<IconRefresh size={16} />} onClick={this.handleReset}>
                {inline ? 'Try again' : 'Back to start'}
              </Button>
            </Group>
          </Stack>
        </Card>
      </Center>
    );
  }
}

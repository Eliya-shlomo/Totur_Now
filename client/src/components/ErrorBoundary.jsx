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
 */
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
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
   */
  handleReset = () => {
    window.location.assign('/');
  };

  render() {
    const { error } = this.state;

    if (!error) return this.props.children;

    return (
      <Center mih="100vh" p="md">
        <Card withBorder padding="xl" maw={420} w="100%">
          <Stack gap="md" align="center">
            <IconAlertTriangle size={48} stroke={1.5} color="var(--mantine-color-red-6)" />

            <Stack gap={4} align="center">
              <Title order={3} ta="center">
                Something broke
              </Title>
              <Text c="dimmed" size="sm" ta="center">
                This screen hit an error it could not recover from. Nothing you did is lost — going
                back to the start usually fixes it.
              </Text>
            </Stack>

            {import.meta.env.DEV && (
              <Code block w="100%">
                {error.message}
              </Code>
            )}

            <Group justify="center">
              <Button leftSection={<IconRefresh size={16} />} onClick={this.handleReset}>
                Back to start
              </Button>
            </Group>
          </Stack>
        </Card>
      </Center>
    );
  }
}

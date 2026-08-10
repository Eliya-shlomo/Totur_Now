import { Badge, Button, Code, Container, Stack, Text, Title } from '@mantine/core';
import { SHARED_PACKAGE_READY } from '@tutor/shared';

/**
 * Scaffold smoke screen. PR 0.5 replaces this file entirely with the router shell.
 *
 * It exists to prove three things at a glance, which is exactly PR 0.1's job:
 *   1. Mantine renders and its styles are loaded
 *   2. the `@/` alias resolves          (this file was imported as '@/App')
 *   3. the `@tutor/shared` workspace resolves
 */
export default function App() {
  return (
    <Container size="sm" py="xl">
      <Stack gap="md">
        <Title order={1}>TutorNow</Title>
        <Text c="dimmed">Scaffold only — PR 0.1. No routes, no API, no database yet.</Text>

        <Stack gap="xs">
          <Badge color="green">Mantine v7 rendering</Badge>
          <Badge color={SHARED_PACKAGE_READY ? 'green' : 'red'}>
            @tutor/shared resolved: {String(SHARED_PACKAGE_READY)}
          </Badge>
          <Badge color="green">
            <Code>@/</Code> alias resolved
          </Badge>
        </Stack>

        <Button onClick={() => alert('Toolchain is alive.')}>Click me</Button>
      </Stack>
    </Container>
  );
}

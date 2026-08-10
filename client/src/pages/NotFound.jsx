import { Button, Stack, Text, Title } from '@mantine/core';
import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <Stack align="center" gap="md" py="xl">
      <Title order={1}>404</Title>
      <Text c="dimmed" ta="center">
        That page does not exist.
      </Text>
      <Button component={Link} to="/">
        Back to the home page
      </Button>
    </Stack>
  );
}

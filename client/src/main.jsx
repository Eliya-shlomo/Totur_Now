import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { RouterProvider } from 'react-router-dom';

import { theme } from '@/theme';
import { router } from '@/router';

import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';

// PR 0.6 adds the ErrorBoundary around this tree and the axios instance behind it.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <Notifications position="top-right" />
      <RouterProvider router={router} />
    </MantineProvider>
  </React.StrictMode>,
);

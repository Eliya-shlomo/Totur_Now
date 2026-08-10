import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import App from '@/App';

import '@mantine/core/styles.css';

// PR 0.5 adds the project theme, the router, and the notifications provider.
// Everything here is the minimum needed to prove the toolchain works.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MantineProvider>
      <App />
    </MantineProvider>
  </React.StrictMode>,
);

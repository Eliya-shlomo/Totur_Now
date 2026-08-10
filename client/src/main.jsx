import React from 'react';
import ReactDOM from 'react-dom/client';

import App from '@/App';

import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';

// Mount only. The provider tree and the ErrorBoundary live in App.jsx.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

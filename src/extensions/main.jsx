import React from 'react';
import { createRoot } from 'react-dom/client';
import ExtensionsPage from './ExtensionsPage';

const container = document.getElementById('extensions-root');
createRoot(container).render(<ExtensionsPage />);

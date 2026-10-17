import React from 'react';
import { createRoot } from 'react-dom/client';
import DownloadsApp from './DownloadsApp';

const container = document.getElementById('downloads-root');
createRoot(container).render(<DownloadsApp />);

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@/app/globals.css';
import Home from '@/app/page';

const root = document.getElementById('root');
if (!root) throw new Error('找不到網站根節點。');

createRoot(root).render(
  <StrictMode>
    <Home />
  </StrictMode>,
);

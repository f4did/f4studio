import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './styles/index.css';
import { initPwa } from './engine/pwa';

initPwa();

const root = document.getElementById('root');
if (!root) throw new Error('Root element missing');
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

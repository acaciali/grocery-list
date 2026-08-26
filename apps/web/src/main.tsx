import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { connectEmulators } from '@grocery/shared';
import { startSparkleCursor } from '@grocery/shared/sparkle-cursor';
import App from './App';
import './index.css';

// Opt into the local emulator suite with VITE_USE_EMULATORS=true in apps/web/.env.local.
// Off by default so `npm run dev` matches what the vanilla app talks to.
if (import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectEmulators();
}

startSparkleCursor();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

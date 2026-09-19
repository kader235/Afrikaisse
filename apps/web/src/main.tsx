import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { I18nProvider } from './i18n.tsx';
// Police du personnel (design v3) : Outfit, latin et latin étendu (accents du français).
import '@fontsource/outfit/latin-400.css';
import '@fontsource/outfit/latin-500.css';
import '@fontsource/outfit/latin-600.css';
import '@fontsource/outfit/latin-700.css';
import '@fontsource/outfit/latin-800.css';
import '@fontsource/outfit/latin-ext-400.css';
import '@fontsource/outfit/latin-ext-500.css';
import '@fontsource/outfit/latin-ext-600.css';
import '@fontsource/outfit/latin-ext-700.css';
import '@fontsource/outfit/latin-ext-800.css';
// Plus Jakarta Sans : seulement pour l'aperçu du menu client (Thème du menu), fidèle à ce que voient les clients.
import '@fontsource/plus-jakarta-sans/latin-600.css';
import '@fontsource/plus-jakarta-sans/latin-800.css';
import '@fontsource/plus-jakarta-sans/latin-ext-600.css';
import '@fontsource/plus-jakarta-sans/latin-ext-800.css';
import './styles.css';
import './styles/client.css';
import './styles/tablette.css';
import './styles/tablette-doux.css';
import './styles/pc.css';
import './styles/v3.css';
import './styles/daily-menu.css';
import { enforceTouchLayout, markDevice } from './touch.ts';

markDevice();
enforceTouchLayout();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);

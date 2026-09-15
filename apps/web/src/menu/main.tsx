import { createRoot } from 'react-dom/client';
import { MenuApp } from './MenuApp.tsx';
import '@fontsource/plus-jakarta-sans/latin-400.css';
import '@fontsource/plus-jakarta-sans/latin-600.css';
import '@fontsource/plus-jakarta-sans/latin-700.css';
import '@fontsource/plus-jakarta-sans/latin-800.css';
import '@fontsource/plus-jakarta-sans/latin-ext-400.css';
import '@fontsource/plus-jakarta-sans/latin-ext-600.css';
import '@fontsource/plus-jakarta-sans/latin-ext-700.css';
import '@fontsource/plus-jakarta-sans/latin-ext-800.css';
import './menu.css';
import { restoreMenuTheme } from './theme.ts';

// Couleurs de l'établissement dès le premier affichage (thème gardé de la visite précédente).
restoreMenuTheme(/^\/m\/([A-Za-z0-9_-]+)/.exec(window.location.pathname)?.[1] ?? '');

// Point d'entrée séparé du logiciel de gestion : le client en 3G ne télécharge que le menu.
createRoot(document.getElementById('menu-root')!).render(<MenuApp />);

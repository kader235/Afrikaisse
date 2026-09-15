import { createRoot } from 'react-dom/client';
import { MenuApp } from './MenuApp.tsx';
import '@fontsource/roboto/latin-400.css';
import '@fontsource/roboto/latin-500.css';
import '@fontsource/roboto/latin-700.css';
import '@fontsource/roboto/latin-ext-400.css';
import '@fontsource/roboto/latin-ext-500.css';
import '@fontsource/roboto/latin-ext-700.css';
import './menu.css';

// Point d'entrée séparé du logiciel de gestion : le client en 3G ne télécharge que le menu.
createRoot(document.getElementById('menu-root')!).render(<MenuApp />);

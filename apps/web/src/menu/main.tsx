import { createRoot } from 'react-dom/client';
import { MenuApp } from './MenuApp.tsx';
import './menu.css';
import './menu-extra.css';

// Point d'entrée séparé du logiciel de gestion : le client en 3G ne télécharge que le menu.
createRoot(document.getElementById('menu-root')!).render(<MenuApp />);

import { useState, type CSSProperties } from 'react';
import { MENU_THEME_LIST, menuPaletteVars, type LocationDetails, type MenuTheme } from '@afrikaisse/core';
import { mdiMagnify, mdiPlus } from '@mdi/js';
import { api } from '../api.ts';
import { ErrorMessage, OkMessage } from '../ui.tsx';
import '../styles/menu-theme.css';

/**
 * Thème du menu client (onglet du Menu) : chaque établissement choisit l'apparence du menu que ses
 * clients ouvrent par le QR code. Chaque carte montre un vrai petit menu dessiné avec les couleurs
 * du thème ; le choix s'enregistre tout de suite et s'applique au prochain chargement des téléphones.
 */

function Svg({ path, size = 14 }: { path: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <path d={path} fill="currentColor" />
    </svg>
  );
}

/** Téléphone miniature : en-tête, bandeau, catégories, un plat, barre du panier. */
export function MenuThemePreview({ theme, restaurant }: { theme: MenuTheme; restaurant: string }) {
  const style = menuPaletteVars(theme.light) as CSSProperties;
  return (
    <div className="mt-phone" style={style} aria-hidden="true">
      <div className="mt-top">
        <span className="mt-logo">{restaurant.slice(0, 1).toUpperCase()}</span>
        <span className="mt-brand">
          <small>Table 4</small>
          <strong>{restaurant}</strong>
        </span>
        <span className="mt-round">
          <Svg path={mdiMagnify} size={12} />
        </span>
      </div>
      <div className="mt-banner">
        <strong>Grillades du soir</strong>
        <span className="mt-banner-body">Braisées au feu de bois</span>
        <span className="mt-cta">Voir</span>
        <img src="/catalogue/images/poulet-braise.webp" alt="" />
      </div>
      <div className="mt-cats">
        <span className="on">Grillades</span>
        <span>Boissons</span>
        <span>Desserts</span>
      </div>
      <div className="mt-item">
        <img src="/catalogue/images/poisson-braise-baton.webp" alt="" />
        <span className="mt-item-text">
          <strong>Poisson braisé</strong>
          <small>Attiéké, piment frais</small>
          <b>5 500 FCFA</b>
        </span>
        <span className="mt-plus">
          <Svg path={mdiPlus} size={14} />
        </span>
      </div>
      <div className="mt-item">
        <img src="/catalogue/images/poulet-braise.webp" alt="" />
        <span className="mt-item-text">
          <strong>Poulet braisé</strong>
          <small>Demi-poulet, alloco</small>
          <b>4 500 FCFA</b>
        </span>
        <span className="mt-plus">
          <Svg path={mdiPlus} size={14} />
        </span>
      </div>
      <div className="mt-bar">
        <span>
          <i>2</i>Voir le panier
        </span>
        <strong>10 000 FCFA</strong>
      </div>
    </div>
  );
}

export function MenuThemeTab({ location, canManage, onSaved }: { location: LocationDetails; canManage: boolean; onSaved: (location: LocationDetails) => void }) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function choose(theme: MenuTheme) {
    setSaving(theme.id);
    setError(null);
    setNotice(null);
    try {
      onSaved(await api<LocationDetails>('PATCH', `/locations/${location.id}`, { menuTheme: theme.id }));
      setNotice(`Thème « ${theme.label} » enregistré : vos clients le voient dès qu’ils ouvrent ou rechargent le menu.`);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="mt">
      <div className="mt-head">
        <p>
          Choisissez l’apparence du menu que vos clients ouvrent en scannant le QR code de leur table. Les plats, les prix et les annonces ne changent pas.
          {!canManage && ' Seul le propriétaire ou un administrateur peut changer le thème.'}
        </p>
      </div>
      {(!!error || notice) && (
        <div className="mt-messages">
          <ErrorMessage error={error} />
          {notice && !error && <OkMessage>{notice}</OkMessage>}
        </div>
      )}
      <div className="mt-grid">
        {MENU_THEME_LIST.map((theme) => {
          const current = theme.id === location.menuTheme;
          return (
            <div key={theme.id} className={current ? 'mt-card current' : 'mt-card'}>
              <div className="mt-stage">
                <MenuThemePreview theme={theme} restaurant={location.name} />
              </div>
              <div className="mt-info">
                <div className="mt-name">
                  <span className="mt-swatch" style={{ background: theme.light.accent }} />
                  <strong>{theme.label}</strong>
                  {current && <span className="mt-current">Thème actuel</span>}
                </div>
                <p>{theme.description}</p>
                <small>{theme.light.dark ? 'Toujours sombre.' : 'Passe en sombre si le téléphone du client est en mode sombre.'}</small>
                {canManage && (
                  <button className={current ? 'btn' : 'btn btn-primary'} disabled={current || saving !== null} onClick={() => void choose(theme)}>
                    {current ? 'Thème choisi' : saving === theme.id ? 'Enregistrement…' : 'Choisir ce thème'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { MENU_THEME_LIST, SLOGAN_MAX, menuPaletteVars, menuTheme, type LocationDetails, type MenuTheme } from '@afrikaisse/core';
import { mdiMagnify, mdiPlus } from '@mdi/js';
import { api } from '../api.ts';
import { sloganSize, sloganText } from '../menu/slogan.ts';
import { ErrorMessage, OkMessage } from '../ui.tsx';
import '../styles/menu-theme.css';

/**
 * Thème du menu client (onglet du Menu) : chaque établissement choisit l'apparence du menu que ses
 * clients ouvrent par le QR code, et son slogan (grand titre de l'accueil du menu). Chaque carte montre
 * un vrai petit menu dessiné avec les couleurs du thème ; le choix s'enregistre tout de suite et
 * s'applique au prochain chargement des téléphones.
 */

function Svg({ path, size = 14 }: { path: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <path d={path} fill="currentColor" />
    </svg>
  );
}

/** Slogan tel que le serveur l'enregistrera : une ligne, espaces resserrés ; vide → null. */
const cleanSlogan = (value: string) => value.replace(/\s+/g, ' ').trim() || null;

/** Titre de l'accueil du menu : le slogan, ou la phrase d'accueil du menu client quand il n'y en a pas. */
function MenuTitle({ slogan, className }: { slogan: string | null; className: string }) {
  if (slogan) return <div className={`${className} ${sloganSize(slogan)}`}>{sloganText(slogan)}</div>;
  return (
    <div className={className}>
      Qu’est-ce qui vous fait <em>envie</em> aujourd’hui ?
    </div>
  );
}

/** Téléphone miniature : en-tête, titre (slogan), bandeau, catégories, un plat, barre du panier. */
export function MenuThemePreview({ theme, restaurant, slogan = null }: { theme: MenuTheme; restaurant: string; slogan?: string | null }) {
  const style = menuPaletteVars(theme.light) as CSSProperties;
  const size = slogan ? sloganSize(slogan) : 'lg';
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
      <MenuTitle slogan={slogan} className={`mt-title mt-title-${size}`} />
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

/** Carte « Slogan du menu » : saisie, compteur, aperçu de l'en-tête du menu aux couleurs du thème actuel. */
function SloganCard({
  location,
  draft,
  onDraft,
  canManage,
  onSaved,
}: {
  location: LocationDetails;
  draft: string;
  onDraft: (value: string) => void;
  canManage: boolean;
  onSaved: (location: LocationDetails) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const next = cleanSlogan(draft);
  const changed = next !== (location.slogan ?? null);
  const style = menuPaletteVars(menuTheme(location.menuTheme).light) as CSSProperties;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await api<LocationDetails>('PATCH', `/locations/${location.id}`, { slogan: next });
      onSaved(saved);
      onDraft(saved.slogan ?? '');
      setNotice(saved.slogan ? 'Slogan enregistré : vos clients le voient dès qu’ils ouvrent ou rechargent le menu.' : 'Slogan retiré : le menu affiche de nouveau la phrase d’accueil.');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-slogan">
      <form className="mt-slogan-form" onSubmit={save}>
        <h3>Slogan du menu</h3>
        <p>
          Il remplace « Qu’est-ce qui vous fait envie aujourd’hui ? » en grand titre du menu client. Laissez vide pour garder cette phrase.
          {!canManage && ' Seul le propriétaire ou un administrateur peut le modifier.'}
        </p>
        <label htmlFor="mt-slogan-input">Slogan</label>
        <div className="mt-slogan-field">
          <input
            id="mt-slogan-input"
            maxLength={SLOGAN_MAX}
            placeholder="Le goût du feu de bois"
            value={draft}
            readOnly={!canManage}
            disabled={!canManage}
            onChange={(e) => {
              onDraft(e.target.value);
              setNotice(null);
            }}
            aria-describedby="mt-slogan-count"
          />
          <span id="mt-slogan-count" className={draft.length >= SLOGAN_MAX ? 'mt-slogan-count full' : 'mt-slogan-count'}>
            {draft.length} / {SLOGAN_MAX}
          </span>
        </div>
        {(!!error || notice) && (
          <div className="mt-messages">
            <ErrorMessage error={error} />
            {notice && !error && <OkMessage>{notice}</OkMessage>}
          </div>
        )}
        {canManage && (
          <div className="mt-slogan-actions">
            <button className="btn btn-primary" disabled={busy || !changed}>
              {busy ? 'Enregistrement…' : next ? 'Enregistrer le slogan' : location.slogan ? 'Retirer le slogan' : 'Enregistrer le slogan'}
            </button>
            {changed && (
              <button type="button" className="btn" disabled={busy} onClick={() => onDraft(location.slogan ?? '')}>
                Annuler
              </button>
            )}
          </div>
        )}
      </form>
      <div className="mt-slogan-stage">
        <div className="mt-header" style={style} aria-label="Aperçu de l’en-tête du menu client">
          <div className="mt-header-brand">
            <span className="mt-logo">{location.name.slice(0, 1).toUpperCase()}</span>
            <span>
              <small>Bienvenue chez</small>
              <strong>{location.name}</strong>
            </span>
          </div>
          <MenuTitle slogan={next} className="mt-header-title" />
        </div>
      </div>
    </section>
  );
}

export function MenuThemeTab({ location, canManage, onSaved }: { location: LocationDetails; canManage: boolean; onSaved: (location: LocationDetails) => void }) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState(location.slogan ?? '');

  // Autre établissement choisi : le brouillon repart de son slogan.
  const locationId = location.id;
  const savedSlogan = location.slogan;
  useEffect(() => setDraft(savedSlogan ?? ''), [locationId]);

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

  const previewSlogan = cleanSlogan(draft);

  return (
    <div className="mt">
      <SloganCard location={location} draft={draft} onDraft={setDraft} canManage={canManage} onSaved={onSaved} />
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
                <MenuThemePreview theme={theme} restaurant={location.name} slogan={previewSlogan} />
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

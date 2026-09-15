import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  mdiAccount,
  mdiAccountGroup,
  mdiAlert,
  mdiArchive,
  mdiArrowDown,
  mdiArrowLeft,
  mdiArrowRight,
  mdiArrowUp,
  mdiBackspace,
  mdiBell,
  mdiBookOpenVariant,
  mdiCalendar,
  mdiCashRegister,
  mdiChartBar,
  mdiCheck,
  mdiCheckCircle,
  mdiChefHat,
  mdiChevronDown,
  mdiChevronRight,
  mdiClipboardTextClock,
  mdiClockOutline,
  mdiClose,
  mdiCog,
  mdiContentSave,
  mdiCursorMove,
  mdiDelete,
  mdiDotsHorizontal,
  mdiDownload,
  mdiEye,
  mdiFilePdfBox,
  mdiFloorPlan,
  mdiHelpCircle,
  mdiImage,
  mdiInformation,
  mdiKey,
  mdiLogout,
  mdiMagnify,
  mdiMenu,
  mdiMicrosoftExcel,
  mdiMonitorDashboard,
  mdiOfficeBuilding,
  mdiPackageVariantClosed,
  mdiPencil,
  mdiPercent,
  mdiMinus,
  mdiPlus,
  mdiSend,
  mdiPower,
  mdiPrinter,
  mdiQrcode,
  mdiReceiptText,
  mdiRefresh,
  mdiRotateRight,
  mdiServer,
  mdiShieldAccount,
  mdiSilverwareForkKnife,
  mdiStore,
  mdiSync,
  mdiTableFurniture,
  mdiTagMultiple,
  mdiUpload,
  mdiViewDashboard,
} from '@mdi/js';
import { moneyToInput, parseMoney, type CurrencyCode } from '@afrikaisse/core';
import { ApiError, UserFacingError } from './api.ts';
import { LANGUAGES, useI18n, type Language } from './i18n.tsx';

export const APP_VERSION = '0.1.0';

export function BrandMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="4" fill="#ffffff" />
      <path d="M9 6h14v20l-2.33-1.75L18.33 26 16 24.25 13.67 26l-2.34-1.75L9 26z" fill="#1d4d82" />
      <path d="M12.5 12h7M12.5 16h4.5" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function Brand() {
  return (
    <div className="brand">
      <BrandMark />
      AfriKaisse
    </div>
  );
}

/**
 * Pictogrammes : Material Design Icons (Pictogrammers, licence Apache 2.0), la famille livrée avec WEBDEV.
 * Pleins, une couleur (currentColor), grille 24 ; importés un par un, donc seuls ceux-ci entrent dans le paquet.
 */
const ICONS = {
  add: mdiPlus,
  minus: mdiMinus,
  send: mdiSend,
  edit: mdiPencil,
  key: mdiKey,
  power: mdiPower,
  refresh: mdiRefresh,
  more: mdiDotsHorizontal,
  building: mdiOfficeBuilding,
  team: mdiAccountGroup,
  journal: mdiClipboardTextClock,
  user: mdiAccount,
  server: mdiServer,
  logout: mdiLogout,
  store: mdiStore,
  layout: mdiFloorPlan,
  archive: mdiArchive,
  move: mdiCursorMove,
  rotate: mdiRotateRight,
  save: mdiContentSave,
  up: mdiArrowUp,
  down: mdiArrowDown,
  left: mdiArrowLeft,
  right: mdiArrowRight,
  menu: mdiBookOpenVariant,
  dashboard: mdiViewDashboard,
  chevronRight: mdiChevronRight,
  image: mdiImage,
  print: mdiPrinter,
  qr: mdiQrcode,
  cash: mdiCashRegister,
  kitchen: mdiChefHat,
  chart: mdiChartBar,
  start: mdiCheck,
  box: mdiPackageVariantClosed,
  ticket: mdiReceiptText,
  table: mdiTableFurniture,
  gear: mdiCog,
  bell: mdiBell,
  list: mdiMenu,
  close: mdiClose,
  trash: mdiDelete,
  search: mdiMagnify,
  backspace: mdiBackspace,
  chevron: mdiChevronDown,
  help: mdiHelpCircle,
  monitor: mdiMonitorDashboard,
  tags: mdiTagMultiple,
  percent: mdiPercent,
  alert: mdiAlert,
  info: mdiInformation,
  ok: mdiCheckCircle,
  sync: mdiSync,
  calendar: mdiCalendar,
  clock: mdiClockOutline,
  cutlery: mdiSilverwareForkKnife,
  eye: mdiEye,
  download: mdiDownload,
  upload: mdiUpload,
  pdf: mdiFilePdfBox,
  excel: mdiMicrosoftExcel,
  shield: mdiShieldAccount,
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

export function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof ApiError || error instanceof UserFacingError ? error.message : 'Une erreur inattendue est survenue.';
  const lines = error instanceof ApiError ? detailLines(error.details) : [];
  return (
    <div className="msg msg-error" role="alert">
      <strong>Erreur :</strong> {message}
      {lines.length > 0 && (
        <ul>
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Détails lisibles : champs invalides, tables en conflit sur le plan… */
function detailLines(details: unknown): string[] {
  if (Array.isArray(details)) {
    return (details as { path: string; message: string }[]).map((d) => `${d.path.replace(/^\//, '') || 'formulaire'} : ${d.message}`);
  }
  if (!details || typeof details !== 'object') return [];
  const d = details as { tables?: string[]; products?: string[]; overlaps?: [string, string][]; outOfBounds?: string[] };
  return [
    ...(d.tables?.length ? [`Tables concernées : ${d.tables.join(', ')}`] : []),
    ...(d.products?.length ? [`Produits concernés : ${d.products.join(', ')}`] : []),
    ...(d.overlaps ?? []).map(([a, b]) => `${a} et ${b} se chevauchent`),
    ...(d.outOfBounds ?? []).map((label) => `${label} sort du plan`),
  ];
}

export function OkMessage({ children }: { children: ReactNode }) {
  return (
    <div className="msg msg-ok" role="status">
      {children}
    </div>
  );
}

/**
 * Montant saisi en unités courantes (« 5500 », « 12,50 »), transmis en unités mineures.
 * Une saisie illisible bloque l'envoi du formulaire avec le message natif du navigateur.
 */
export function MoneyInput({
  id,
  value,
  currency,
  onChange,
  required,
  allowEmpty,
  signed,
}: {
  id?: string;
  value: number | null;
  currency: CurrencyCode;
  onChange: (value: number | null) => void;
  required?: boolean;
  allowEmpty?: boolean;
  signed?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(value === null ? '' : moneyToInput(value, currency));
  const [invalid, setInvalid] = useState(false);

  function change(next: string) {
    setText(next);
    const trimmed = next.trim();
    let parsed: number | null = null;
    let ok = true;
    if (!trimmed) {
      ok = Boolean(allowEmpty);
    } else {
      const negative = signed && trimmed.startsWith('-');
      const amount = parseMoney(negative ? trimmed.slice(1) : trimmed, currency);
      ok = amount !== null;
      parsed = amount === null ? null : negative ? -amount : amount;
    }
    setInvalid(!ok);
    ref.current?.setCustomValidity(ok ? '' : 'Montant invalide');
    if (ok) onChange(parsed);
  }

  return (
    <input
      ref={ref}
      id={id}
      inputMode="decimal"
      autoComplete="off"
      required={required}
      aria-invalid={invalid}
      value={text}
      onChange={(e) => change(e.target.value)}
    />
  );
}

/**
 * Page de travail, même structure partout : en-tête (titre et informations à gauche, actions à droite),
 * puis une seule carte. `plain` : pas de carte englobante, le contenu pose ses propres cartes.
 */
export function Window({
  title,
  count,
  toolbar,
  children,
  bodyless,
  plain,
  className,
}: {
  title: string;
  count?: string;
  toolbar?: ReactNode;
  children: ReactNode;
  bodyless?: boolean;
  plain?: boolean;
  className?: string;
}) {
  return (
    <section className={className ? `page ${className}` : 'page'}>
      <header className="page-head">
        <div className="page-title">
          <h1>{title}</h1>
          {count && <p className="page-meta">{count}</p>}
        </div>
        {toolbar && <div className="page-actions">{toolbar}</div>}
      </header>
      {plain ? children : <div className="page-card">{bodyless ? children : <div className="window-body">{children}</div>}</div>}
    </section>
  );
}

/** Fenêtre de saisie modale. Échap ferme. */
export function Dialog({ title, onClose, children, footer, wide }: { title: string; onClose?: () => void; children: ReactNode; footer: ReactNode; wide?: boolean }) {
  const { t } = useI18n();
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" role="presentation">
      <div className={wide ? 'dialog dialog-wide' : 'dialog'} role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-title">
          <span>{title}</span>
          {onClose && (
            <button type="button" aria-label={t('common.close')} onClick={onClose}>
              <Icon name="close" />
            </button>
          )}
        </div>
        {children}
        <div className="dialog-foot">{footer}</div>
      </div>
    </div>
  );
}

type Theme = 'light' | 'dark' | 'system';

function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

let currentTheme: Theme = (() => {
  try {
    return (localStorage.getItem('afk.theme') as Theme) || 'system';
  } catch {
    return 'system';
  }
})();

export function usePreferences() {
  const [theme, setThemeState] = useState<Theme>(currentTheme);
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);
  const setTheme = (next: Theme) => {
    currentTheme = next;
    setThemeState(next);
    try {
      localStorage.setItem('afk.theme', next);
    } catch {
      /* préférence pour la session seulement */
    }
  };
  return { theme, setTheme };
}

export function Preferences() {
  const { t, lang, setLang } = useI18n();
  const { theme, setTheme } = usePreferences();
  return (
    <span>
      <select aria-label={t('shell.language')} value={lang} onChange={(e) => setLang(e.target.value as Language)}>
        {Object.entries(LANGUAGES).map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </select>
      <select aria-label={t('shell.theme')} value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
        <option value="system">{t('theme.system')}</option>
        <option value="light">{t('theme.light')}</option>
        <option value="dark">{t('theme.dark')}</option>
      </select>
    </span>
  );
}

/** Message flottant en bas de l’écran : rien ne s’insère au-dessus d’une zone manipulée au doigt. Une réussite s’efface seule. */
export function FloatMessage({ error, notice, onClose }: { error: unknown; notice: string | null; onClose: () => void }) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!notice || error) return;
    const id = setTimeout(() => close.current(), 4000);
    return () => clearTimeout(id);
  }, [notice, error]);
  if (!error && !notice) return null;
  return createPortal(
    <div className={error ? 'float-msg float-error' : 'float-msg'} role={error ? 'alert' : 'status'}>
      {error ? <ErrorMessage error={error} /> : <OkMessage>{notice}</OkMessage>}
      <button type="button" className="float-msg-close" aria-label="Fermer" onClick={() => close.current()}>
        <Icon name="close" />
      </button>
    </div>,
    document.body,
  );
}

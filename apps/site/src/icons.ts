import {
  mdiAccountGroup,
  mdiArrowRight,
  mdiBookOpenVariant,
  mdiCashMultiple,
  mdiCashRegister,
  mdiChartBar,
  mdiCheck,
  mdiChefHat,
  mdiChevronDown,
  mdiChevronRight,
  mdiClipboardTextClock,
  mdiCurrencyUsd,
  mdiEmail,
  mdiFloorPlan,
  mdiLogin,
  mdiMenu,
  mdiPackageVariantClosed,
  mdiPhone,
  mdiPlus,
  mdiPrinter,
  mdiQrcode,
  mdiStore,
  mdiTablet,
  mdiTranslate,
  mdiWhatsapp,
  mdiWifiOff,
} from '@mdi/js';

/** Pictogrammes Material Design Icons (famille livrée avec WEBDEV), pleins, grille 24, écrits dans la page. */
const ICONS = {
  caisse: mdiCashRegister,
  commandes: mdiClipboardTextClock,
  tables: mdiFloorPlan,
  qr: mdiQrcode,
  cuisine: mdiChefHat,
  carte: mdiBookOpenVariant,
  stock: mdiPackageVariantClosed,
  impression: mdiPrinter,
  pilotage: mdiChartBar,
  equipe: mdiAccountGroup,
  horsLigne: mdiWifiOff,
  tablette: mdiTablet,
  etablissements: mdiStore,
  langues: mdiTranslate,
  paiements: mdiCashMultiple,
  devises: mdiCurrencyUsd,
  check: mdiCheck,
  chevronRight: mdiChevronRight,
  chevronDown: mdiChevronDown,
  arrowRight: mdiArrowRight,
  menu: mdiMenu,
  email: mdiEmail,
  phone: mdiPhone,
  whatsapp: mdiWhatsapp,
  login: mdiLogin,
  plus: mdiPlus,
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, className = 'ico'): string {
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${ICONS[name]}"/></svg>`;
}

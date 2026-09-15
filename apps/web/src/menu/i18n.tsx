import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Allergen } from '@afrikaisse/core';

/**
 * Langues du menu client (§45) : français (référence), anglais, arabe (RTL, chiffres latins).
 * Dictionnaire propre au menu : le bundle du client n'embarque ni Zod ni les textes du logiciel.
 * Le nom des plats reste celui saisi par le restaurant.
 */

export const LANGS = ['fr', 'en', 'ar'] as const;
export type Lang = (typeof LANGS)[number];
export const LANG_NAMES: Record<Lang, string> = { fr: 'Français', en: 'English', ar: 'العربية' };

const fr = {
  loading: 'Chargement du menu…',
  retry: 'Réessayer',
  badLink: 'Adresse de menu incomplète. Scannez à nouveau le QR code de votre table.',
  table: 'Table {label}',
  language: 'Langue',
  callWaiter: 'Appeler un serveur',
  myTable: 'Ma table',
  pay: 'Payer',
  search: 'Rechercher un plat, une boisson…',
  popular: 'Populaires',
  favorites: 'Favoris',
  favoriteAdd: 'Ajouter aux favoris',
  favoriteRemove: 'Retirer des favoris',
  noResult: 'Aucun résultat pour cette recherche.',
  emptyMenu: "Le menu n'est pas encore disponible.",
  soldOut: 'Épuisé',
  soldOutNow: 'Épuisé pour le moment',
  footer: 'Menu AfriKaisse',
  cartOne: 'Voir le panier · 1 article',
  cartMany: 'Voir le panier · {n} articles',
  track: 'Suivre',
  myOrders: 'Mes commandes',
  orderNo: 'Commande n°{n}',
  added: 'Ajouté au panier',
  waiterCalled: 'Un serveur a été prévenu.',
  offline: 'Hors connexion : le menu reste consultable.',
  orderingOffline: 'Commande indisponible hors connexion, appelez un serveur.',
  orderingPaused: 'Commande en ligne momentanément indisponible, appelez un serveur.',
  close: 'Fermer',
  less: 'Moins',
  more: 'Plus',
  add: 'Ajouter · {price}',
  version: 'Version',
  required: 'obligatoire',
  unavailable: 'épuisé',
  allergens: 'Allergènes :',
  kitchenNote: 'Une précision pour la cuisine ?',
  kitchenNotePh: 'Sans oignons, bien chaud…',
  cart: 'Panier',
  yourCart: 'Votre panier',
  removedItem: 'Article retiré',
  removeFlagged: 'Retirez les articles signalés pour commander.',
  sending: 'Envoi…',
  order: 'Commander · {price}',
  subtotal: 'Sous-total',
  promoCode: 'Code promo',
  promoCodeNamed: 'Code {code}',
  promoApply: 'Appliquer',
  promoRemove: 'Retirer',
  exclTax: 'HT',
  orderFine: 'Votre commande est envoyée au restaurant, qui la confirme.',
  restaurantNote: 'Un mot pour le restaurant ?',
  restaurantNotePh: 'Nous sommes pressés, anniversaire…',
  nickname: 'Votre prénom (facultatif)',
  tableCode: 'Code de table',
  tableCodeHint: 'Code à 4 chiffres donné par le serveur.',
  tableNotOpen: "La table n'est pas encore ouverte. Demandez le code au serveur.",
  join: 'Rejoindre la table',
  save: 'Enregistrer',
  atTable: 'À la table',
  you: 'vous',
  client: 'Client {n}',
  noOrders: 'Aucune commande pour le moment.',
  tableTotal: 'Total de la table',
  myShare: 'Ma part',
  alreadyPaid: 'Déjà payé',
  remaining: 'Reste à payer',
  payTitle: "Demander l'addition",
  payHow: 'Comment souhaitez-vous payer ?',
  payWhat: 'Addition',
  payMine: 'Ma part',
  payTable: 'Toute la table',
  CASH: 'Espèces',
  MOBILE_MONEY: 'Mobile Money',
  CARD: 'Carte',
  requestBill: "Demander l'addition",
  updateBill: 'Changer le moyen de paiement',
  billPending: 'Addition demandée ({method}) : le serveur arrive.',
  billPendingTable: 'Addition de la table demandée : le serveur arrive.',
  payAtTable: 'Le paiement se fait auprès du serveur.',
  nothingToPay: 'Rien à payer pour le moment.',
  errNetwork: 'Connexion impossible. Vérifiez votre connexion Internet puis réessayez.',
  errServer: 'Le restaurant ne répond pas pour le moment.',
  errCodeRequired: 'Saisissez le code de la table, donné par le serveur.',
  errCodeInvalid: 'Code de table incorrect. Demandez-le au serveur.',
  errCodeLocked: 'Trop de codes erronés pour cette table. Adressez-vous à un serveur.',
  'status.PENDING': 'Envoyée — en attente de confirmation',
  'status.CONFIRMED': 'Confirmée par le restaurant',
  'status.PREPARING': 'En préparation',
  'status.READY': 'Prête — elle arrive',
  'status.SERVED': 'Servie',
  'status.COMPLETED': 'Terminée',
  'status.CANCELLED': 'Annulée par le restaurant',
  'step.0': 'Envoyée',
  'step.1': 'Confirmée',
  'step.2': 'En cuisine',
  'step.3': 'Prête',
  'step.4': 'Servie',
  choiceOptionalOne: 'facultatif, 1 choix',
  choiceOptionalMax: "facultatif, jusqu'à {n} choix",
  choiceRequiredOne: '1 choix obligatoire',
  choiceRequiredN: '{n} choix obligatoires',
  choiceRange: '{min} à {max} choix',
};
export type MenuKey = keyof typeof fr;

const en: Record<MenuKey, string> = {
  loading: 'Loading the menu…',
  retry: 'Try again',
  badLink: 'Incomplete menu link. Scan your table QR code again.',
  table: 'Table {label}',
  language: 'Language',
  callWaiter: 'Call a waiter',
  myTable: 'My table',
  pay: 'Pay',
  search: 'Search a dish, a drink…',
  popular: 'Popular',
  favorites: 'Favourites',
  favoriteAdd: 'Add to favourites',
  favoriteRemove: 'Remove from favourites',
  noResult: 'No results for this search.',
  emptyMenu: 'The menu is not available yet.',
  soldOut: 'Sold out',
  soldOutNow: 'Sold out for now',
  footer: 'AfriKaisse menu',
  cartOne: 'View cart · 1 item',
  cartMany: 'View cart · {n} items',
  track: 'Track',
  myOrders: 'My orders',
  orderNo: 'Order #{n}',
  added: 'Added to cart',
  waiterCalled: 'A waiter has been notified.',
  offline: 'Offline: you can still browse the menu.',
  orderingOffline: 'Ordering unavailable offline, please call a waiter.',
  orderingPaused: 'Online ordering is temporarily unavailable, please call a waiter.',
  close: 'Close',
  less: 'Less',
  more: 'More',
  add: 'Add · {price}',
  version: 'Size',
  required: 'required',
  unavailable: 'sold out',
  allergens: 'Allergens:',
  kitchenNote: 'Anything for the kitchen?',
  kitchenNotePh: 'No onions, very hot…',
  cart: 'Cart',
  yourCart: 'Your cart',
  removedItem: 'Item removed',
  removeFlagged: 'Remove the flagged items to order.',
  sending: 'Sending…',
  order: 'Order · {price}',
  subtotal: 'Subtotal',
  promoCode: 'Promo code',
  promoCodeNamed: 'Code {code}',
  promoApply: 'Apply',
  promoRemove: 'Remove',
  exclTax: 'excl. tax',
  orderFine: 'Your order is sent to the restaurant, which confirms it.',
  restaurantNote: 'A note for the restaurant?',
  restaurantNotePh: 'In a hurry, birthday…',
  nickname: 'Your first name (optional)',
  tableCode: 'Table code',
  tableCodeHint: '4-digit code given by the waiter.',
  tableNotOpen: 'The table is not open yet. Ask the waiter for the code.',
  join: 'Join the table',
  save: 'Save',
  atTable: 'At the table',
  you: 'you',
  client: 'Guest {n}',
  noOrders: 'No orders yet.',
  tableTotal: 'Table total',
  myShare: 'My share',
  alreadyPaid: 'Already paid',
  remaining: 'Left to pay',
  payTitle: 'Ask for the bill',
  payHow: 'How would you like to pay?',
  payWhat: 'Bill',
  payMine: 'My share',
  payTable: 'Whole table',
  CASH: 'Cash',
  MOBILE_MONEY: 'Mobile Money',
  CARD: 'Card',
  requestBill: 'Ask for the bill',
  updateBill: 'Change payment method',
  billPending: 'Bill requested ({method}): the waiter is coming.',
  billPendingTable: 'Table bill requested: the waiter is coming.',
  payAtTable: 'You pay the waiter.',
  nothingToPay: 'Nothing to pay yet.',
  errNetwork: 'Cannot connect. Check your Internet connection and try again.',
  errServer: 'The restaurant is not responding right now.',
  errCodeRequired: 'Enter the table code given by the waiter.',
  errCodeInvalid: 'Wrong table code. Ask the waiter.',
  errCodeLocked: 'Too many wrong codes for this table. Please ask a waiter.',
  'status.PENDING': 'Sent — waiting for confirmation',
  'status.CONFIRMED': 'Confirmed by the restaurant',
  'status.PREPARING': 'Being prepared',
  'status.READY': 'Ready — on its way',
  'status.SERVED': 'Served',
  'status.COMPLETED': 'Completed',
  'status.CANCELLED': 'Cancelled by the restaurant',
  'step.0': 'Sent',
  'step.1': 'Confirmed',
  'step.2': 'Kitchen',
  'step.3': 'Ready',
  'step.4': 'Served',
  choiceOptionalOne: 'optional, 1 choice',
  choiceOptionalMax: 'optional, up to {n} choices',
  choiceRequiredOne: '1 required choice',
  choiceRequiredN: '{n} required choices',
  choiceRange: '{min} to {max} choices',
};

const ar: Record<MenuKey, string> = {
  loading: 'جارٍ تحميل القائمة…',
  retry: 'إعادة المحاولة',
  badLink: 'رابط القائمة غير مكتمل. امسح رمز QR الخاص بطاولتك مرة أخرى.',
  table: 'طاولة {label}',
  language: 'اللغة',
  callWaiter: 'نداء النادل',
  myTable: 'طاولتي',
  pay: 'الدفع',
  search: 'ابحث عن طبق أو مشروب…',
  popular: 'الأكثر طلبًا',
  favorites: 'المفضلة',
  favoriteAdd: 'إضافة إلى المفضلة',
  favoriteRemove: 'إزالة من المفضلة',
  noResult: 'لا توجد نتائج لهذا البحث.',
  emptyMenu: 'القائمة غير متاحة بعد.',
  soldOut: 'نفد',
  soldOutNow: 'نفد حاليًا',
  footer: 'قائمة AfriKaisse',
  cartOne: 'عرض السلة · صنف واحد',
  cartMany: 'عرض السلة · {n} أصناف',
  track: 'متابعة',
  myOrders: 'طلباتي',
  orderNo: 'الطلب رقم {n}',
  added: 'أضيف إلى السلة',
  waiterCalled: 'تم إبلاغ النادل.',
  offline: 'غير متصل: يمكنك تصفح القائمة.',
  orderingOffline: 'الطلب غير متاح دون اتصال، يرجى نداء النادل.',
  orderingPaused: 'الطلب عبر الإنترنت غير متاح مؤقتًا، يرجى نداء النادل.',
  close: 'إغلاق',
  less: 'أقل',
  more: 'أكثر',
  add: 'إضافة · {price}',
  version: 'الحجم',
  required: 'إلزامي',
  unavailable: 'نفد',
  allergens: 'مسببات الحساسية:',
  kitchenNote: 'ملاحظة للمطبخ؟',
  kitchenNotePh: 'بدون بصل، ساخن جدًا…',
  cart: 'السلة',
  yourCart: 'سلتك',
  removedItem: 'صنف محذوف',
  removeFlagged: 'احذف الأصناف المشار إليها لإتمام الطلب.',
  sending: 'جارٍ الإرسال…',
  order: 'اطلب · {price}',
  subtotal: 'المجموع الفرعي',
  promoCode: 'رمز الترويج',
  promoCodeNamed: 'الرمز {code}',
  promoApply: 'تطبيق',
  promoRemove: 'إزالة',
  exclTax: 'دون ضريبة',
  orderFine: 'يُرسل طلبك إلى المطعم الذي يؤكده.',
  restaurantNote: 'كلمة للمطعم؟',
  restaurantNotePh: 'مستعجلون، عيد ميلاد…',
  nickname: 'اسمك (اختياري)',
  tableCode: 'رمز الطاولة',
  tableCodeHint: 'رمز من 4 أرقام يعطيه النادل.',
  tableNotOpen: 'الطاولة غير مفتوحة بعد. اطلب الرمز من النادل.',
  join: 'الانضمام إلى الطاولة',
  save: 'حفظ',
  atTable: 'على الطاولة',
  you: 'أنت',
  client: 'زبون {n}',
  noOrders: 'لا توجد طلبات حتى الآن.',
  tableTotal: 'مجموع الطاولة',
  myShare: 'حصتي',
  alreadyPaid: 'مدفوع مسبقًا',
  remaining: 'المتبقي للدفع',
  payTitle: 'طلب الفاتورة',
  payHow: 'كيف تريد الدفع؟',
  payWhat: 'الفاتورة',
  payMine: 'حصتي',
  payTable: 'الطاولة كلها',
  CASH: 'نقدًا',
  MOBILE_MONEY: 'الدفع عبر الهاتف',
  CARD: 'بطاقة',
  requestBill: 'طلب الفاتورة',
  updateBill: 'تغيير طريقة الدفع',
  billPending: 'تم طلب الفاتورة ({method}): النادل قادم.',
  billPendingTable: 'تم طلب فاتورة الطاولة: النادل قادم.',
  payAtTable: 'يتم الدفع لدى النادل.',
  nothingToPay: 'لا شيء للدفع حاليًا.',
  errNetwork: 'تعذر الاتصال. تحقق من اتصالك بالإنترنت ثم أعد المحاولة.',
  errServer: 'المطعم لا يستجيب حاليًا.',
  errCodeRequired: 'أدخل رمز الطاولة الذي يعطيه النادل.',
  errCodeInvalid: 'رمز الطاولة غير صحيح. اطلبه من النادل.',
  errCodeLocked: 'رموز خاطئة كثيرة لهذه الطاولة. يرجى التوجه إلى النادل.',
  'status.PENDING': 'أُرسل — بانتظار التأكيد',
  'status.CONFIRMED': 'أكده المطعم',
  'status.PREPARING': 'قيد التحضير',
  'status.READY': 'جاهز — في الطريق',
  'status.SERVED': 'قُدِّم',
  'status.COMPLETED': 'مكتمل',
  'status.CANCELLED': 'ألغاه المطعم',
  'step.0': 'أُرسل',
  'step.1': 'مؤكد',
  'step.2': 'المطبخ',
  'step.3': 'جاهز',
  'step.4': 'قُدِّم',
  choiceOptionalOne: 'اختياري، خيار واحد',
  choiceOptionalMax: 'اختياري، حتى {n} خيارات',
  choiceRequiredOne: 'خيار واحد إلزامي',
  choiceRequiredN: '{n} خيارات إلزامية',
  choiceRange: 'من {min} إلى {max} خيارات',
};

const DICTIONARIES: Record<Lang, Record<MenuKey, string>> = { fr, en, ar };

const ALLERGENS: Record<Lang, Record<Allergen, string>> = {
  fr: { GLUTEN: 'Gluten', CRUSTACEANS: 'Crustacés', EGGS: 'Œufs', FISH: 'Poisson', PEANUTS: 'Arachides', SOY: 'Soja', MILK: 'Lait', NUTS: 'Fruits à coque', CELERY: 'Céleri', MUSTARD: 'Moutarde', SESAME: 'Sésame', SULPHITES: 'Sulfites', LUPIN: 'Lupin', MOLLUSCS: 'Mollusques' },
  en: { GLUTEN: 'Gluten', CRUSTACEANS: 'Crustaceans', EGGS: 'Eggs', FISH: 'Fish', PEANUTS: 'Peanuts', SOY: 'Soy', MILK: 'Milk', NUTS: 'Tree nuts', CELERY: 'Celery', MUSTARD: 'Mustard', SESAME: 'Sesame', SULPHITES: 'Sulphites', LUPIN: 'Lupin', MOLLUSCS: 'Molluscs' },
  ar: { GLUTEN: 'الغلوتين', CRUSTACEANS: 'القشريات', EGGS: 'البيض', FISH: 'السمك', PEANUTS: 'الفول السوداني', SOY: 'الصويا', MILK: 'الحليب', NUTS: 'المكسرات', CELERY: 'الكرفس', MUSTARD: 'الخردل', SESAME: 'السمسم', SULPHITES: 'الكبريتيت', LUPIN: 'الترمس', MOLLUSCS: 'الرخويات' },
};

/** Paramètres régionaux des montants : chiffres latins aussi en arabe (usage au Tchad). */
export const MONEY_LOCALE: Record<Lang, string> = { fr: 'fr-FR', en: 'en-GB', ar: 'ar-u-nu-latn' };

export function translate(lang: Lang, key: MenuKey, vars?: Record<string, string | number>): string {
  const text = DICTIONARIES[lang][key] ?? fr[key];
  return vars ? text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? '')) : text;
}

export function detectLang(stored: string | null, browser: readonly string[]): Lang {
  if (stored && (LANGS as readonly string[]).includes(stored)) return stored as Lang;
  for (const tag of browser) {
    const base = tag.toLowerCase().slice(0, 2);
    if ((LANGS as readonly string[]).includes(base)) return base as Lang;
  }
  return 'fr';
}

export function choiceRuleText(lang: Lang, minSelect: number, maxSelect: number): string {
  if (minSelect === 0) return maxSelect === 1 ? translate(lang, 'choiceOptionalOne') : translate(lang, 'choiceOptionalMax', { n: maxSelect });
  if (minSelect === maxSelect) return minSelect === 1 ? translate(lang, 'choiceRequiredOne') : translate(lang, 'choiceRequiredN', { n: minSelect });
  return translate(lang, 'choiceRange', { min: minSelect, max: maxSelect });
}

interface LangValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: MenuKey, vars?: Record<string, string | number>) => string;
  allergen: (a: Allergen) => string;
}

const LangContext = createContext<LangValue | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem('afk.menu.lang');
    } catch {
      /* navigation privée */
    }
    return detectLang(stored, navigator.languages ?? [navigator.language]);
  });
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);
  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem('afk.menu.lang', next);
    } catch {
      /* gardé pour la visite */
    }
  }, []);
  const value = useMemo<LangValue>(() => ({ lang, setLang, t: (key, vars) => translate(lang, key, vars), allergen: (a) => ALLERGENS[lang][a] }), [lang, setLang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangValue {
  const value = useContext(LangContext);
  if (!value) throw new Error('LangProvider manquant');
  return value;
}

import { isNativeApp } from './platform.ts';

/**
 * Deux marques sur <html>, posées au démarrage :
 * - `tablette` : le design commun « Savane bleu » (styles/tablette.css, tablette-doux.css), posé PARTOUT —
 *   tablette, téléphone et PC ont le même langage visuel (validé par Kader le 15/09/2026). Le nom est
 *   historique : il est gardé pour ne pas renommer toutes les règles.
 * - `tactile` ou `souris` : l'appareil. `tactile` = l'application Android, tout écran tactile, ou
 *   `localStorage['afk.tablette'] = '1'` pour vérifier la version tablette depuis un PC. `souris` resserre
 *   les tailles (styles/pc.css) : même allure, cibles moins grandes qu'au doigt.
 */
export function markDevice(): void {
  let forced = false;
  try {
    forced = localStorage.getItem('afk.tablette') === '1';
  } catch {
    /* stockage indisponible */
  }
  const root = document.documentElement.classList;
  root.add('tablette');
  root.add(isNativeApp() || forced || window.matchMedia('(pointer: coarse)').matches ? 'tactile' : 'souris');
}

/**
 * Appareil tactile (tablette, téléphone) : pour le COMPORTEMENT seulement (onglets du métier, tableau de bord
 * qui tient dans l'écran, abonnement et back-office laissés au PC). Le design, lui, est le même partout.
 */
export const isTouchDevice = (): boolean => document.documentElement.classList.contains('tactile');

/** Ancien nom de isTouchDevice (appareil tactile), gardé pour les branches en cours. */
export const isTablet = isTouchDevice;

/**
 * Tailles tactiles imposées dans l'application tablette.
 *
 * Les règles tactiles de styles.css sont écrites dans `@media (pointer: coarse)`.
 * Mesuré sur la tablette de test (Android 11, WebView Chrome 83) : la WebView déclare un
 * pointeur « fin », les règles ne s'appliquaient pas et les boutons restaient à 30 px.
 * Une tablette avec clavier ou souris branchés fait de même. Dans l'application native,
 * l'appareil EST une tablette (ADR-011) : on recopie donc ces règles hors de leur media
 * query, sans les dupliquer dans le CSS.
 */
export function enforceTouchLayout(): void {
  if (!isNativeApp() || window.matchMedia('(pointer: coarse)').matches) return;

  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // feuille d'une autre origine : illisible, et ce ne sont pas nos règles
    }
    const copies: string[] = [];
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSMediaRule) || !rule.media.mediaText.includes('pointer: coarse')) continue;
      const inner = Array.from(rule.cssRules)
        .map((r) => r.cssText)
        .join('\n');
      // Garder les autres conditions : « (pointer: coarse) and (min-width: 601px) ».
      const rest = rule.media.mediaText
        .replace(/\(pointer:\s*coarse\)/, '')
        .replace(/^\s*and\s+|\s+and\s*$/g, '')
        .trim();
      copies.push(rest ? `@media ${rest} {\n${inner}\n}` : inner);
    }
    for (const css of copies) {
      try {
        sheet.insertRule(css.includes('@media') ? css : `@media all {\n${css}\n}`, sheet.cssRules.length);
      } catch {
        /* règle refusée par ce navigateur : on garde les tailles de base */
      }
    }
  }
  document.documentElement.classList.add('touch-forced');
}

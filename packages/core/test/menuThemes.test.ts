import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MENU_THEME,
  MENU_PALETTE_KEYS,
  MENU_THEMES,
  MENU_THEME_LIST,
  contrastRatio,
  hexToRgbTriplet,
  isMenuThemeId,
  menuPaletteVars,
  menuTheme,
  menuThemeCss,
  relativeLuminance,
} from '../src/menuThemes.ts';

const HEX = /^#[0-9a-f]{6}$/;
const AA = 4.5;
const palettes = MENU_THEME_LIST.flatMap((t) => [
  [`${t.id} clair`, t.light],
  [`${t.id} sombre`, t.dark],
] as const);

describe('Thèmes du menu client', () => {
  it('six thèmes, dans l’ordre des identifiants, avec nom et description en français', () => {
    expect(MENU_THEMES).toHaveLength(6);
    expect(MENU_THEME_LIST.map((t) => t.id)).toEqual([...MENU_THEMES]);
    expect(DEFAULT_MENU_THEME).toBe('bleu');
    for (const t of MENU_THEME_LIST) {
      expect(t.label.length).toBeGreaterThan(2);
      expect(t.description.length).toBeGreaterThan(20);
    }
    expect(new Set(MENU_THEME_LIST.map((t) => t.light.accent)).size).toBe(6);
  });

  it('chaque palette a toutes les couleurs, en #rrggbb, et rien de plus', () => {
    for (const [name, p] of palettes) {
      expect(Object.keys(p).sort(), name).toEqual([...MENU_PALETTE_KEYS, 'dark'].sort());
      for (const key of MENU_PALETTE_KEYS) expect(p[key], `${name} ${key}`).toMatch(HEX);
    }
  });

  it('contrastes AA : texte sur l’accent, prix, textes, bandeau, barre du bas', () => {
    for (const [name, p] of palettes) {
      const pairs: [string, string, string][] = [
        ['onAccent/accent', p.onAccent, p.accent],
        ['onAccent/accentPress', p.onAccent, p.accentPress],
        ['text/bg', p.text, p.bg],
        ['text/card', p.text, p.card],
        ['muted/bg', p.muted, p.bg],
        ['muted/card', p.muted, p.card],
        ['prix accentDark/card', p.accentDark, p.card],
        ['prix accentDark/bg', p.accentDark, p.bg],
        ['accentDark/soft', p.accentDark, p.soft],
        ['accentText/bg', p.accentText, p.bg],
        ['accentText/card', p.accentText, p.card],
        ['onDeep/deep', p.onDeep, p.deep],
        ['deepSoft/deep', p.deepSoft, p.deep],
        ['bannerText/bannerStart', p.bannerText, p.bannerStart],
        ['bannerText/bannerEnd', p.bannerText, p.bannerEnd],
        ['bannerSoft/bannerStart', p.bannerSoft, p.bannerStart],
        ['bannerCtaText/bannerCta', p.bannerCtaText, p.bannerCta],
        ['danger/card', p.danger, p.card],
        ['onAction/action', p.onAction, p.action],
        ['onAction/actionPress', p.onAction, p.actionPress],
      ];
      for (const [label, fg, bg] of pairs) expect(contrastRatio(fg, bg), `${name} ${label}`).toBeGreaterThanOrEqual(AA);
    }
  });

  it('« bleu » clair : palette v3 (page bleutée, bleu pour les prix et pour l’action, bandeau bleu nuit → bleu)', () => {
    const p = menuTheme('bleu').light;
    expect(p).toMatchObject({ bg: '#eef2f8', card: '#ffffff', text: '#0f1f40', muted: '#5b6478', line: '#e3e8f1', accent: '#1d4ed8', accentDark: '#1d4ed8', bannerStart: '#0b1730', bannerEnd: '#1d4ed8' });
    expect(p).toMatchObject({ action: '#1d4ed8', onAction: '#ffffff' });
    // Plus aucun bouton jaune : « nuit » garde son or pour les accents, mais son action est bleue.
    expect(menuTheme('nuit').light.action).toBe('#2f63e8');
    for (const id of ['savane', 'foret', 'maquis', 'ocean'] as const) expect(menuTheme(id).light.action, id).toBe(menuTheme(id).light.accent);
    for (const [name, p] of palettes) expect(relativeLuminance(p.live), name).toBeGreaterThan(0.2);
  });

  it('une palette sombre est vraiment sombre, une claire vraiment claire ; « nuit » reste sombre partout', () => {
    for (const [name, p] of palettes) {
      if (p.dark) expect(relativeLuminance(p.bg), name).toBeLessThan(0.05);
      else expect(relativeLuminance(p.bg), name).toBeGreaterThan(0.8);
    }
    expect(menuTheme('nuit').light).toEqual(menuTheme('nuit').dark);
    expect(menuTheme('nuit').light.dark).toBe(true);
  });

  it('WCAG : luminance et contraste de référence', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBe(0);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });

  it('valeur inconnue ou absente : thème par défaut', () => {
    expect(menuTheme(null).id).toBe('bleu');
    expect(menuTheme('rose').id).toBe('bleu');
    expect(menuTheme('ocean').id).toBe('ocean');
    expect(isMenuThemeId('foret')).toBe(true);
    expect(isMenuThemeId('Foret')).toBe(false);
  });

  it('feuille générée : variables claires, bloc sombre, triplets rgb', () => {
    expect(hexToRgbTriplet('#1d4ed8')).toBe('29, 78, 216');
    const css = menuThemeCss('savane');
    expect(css).toContain('--m-accent:#c2410c;');
    expect(css).toContain('--m-accent-rgb:194, 65, 12;');
    expect(css).toContain('--m-action:#c2410c;');
    expect(menuThemeCss('bleu')).toContain('--m-action-rgb:29, 78, 216;');
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain('color-scheme:light;');
    expect(menuThemeCss('nuit')).not.toContain('color-scheme:light;');
  });

  it('menu.css déclare par défaut exactement les variables du thème « bleu » (clair et sombre)', () => {
    const css = readFileSync(new URL('../../../apps/web/src/menu/menu.css', import.meta.url), 'utf8');
    const rootBlocks = [...css.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1]!);
    expect(rootBlocks.length).toBe(2);
    const read = (block: string) => Object.fromEntries([...block.matchAll(/(--m-[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2]!.trim()]));
    expect(read(rootBlocks[0]!)).toEqual(menuPaletteVars(menuTheme('bleu').light));
    expect(read(rootBlocks[1]!)).toEqual(menuPaletteVars(menuTheme('bleu').dark));
    // Aucune variable utilisée par la feuille qui ne viendrait pas d'un thème.
    const declared = new Set(Object.keys(menuPaletteVars(menuTheme('bleu').light)));
    const used = new Set([...css.matchAll(/var\((--m-[a-z0-9-]+)/g)].map((m) => m[1]!));
    expect([...used].filter((v) => !declared.has(v))).toEqual([]);
  });
});

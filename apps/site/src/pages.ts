import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CURRENCIES,
  GRACE_DAYS,
  LIMITED_RESOURCES,
  PLAN_CODES,
  PLANS,
  TRIAL_DAYS,
  formatMoney,
  type PlanDefinition,
} from '@afrikaisse/core';
import { SITE_CONFIG, type SiteConfig } from './config.ts';
import { icon, type IconName } from './icons.ts';
import { LOCALES, type CaptureId, type LinkTarget, type LocaleDef, type SiteText, type TextFacts } from './i18n/index.ts';
import { logoSvg } from './logo.ts';

/** Dossier apps/site. */
export const SITE_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/** Plats montrés sur l'accueil (photos CC0 / domaine public réduites dans public/images/plats, sans auteur affiché). */
export const SAMPLE_DISHES = ['poisson-braise-baton', 'yassa-poulet', 'capitaine-braise', 'riz-gras', 'mafe', 'the-menthe'] as const;

export interface CatalogueFacts {
  dishes: number;
  photos: number;
  groups: string[];
  samples: { id: string; name: string }[];
}

/** Le catalogue de plats de l'application (apps/web/public/catalogue) : le site en cite les nombres réels. */
export function loadCatalogue(): CatalogueFacts {
  const file = resolve(SITE_DIR, '../web/public/catalogue/catalogue.json');
  const data = JSON.parse(readFileSync(file, 'utf8')) as { groups: { id: string; label: string }[]; dishes: { id: string; name: string; image?: string }[] };
  return {
    dishes: data.dishes.length,
    photos: data.dishes.filter((d) => d.image).length,
    groups: data.groups.map((g) => g.label),
    samples: SAMPLE_DISHES.map((id) => {
      const dish = data.dishes.find((d) => d.id === id);
      if (!dish?.image) throw new Error(`Plat « ${id} » absent du catalogue ou sans photo`);
      return { id, name: dish.name };
    }),
  };
}

export interface Ctx {
  t: SiteText;
  locale: LocaleDef;
  appUrl: string;
  siteUrl: string;
  config: SiteConfig;
  plans: PlanDefinition[];
  catalogue: CatalogueFacts;
  facts: TextFacts;
  year: number;
  links: { login: string; register: string };
}

export function createContext(options: { appUrl: string; siteUrl: string; config?: SiteConfig; locale?: LocaleDef['code']; year?: number }): Ctx {
  const locale = LOCALES[options.locale ?? 'fr'];
  const t = locale.text;
  const config = options.config ?? SITE_CONFIG;
  const plans = PLAN_CODES.map((code) => PLANS[code]);
  const catalogue = loadCatalogue();
  const ctxWithoutFacts = { t, locale, appUrl: options.appUrl, siteUrl: options.siteUrl, config, plans, catalogue };
  const list = (items: string[]) => items.join(', ');
  const facts: TextFacts = {
    company: config.company,
    city: config.city,
    trialDays: TRIAL_DAYS,
    graceDays: GRACE_DAYS,
    currencies: list(Object.values(CURRENCIES).map((c) => c.label)),
    catalogueDishes: catalogue.dishes,
    cataloguePhotos: catalogue.photos,
    catalogueGroups: list(catalogue.groups.map((g) => g.toLowerCase())),
    proLocations: limitText(t, PLANS.PRO.limits.locations).toLowerCase(),
    appHost: new URL(options.appUrl).host,
    plansSummary: plans.map((p) => `${t.pricing.planLabel(p)} ${priceText(t, p, TRIAL_DAYS)}`).join(', '),
  };
  return {
    ...ctxWithoutFacts,
    facts,
    year: options.year ?? new Date().getFullYear(),
    // `#inscription` ouvre directement le formulaire « Créer mon restaurant » de l'application.
    links: { login: `${options.appUrl}/`, register: `${options.appUrl}/#inscription` },
  };
}

// === Petits outils =========================================================

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value: string): string => value.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);

const href = (ctx: Ctx, path: string) => `${ctx.locale.prefix}${path}`;

function limitText(t: SiteText, value: number | null): string {
  return value === null ? t.pricing.unlimited : String(value);
}

/** « 15 000 FCFA / mois », « Gratuit pendant 30 jours », « Sur devis ». */
function priceText(t: SiteText, plan: PlanDefinition, trialDays: number): string {
  if (plan.monthlyPrice === null) return t.pricing.onQuote.toLowerCase();
  if (plan.monthlyPrice === 0) return `${t.pricing.free.toLowerCase()} ${t.pricing.trialDuration({ trialDays } as TextFacts)}`;
  return `${formatMoney(plan.monthlyPrice, 'XAF')} ${t.pricing.perMonth}`;
}

function priceParts(ctx: Ctx, plan: PlanDefinition): { amount: string; unit: string | null } {
  const { t } = ctx;
  if (plan.monthlyPrice === null) return { amount: t.pricing.onQuote, unit: null };
  if (plan.monthlyPrice === 0) return { amount: t.pricing.free, unit: t.pricing.trialDuration(ctx.facts) };
  return { amount: formatMoney(plan.monthlyPrice, 'XAF'), unit: t.pricing.perMonth };
}

interface ButtonOptions {
  variant?: 'default' | 'primary' | 'white' | 'outline-white';
  icon?: IconName;
  large?: boolean;
  className?: string;
}

function btn(url: string, label: string, options: ButtonOptions = {}): string {
  const classes = ['btn'];
  if (options.variant && options.variant !== 'default') classes.push(`btn-${options.variant}`);
  if (options.large) classes.push('btn-lg');
  if (options.className) classes.push(options.className);
  return `<a class="${classes.join(' ')}" href="${esc(url)}">${options.icon ? icon(options.icon) : ''}<span>${esc(label)}</span></a>`;
}

function linkFor(ctx: Ctx, target: LinkTarget): { url: string; label: string; icon: IconName } {
  const { t } = ctx;
  switch (target) {
    case 'register':
      return { url: ctx.links.register, label: t.actions.register, icon: 'plus' };
    case 'login':
      return { url: ctx.links.login, label: t.actions.login, icon: 'login' };
    case 'pricing':
      return { url: href(ctx, '/tarifs/'), label: t.actions.pricing, icon: 'arrowRight' };
    case 'contact':
      return { url: href(ctx, '/contact/'), label: t.actions.contact, icon: 'email' };
    case 'demo':
      return { url: href(ctx, '/demonstration/'), label: t.actions.demo, icon: 'arrowRight' };
    case 'features':
      return { url: href(ctx, '/fonctionnalites/'), label: t.actions.features, icon: 'arrowRight' };
  }
}

const mailto = (email: string, subject?: string) => `mailto:${email}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`;

const FEATURE_ICONS: Record<string, IconName> = {
  caisse: 'caisse',
  commandes: 'commandes',
  tables: 'tables',
  'menu-qr': 'qr',
  cuisine: 'cuisine',
  carte: 'carte',
  stock: 'stock',
  impression: 'impression',
  pilotage: 'pilotage',
  equipe: 'equipe',
  'hors-ligne': 'horsLigne',
  tablette: 'tablette',
  etablissements: 'etablissements',
  langues: 'langues',
  paiements: 'paiements',
  devises: 'devises',
};
const featureIcon = (id: string): IconName => FEATURE_ICONS[id] ?? 'check';

/** Capture réelle de l'application, en deux tailles. */
function capture(ctx: Ctx, id: CaptureId, sizes: string, eager = false): string {
  const item = ctx.t.captures.items[id];
  const loading = eager ? ' fetchpriority="high"' : ' loading="lazy"';
  return (
    `<figure class="shot"><img src="/captures/${id}-1440.webp" srcset="/captures/${id}-720.webp 720w, /captures/${id}-1440.webp 1440w" sizes="${sizes}" width="1440" height="900" alt="${esc(item.alt)}"${loading} decoding="async">` +
    `<figcaption><strong>${esc(item.title)}</strong> · ${esc(ctx.t.captures.caption)}</figcaption></figure>`
  );
}

function pageHead(title: string, lead: string): string {
  return `<div class="page-head"><div class="wrap"><h1>${esc(title)}</h1><p class="lead">${esc(lead)}</p></div></div>`;
}

function points(items: string[]): string {
  return `<ul class="points">${items.map((p) => `<li>${icon('check')}<span>${esc(p)}</span></li>`).join('')}</ul>`;
}

function cta(ctx: Ctx): string {
  const { t } = ctx;
  return (
    `<section class="cta" aria-labelledby="cta-titre"><div class="wrap cta-inner"><div class="cta-copy"><h2 id="cta-titre">${esc(t.home.ctaTitle)}</h2><p>${esc(t.home.ctaText(ctx.facts))}</p></div>` +
    `<div class="actions">${btn(ctx.links.register, t.actions.register, { variant: 'white', icon: 'plus', large: true })}${btn(href(ctx, '/contact/'), t.actions.contact, { variant: 'outline-white', icon: 'email', large: true })}</div></div></section>`
  );
}

function jsonLd(data: object): string {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

// === Pages ================================================================

export interface PageDef {
  id: string;
  /** Adresse publique, sans préfixe de langue. */
  path: string;
  /** Fichier produit, relatif à la racine du site. */
  file: string;
  indexable: boolean;
  title: (ctx: Ctx) => string;
  description: (ctx: Ctx) => string;
  body: (ctx: Ctx) => string;
  jsonLd?: (ctx: Ctx) => object;
}

function home(ctx: Ctx): string {
  const { t, facts } = ctx;
  const h = t.home;

  const hero =
    `<section class="hero"><div class="wrap hero-grid"><div class="hero-text"><h1>${esc(h.h1)}</h1><p class="lead">${esc(h.lead)}</p>` +
    `<div class="actions">${btn(ctx.links.register, t.actions.register, { variant: 'primary', icon: 'plus', large: true })}${btn(href(ctx, '/tarifs/'), t.actions.pricing, { large: true })}</div>` +
    `<p class="note">${icon('check')}<span>${esc(h.trial(facts))}</span></p></div>` +
    capture(ctx, 'caisse', '(min-width: 1200px) 660px, (min-width: 1024px) 56vw, 100vw', true) +
    `</div></section>`;

  const brief =
    `<section class="section band" aria-labelledby="bref"><div class="wrap"><div class="fiche"><h2 class="fiche-title" id="bref">${esc(h.factsTitle)}</h2><dl class="rows">` +
    h
      .facts(facts)
      .map((r) => `<div><dt>${icon(featureIcon(r.id))}<span>${esc(r.label)}</span></dt><dd>${esc(r.text)}</dd></div>`)
      .join('') +
    `</dl></div></div></section>`;

  const modules =
    `<section class="section" aria-labelledby="modules"><div class="wrap"><div class="section-head"><h2 id="modules">${esc(h.modulesTitle)}</h2>` +
    btn(href(ctx, '/fonctionnalites/'), t.actions.features, { icon: 'arrowRight' }) +
    `</div><ul class="modules">` +
    h.modules
      .map(
        (m) =>
          `<li><a href="${href(ctx, '/fonctionnalites/')}#${m.id}"><span class="module-ico">${icon(featureIcon(m.id))}</span><span class="module-copy"><strong>${esc(m.title)}</strong><span>${esc(m.text)}</span></span>${icon('chevronRight', 'ico chev')}</a></li>`,
      )
      .join('') +
    `</ul></div></section>`;

  const flow =
    `<section class="section band" aria-labelledby="trajet"><div class="wrap"><h2 id="trajet">${esc(h.flowTitle)}</h2><ol class="steps">` +
    h.flow.map((s, i) => `<li><span class="step-num" aria-hidden="true">${i + 1}</span><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></li>`).join('') +
    `</ol></div></section>`;

  const modes =
    `<section class="section" aria-labelledby="modes"><div class="wrap"><h2 id="modes">${esc(h.modesTitle)}</h2><p class="lead">${esc(h.modesLead)}</p>` +
    `<div class="table-wrap"><table class="grid"><thead><tr><th scope="col"><span class="visually-hidden">${esc(h.modesCriterion)}</span></th><th scope="col">${esc(h.modesCloud)}</th><th scope="col">${esc(h.modesLocal)}</th></tr></thead><tbody>` +
    h
      .modes(facts)
      .map(([label, cloud, local]) => `<tr><th scope="row">${esc(label)}</th><td>${esc(cloud)}</td><td>${esc(local)}</td></tr>`)
      .join('') +
    `</tbody></table></div></div></section>`;

  const catalogue =
    `<section class="section band" aria-labelledby="catalogue"><div class="wrap split"><div><h2 id="catalogue">${esc(h.catalogueTitle)}</h2><p>${esc(h.catalogueText(facts))}</p><p class="small">${esc(h.catalogueNote)}</p>` +
    btn(href(ctx, '/demonstration/'), t.actions.demo, { icon: 'arrowRight' }) +
    `</div><ul class="dishes">` +
    ctx.catalogue.samples
      .map(
        (d) =>
          `<li><figure><img src="/images/plats/${d.id}.webp" width="480" height="360" alt="${esc(h.dishAlt(d.name))}" loading="lazy" decoding="async"><figcaption>${esc(d.name)}</figcaption></figure></li>`,
      )
      .join('') +
    `</ul></div></section>`;

  const pricing =
    `<section class="section" aria-labelledby="tarifs"><div class="wrap"><div class="section-head"><div><h2 id="tarifs">${esc(t.pricing.h1)}</h2><p class="lead">${esc(h.pricingLead)}</p></div>` +
    btn(href(ctx, '/tarifs/'), t.actions.compare, { icon: 'arrowRight' }) +
    `</div><div class="table-wrap"><table class="grid"><thead><tr><th scope="col">${esc(t.pricing.offer)}</th><th scope="col">${esc(t.pricing.price)}</th><th scope="col">${esc(t.pricing.resources.locations)}</th><th scope="col">${esc(t.pricing.summary)}</th></tr></thead><tbody>` +
    ctx.plans
      .map((p) => {
        const { amount, unit } = priceParts(ctx, p);
        return `<tr data-plan="${p.code}"><th scope="row">${esc(t.pricing.planLabel(p))}</th><td class="nowrap">${esc(amount)}${unit ? ` <span class="small">${esc(unit)}</span>` : ''}</td><td>${esc(limitText(t, p.limits.locations))}</td><td>${esc(t.pricing.planSummary(p))}</td></tr>`;
      })
      .join('') +
    `</tbody></table></div></div></section>`;

  return hero + brief + modules + flow + modes + catalogue + pricing + cta(ctx);
}

function featuresPage(ctx: Ctx): string {
  const x = ctx.t.features;
  const sections = x.sections(ctx.facts);
  return (
    pageHead(x.h1, x.lead) +
    `<div class="wrap doc"><nav class="toc" aria-labelledby="toc-titre"><h2 id="toc-titre">${esc(x.toc)}</h2><ul>` +
    sections.map((s) => `<li><a href="#${s.id}">${icon(featureIcon(s.id))}<span>${esc(s.title)}</span></a></li>`).join('') +
    `</ul></nav><div class="doc-body">` +
    sections
      .map(
        (s) =>
          `<section class="feature" id="${s.id}" aria-labelledby="${s.id}-titre"><h2 id="${s.id}-titre">${icon(featureIcon(s.id))}<span>${esc(s.title)}</span></h2>${points(s.points)}` +
          (s.capture ? capture(ctx, s.capture, '(min-width: 1200px) 860px, (min-width: 1024px) 70vw, 100vw') : '') +
          `</section>`,
      )
      .join('') +
    `</div></div>` +
    cta(ctx)
  );
}

function pricingPage(ctx: Ctx): string {
  const { t, config } = ctx;
  const p = t.pricing;
  const quoteUrl = config.email ? mailto(config.email, t.contact.subjects[0]?.subject) : href(ctx, '/contact/');

  const offers =
    `<section class="section" aria-label="${esc(p.offer)}"><div class="wrap"><div class="offers">` +
    ctx.plans
      .map((plan) => {
        const { amount, unit } = priceParts(ctx, plan);
        const action =
          plan.monthlyPrice === null
            ? btn(quoteUrl, t.actions.quote, { icon: 'email' })
            : btn(ctx.links.register, t.actions.register, { variant: plan.monthlyPrice === 0 ? 'primary' : 'default', icon: 'plus' });
        return (
          `<article class="offer" data-plan="${plan.code}" aria-labelledby="offre-${plan.code}"><h2 class="fiche-title" id="offre-${plan.code}">${esc(p.planLabel(plan))}</h2>` +
          `<div class="offer-body"><p class="price">${esc(amount)}${unit ? ` <span class="price-unit">${esc(unit)}</span>` : ''}</p><p class="offer-summary">${esc(p.planSummary(plan))}</p>` +
          `<dl class="limits">${LIMITED_RESOURCES.map((r) => `<div><dt>${esc(p.resources[r])}</dt><dd>${esc(limitText(t, plan.limits[r]))}</dd></div>`).join('')}</dl></div>` +
          `<div class="offer-foot">${action}</div></article>`
        );
      })
      .join('') +
    `</div><p class="small offers-note">${esc(p.startNote)}</p></div></section>`;

  const cells = (render: (plan: PlanDefinition) => string) => ctx.plans.map((plan) => `<td>${render(plan)}</td>`).join('');
  const compare =
    `<section class="section band" aria-labelledby="comparer"><div class="wrap"><h2 id="comparer">${esc(p.compareTitle)}</h2><div class="table-wrap"><table class="grid compare"><thead><tr><th scope="col">${esc(p.offer)}</th>` +
    ctx.plans.map((plan) => `<th scope="col">${esc(p.planLabel(plan))}</th>`).join('') +
    `</tr></thead><tbody>` +
    `<tr data-row="price"><th scope="row">${esc(p.price)}</th>${cells((plan) => {
      const { amount, unit } = priceParts(ctx, plan);
      return `${esc(amount)}${unit ? ` <span class="small">${esc(unit)}</span>` : ''}`;
    })}</tr>` +
    LIMITED_RESOURCES.map((r) => `<tr data-row="${r}"><th scope="row">${esc(p.resources[r])}</th>${cells((plan) => esc(limitText(t, plan.limits[r])))}</tr>`).join('') +
    `<tr data-row="functions"><th scope="row">${esc(p.allFunctions)}</th>${cells(() => `${icon('check', 'ico ok')}${esc(p.yes)}`)}</tr>` +
    `</tbody></table></div></div></section>`;

  const rules =
    `<section class="section" aria-labelledby="reglement"><div class="wrap narrow"><div class="fiche"><h2 class="fiche-title" id="reglement">${esc(p.rulesTitle)}</h2><div class="fiche-body">${points(p.rules(ctx.facts))}</div></div></div></section>`;

  return pageHead(p.h1, p.lead) + offers + compare + rules + cta(ctx);
}

function demoPage(ctx: Ctx): string {
  const { t, facts } = ctx;
  const d = t.demo;
  const steps =
    `<section class="section" aria-labelledby="etapes"><div class="wrap"><h2 id="etapes">${esc(d.stepsTitle)}</h2><ol class="demo-steps">` +
    d
      .steps(facts)
      .map((s, i) => {
        const action = s.action ? linkFor(ctx, s.action) : null;
        return (
          `<li><span class="step-num" aria-hidden="true">${i + 1}</span><div class="step-copy"><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></div>` +
          (action ? `<div class="step-action">${btn(action.url, action.label, { variant: 'primary', icon: action.icon })}</div>` : '') +
          `</li>`
        );
      })
      .join('') +
    `</ol></div></section>`;

  const ids: CaptureId[] = ['tableau-de-bord', 'caisse', 'tables', 'menu'];
  const gallery =
    `<section class="section band" aria-labelledby="captures"><div class="wrap"><h2 id="captures">${esc(d.galleryTitle)}</h2><p class="lead">${esc(d.galleryLead)}</p><div class="gallery">` +
    ids.map((id) => capture(ctx, id, '(min-width: 1200px) 576px, (min-width: 768px) 48vw, 100vw')).join('') +
    `</div></div></section>`;

  const contact = linkFor(ctx, 'contact');
  const more =
    `<section class="section" aria-labelledby="tablette"><div class="wrap narrow"><div class="fiche"><h2 class="fiche-title" id="tablette">${esc(d.moreTitle)}</h2><div class="fiche-body"><p>${esc(d.moreText)}</p>` +
    btn(contact.url, contact.label, { icon: contact.icon }) +
    `</div></div></div></section>`;

  return pageHead(d.h1, d.lead(facts)) + steps + gallery + more + cta(ctx);
}

function faqPage(ctx: Ctx): string {
  const { t, facts } = ctx;
  return (
    pageHead(t.faq.h1, t.faq.lead) +
    `<section class="section"><div class="wrap"><div class="faq">` +
    t.faq.items
      .map((item) => {
        const link = item.link ? linkFor(ctx, item.link) : null;
        return (
          `<details class="qa" id="${item.id}"><summary><span>${esc(item.q)}</span>${icon('chevronDown')}</summary><div class="qa-body">` +
          item
            .a(facts)
            .map((para) => `<p>${esc(para)}</p>`)
            .join('') +
          (link ? `<p>${btn(link.url, link.label, { icon: link.icon })}</p>` : '') +
          `</div></details>`
        );
      })
      .join('') +
    `</div></div></section>` +
    cta(ctx)
  );
}

function contactPage(ctx: Ctx): string {
  const { t, config } = ctx;
  const c = t.contact;
  const rows: [string, string][] = [
    [c.company, esc(config.company)],
    [c.city, esc(config.city)],
  ];
  if (config.email) rows.push([c.email, `<a href="${esc(mailto(config.email))}">${icon('email')}<span>${esc(config.email)}</span></a>`]);
  if (config.phone) rows.push([c.phone, `<a href="tel:${esc(config.phone.replace(/[^\d+]/g, ''))}">${icon('phone')}<span>${esc(config.phone)}</span></a>`]);
  if (config.whatsapp) {
    const digits = config.whatsapp.replace(/\D/g, '');
    rows.push([c.whatsapp, `<a href="https://wa.me/${digits}">${icon('whatsapp')}<span>+${esc(digits)}</span></a>`]);
  }
  const reachable = Boolean(config.email || config.phone || config.whatsapp);

  const details =
    `<div class="fiche"><h2 class="fiche-title" id="coordonnees">${esc(c.detailsTitle)}</h2><dl class="rows rows-compact">` +
    rows.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`).join('') +
    `</dl>${reachable ? '' : `<p class="fiche-body">${esc(c.pending)}</p>`}</div>`;

  const write = config.email
    ? `<div class="fiche"><h2 class="fiche-title" id="ecrire">${esc(c.writeTitle)}</h2><ul class="link-list">` +
      c.subjects.map((s) => `<li><a href="${esc(mailto(config.email as string, s.subject))}">${icon('email')}<span>${esc(s.label)}</span></a></li>`).join('') +
      `</ul></div>`
    : '';

  const include = `<div class="fiche"><h2 class="fiche-title" id="indiquer">${esc(c.includeTitle)}</h2><div class="fiche-body">${points(c.include)}</div></div>`;

  const customers =
    `<div class="fiche"><h2 class="fiche-title" id="clients">${esc(c.customersTitle)}</h2><div class="fiche-body"><p>${esc(c.customersText)}</p>` +
    btn(ctx.links.login, t.actions.login, { variant: 'primary', icon: 'login' }) +
    `</div></div>`;

  return (
    pageHead(c.h1, c.lead) +
    `<section class="section"><div class="wrap contact-grid"><div class="stack">${details}${write}</div><div class="stack">${include}${customers}</div></div></section>`
  );
}

function notFoundPage(ctx: Ctx): string {
  const { t } = ctx;
  return (
    `<section class="section notfound"><div class="wrap narrow"><h1>${esc(t.notFound.h1)}</h1><p class="lead">${esc(t.notFound.text)}</p><ul class="link-list fiche">` +
    NAV.map((n) => `<li><a href="${href(ctx, n.path)}">${icon('chevronRight')}<span>${esc(n.label(t))}</span></a></li>`).join('') +
    `</ul></div></section>`
  );
}

const NAV: { id: string; path: string; label: (t: SiteText) => string }[] = [
  { id: 'accueil', path: '/', label: (t) => t.nav.home },
  { id: 'fonctionnalites', path: '/fonctionnalites/', label: (t) => t.nav.features },
  { id: 'tarifs', path: '/tarifs/', label: (t) => t.nav.pricing },
  { id: 'demonstration', path: '/demonstration/', label: (t) => t.nav.demo },
  { id: 'faq', path: '/faq/', label: (t) => t.nav.faq },
  { id: 'contact', path: '/contact/', label: (t) => t.nav.contact },
];

export const PAGES: PageDef[] = [
  {
    id: 'accueil',
    path: '/',
    file: 'index.html',
    indexable: true,
    title: (ctx) => ctx.t.home.title,
    description: (ctx) => ctx.t.home.description(ctx.facts),
    body: home,
    jsonLd: (ctx) => ({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'AfriKaisse',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web, Android, Windows',
      url: `${ctx.siteUrl}/`,
      description: ctx.t.home.description(ctx.facts),
      publisher: { '@type': 'Organization', name: ctx.config.company, address: { '@type': 'PostalAddress', addressLocality: ctx.config.city } },
      offers: ctx.plans
        .filter((p) => p.monthlyPrice !== null)
        .map((p) => ({ '@type': 'Offer', name: ctx.t.pricing.planLabel(p), price: p.monthlyPrice, priceCurrency: 'XAF' })),
    }),
  },
  {
    id: 'fonctionnalites',
    path: '/fonctionnalites/',
    file: 'fonctionnalites/index.html',
    indexable: true,
    title: (ctx) => ctx.t.features.title,
    description: (ctx) => ctx.t.features.description,
    body: featuresPage,
  },
  {
    id: 'tarifs',
    path: '/tarifs/',
    file: 'tarifs/index.html',
    indexable: true,
    title: (ctx) => ctx.t.pricing.title,
    description: (ctx) => ctx.t.pricing.description(ctx.facts),
    body: pricingPage,
  },
  {
    id: 'demonstration',
    path: '/demonstration/',
    file: 'demonstration/index.html',
    indexable: true,
    title: (ctx) => ctx.t.demo.title(ctx.facts),
    description: (ctx) => ctx.t.demo.description(ctx.facts),
    body: demoPage,
  },
  {
    id: 'faq',
    path: '/faq/',
    file: 'faq/index.html',
    indexable: true,
    title: (ctx) => ctx.t.faq.title,
    description: (ctx) => ctx.t.faq.description,
    body: faqPage,
    jsonLd: (ctx) => ({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: ctx.t.faq.items.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.a(ctx.facts).join(' ') },
      })),
    }),
  },
  {
    id: 'contact',
    path: '/contact/',
    file: 'contact/index.html',
    indexable: true,
    title: (ctx) => ctx.t.contact.title(ctx.facts),
    description: (ctx) => ctx.t.contact.description(ctx.facts),
    body: contactPage,
  },
  {
    id: '404',
    path: '/404.html',
    file: '404.html',
    indexable: false,
    title: (ctx) => ctx.t.notFound.title,
    description: (ctx) => ctx.t.notFound.description,
    body: notFoundPage,
  },
];

// === Gabarit commun =======================================================

function header(page: PageDef, ctx: Ctx): string {
  const { t } = ctx;
  const current = (id: string) => (page.id === id ? ' aria-current="page"' : '');
  const links = (withHome: boolean) =>
    NAV.filter((n) => withHome || n.id !== 'accueil')
      .map((n) => `<li><a href="${href(ctx, n.path)}"${current(n.id)}>${esc(n.label(t))}</a></li>`)
      .join('');
  return (
    `<header class="bandeau"><div class="wrap bandeau-inner">` +
    `<a class="brand" href="${href(ctx, '/')}" aria-label="${esc(t.nav.brandHome)}">${logoSvg('h')}<span class="brand-name" aria-hidden="true">Afri<span>Kaisse</span></span></a>` +
    `<nav class="nav-main" aria-label="${esc(t.nav.main)}"><ul>${links(false)}</ul></nav>` +
    `<div class="bandeau-actions">${btn(ctx.links.login, t.actions.login, { variant: 'outline-white', icon: 'login', className: 'btn-login' })}${btn(ctx.links.register, t.actions.register, { variant: 'white', icon: 'plus' })}</div>` +
    `<details class="nav-mobile"><summary>${icon('menu')}<span>${esc(t.nav.menu)}</span></summary><div class="nav-mobile-panel">` +
    `<nav aria-label="${esc(t.nav.mobile)}"><ul>${links(true)}</ul></nav>` +
    `<div class="nav-mobile-actions">${btn(ctx.links.register, t.actions.register, { variant: 'primary', icon: 'plus' })}${btn(ctx.links.login, t.actions.login, { icon: 'login' })}</div>` +
    `</div></details></div></header>`
  );
}

function footer(ctx: Ctx): string {
  const { t, config } = ctx;
  return (
    `<footer class="pied"><div class="wrap pied-grid">` +
    `<div><a class="brand" href="${href(ctx, '/')}" aria-label="${esc(t.nav.brandHome)}">${logoSvg('f')}<span class="brand-name" aria-hidden="true">Afri<span>Kaisse</span></span></a><p>${esc(t.footer.tagline(ctx.facts))}</p></div>` +
    `<nav aria-labelledby="pied-site"><h2 id="pied-site">${esc(t.footer.product)}</h2><ul>${NAV.map((n) => `<li><a href="${href(ctx, n.path)}">${esc(n.label(t))}</a></li>`).join('')}</ul></nav>` +
    `<div><h2 id="pied-acces">${esc(t.footer.access)}</h2><ul><li><a href="${esc(ctx.links.login)}">${esc(t.actions.login)}</a></li><li><a href="${esc(ctx.links.register)}">${esc(t.actions.register)}</a></li>` +
    (config.email ? `<li><a href="${esc(mailto(config.email))}">${esc(config.email)}</a></li>` : '') +
    `</ul></div></div>` +
    `<div class="statusbar"><div class="wrap"><span>© ${ctx.year} ${esc(config.company)}</span><span>${esc(config.city)}</span><span>${esc(t.footer.language)}</span><span>${esc(t.footer.prices)}</span></div></div>` +
    `</footer>`
  );
}

export function renderPage(page: PageDef, ctx: Ctx): string {
  const { t, locale } = ctx;
  const title = page.title(ctx);
  const description = page.description(ctx);
  const url = `${ctx.siteUrl}${href(ctx, page.path)}`;
  return `<!doctype html>
<html lang="${locale.lang}" dir="${locale.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${page.indexable ? `<link rel="canonical" href="${esc(url)}">` : '<meta name="robots" content="noindex">'}
<meta name="theme-color" content="#065fd4">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta property="og:type" content="website">
<meta property="og:site_name" content="AfriKaisse">
<meta property="og:locale" content="${locale.ogLocale}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(ctx.siteUrl)}/og-afrikaisse.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(t.ogImageAlt)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="/site.css">
${page.jsonLd ? jsonLd(page.jsonLd(ctx)) : ''}
</head>
<body>
<a class="skip" href="#contenu">${esc(t.skip)}</a>
${header(page, ctx)}
<main id="contenu">${page.body(ctx)}</main>
${footer(ctx)}
</body>
</html>
`;
}

export function sitemapXml(ctx: Ctx): string {
  const urls = PAGES.filter((p) => p.indexable)
    .map((p) => `  <url><loc>${esc(`${ctx.siteUrl}${href(ctx, p.path)}`)}</loc></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function robotsTxt(ctx: Ctx): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${ctx.siteUrl}/sitemap.xml\n`;
}

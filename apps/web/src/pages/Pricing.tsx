import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  PROMOTION_KIND_LABELS,
  PROMOTION_SCOPE_LABELS,
  PROMOTION_STATE_LABELS,
  TAX_MODE_LABELS,
  WEEKDAY_LABELS,
  formatMoney,
  formatRate,
  localMoment,
  minuteToTime,
  promotionBadge,
  promotionState,
  scheduleLabel,
  timeToMinute,
  type PricingConfig,
  type Promotion,
  type PromotionKind,
  type PromotionScope,
  type PromotionState,
  type TaxMode,
  type TaxRate,
} from '@afrikaisse/core';
import { api } from '../api.ts';
import { Dialog, ErrorMessage, Icon, MoneyInput, OkMessage } from '../ui.tsx';
import '../styles/pricing.css';

/**
 * Onglet « Taxes et promotions » du Menu : mode de taxe, taux, taux par catégorie et produit,
 * promotions. Chaque action renvoie la configuration complète : une seule source de vérité.
 */

type Save = (method: string, path: string, body?: unknown, message?: string) => Promise<void>;

const STATE_CLASS: Record<PromotionState, string> = { LIVE: 'st st-ready', WAITING: 'st st-pending', PAUSED: 'st st-cancelled', ENDED: 'st' };

/** « 18 » ou « 19,25 » → points de base ; null si illisible. */
function parseRate(text: string): number | null {
  const clean = text.trim().replace('%', '').replace(',', '.').trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(clean)) return null;
  const bp = Math.round(Number(clean) * 100);
  return bp <= 10_000 ? bp : null;
}

const rateInput = (bp: number) => String(bp / 100).replace('.', ',');

export function PricingTab({ locationId, canManage }: { locationId: string; canManage: boolean }) {
  const [config, setConfig] = useState<PricingConfig | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rateId, setRateId] = useState<string | null>(null);
  const [promotionId, setPromotionId] = useState<string | null>(null);
  const [rateDialog, setRateDialog] = useState<null | { rate?: TaxRate }>(null);
  const [promotionDialog, setPromotionDialog] = useState<null | { promotion?: Promotion }>(null);
  const [archiving, setArchiving] = useState<Promotion | null>(null);

  const load = useCallback(async () => {
    try {
      setConfig(await api<PricingConfig>('GET', `/locations/${locationId}/pricing`));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [locationId]);
  useEffect(() => {
    void load();
  }, [load]);

  /** Fenêtres de saisie : l'erreur reste dans la fenêtre. */
  const save: Save = async (method, path, body, message = 'Enregistré.') => {
    setNotice(null);
    setConfig(await api<PricingConfig>(method, path, body));
    setError(null);
    setNotice(message);
  };
  /** Actions directes : l'erreur s'affiche dans l'onglet. */
  const act: Save = async (method, path, body, message) => {
    try {
      await save(method, path, body, message);
    } catch (err) {
      setNotice(null);
      setError(err);
    }
  };

  if (!config) {
    return (
      <div className="window-body">
        <ErrorMessage error={error} />
        {!error && <p className="muted">Chargement…</p>}
      </div>
    );
  }

  const money = (v: number) => formatMoney(v, config.location.currency);
  const moment = localMoment(Date.now(), config.location.timezone);
  const rate = config.taxRates.find((r) => r.id === rateId) ?? null;
  const promotion = config.promotions.find((p) => p.id === promotionId) ?? null;
  const rateLabel = (id: string | null) => {
    const r = config.taxRates.find((x) => x.id === id);
    return r ? `${r.name} ${formatRate(r.rateBp)}` : 'Aucune taxe';
  };
  const targetLabel = (p: Promotion) => {
    if (p.scope === 'ORDER') return p.minAmount ? `Commande dès ${money(p.minAmount)}` : 'Commande';
    const name = p.scope === 'CATEGORY' ? config.categories.find((c) => c.id === p.targetId)?.name : config.products.find((x) => x.id === p.targetId)?.name;
    return `${PROMOTION_SCOPE_LABELS[p.scope]} · ${name ?? '—'}`;
  };

  return (
    <div className="window-body pricing-body">
      <ErrorMessage error={error} />
      {notice && !error && <OkMessage>{notice}</OkMessage>}

      <div className="pricing-grid">
        <fieldset className="group">
          <legend>Taxes</legend>
          <div className="form pricing-settings">
            <label>Prix du menu</label>
            <span className="segmented">
              {(['INCLUSIVE', 'EXCLUSIVE'] as TaxMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className="btn"
                  disabled={!canManage}
                  aria-pressed={config.taxMode === mode}
                  onClick={() => config.taxMode !== mode && act('PATCH', `/locations/${locationId}/pricing`, { taxMode: mode }, `Prix ${TAX_MODE_LABELS[mode].toLowerCase()}.`)}
                >
                  {TAX_MODE_LABELS[mode]}
                </button>
              ))}
            </span>
            <label htmlFor="tax-default">Taux par défaut</label>
            <select
              id="tax-default"
              disabled={!canManage}
              value={config.defaultTaxRateId ?? ''}
              onChange={(e) => act('PATCH', `/locations/${locationId}/pricing`, { defaultTaxRateId: e.target.value || null }, 'Taux par défaut enregistré.')}
            >
              <option value="">Aucune taxe</option>
              {config.taxRates.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} {formatRate(r.rateBp)}
                </option>
              ))}
            </select>
          </div>
          {canManage && (
            <div className="pricing-actions">
              <button className="btn" onClick={() => setRateDialog({})}>
                <Icon name="add" />
                Nouveau taux
              </button>
              <button className="btn" disabled={!rate} onClick={() => rate && setRateDialog({ rate })}>
                <Icon name="edit" />
                Modifier
              </button>
              <button className="btn" disabled={!rate} onClick={() => rate && act('POST', `/tax-rates/${rate.id}/archive`, undefined, `Taux « ${rate.name} » archivé.`)}>
                <Icon name="archive" />
                Archiver
              </button>
            </div>
          )}
          <div className="grid-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Taux</th>
                  <th>Catégories et produits</th>
                </tr>
              </thead>
              <tbody>
                {config.taxRates.length === 0 && (
                  <tr>
                    <td className="empty" colSpan={3}>
                      Aucun taux
                    </td>
                  </tr>
                )}
                {config.taxRates.map((r) => (
                  <tr key={r.id} className="selectable" aria-selected={r.id === rateId} onClick={() => setRateId(r.id)} onDoubleClick={() => canManage && setRateDialog({ rate: r })}>
                    <td>
                      {r.name}
                      {r.isDefault && <span className="tag">Par défaut</span>}
                    </td>
                    <td className="num">{formatRate(r.rateBp)}</td>
                    <td className="num">{r.overrides}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </fieldset>

        <fieldset className="group">
          <legend>Taux par catégorie et produit</legend>
          <div className="grid-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>Catégorie · produit</th>
                  <th>Taxe</th>
                </tr>
              </thead>
              <tbody>
                {config.categories.length === 0 && (
                  <tr>
                    <td className="empty" colSpan={2}>
                      Aucune catégorie
                    </td>
                  </tr>
                )}
                {config.categories.map((c) => (
                  <CategoryRates key={c.id} config={config} categoryId={c.id} canManage={canManage && config.taxRates.length > 0} rateLabel={rateLabel} act={act} />
                ))}
              </tbody>
            </table>
          </div>
        </fieldset>
      </div>

      <fieldset className="group">
        <legend>Promotions</legend>
        {canManage && (
          <div className="pricing-actions">
            <button className="btn" onClick={() => setPromotionDialog({})}>
              <Icon name="add" />
              Nouvelle promotion
            </button>
            <button className="btn" disabled={!promotion} onClick={() => promotion && setPromotionDialog({ promotion })}>
              <Icon name="edit" />
              Modifier
            </button>
            <button
              className="btn"
              disabled={!promotion}
              onClick={() =>
                promotion && act('POST', `/promotions/${promotion.id}/active`, { isActive: !promotion.isActive }, promotion.isActive ? `Promotion « ${promotion.name} » suspendue.` : `Promotion « ${promotion.name} » reprise.`)
              }
            >
              <Icon name="power" />
              {promotion && !promotion.isActive ? 'Reprendre' : 'Suspendre'}
            </button>
            <button className="btn" disabled={!promotion} onClick={() => promotion && setArchiving(promotion)}>
              <Icon name="archive" />
              Archiver
            </button>
          </div>
        )}
        <div className="grid-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Remise</th>
                <th>Portée</th>
                <th>Code</th>
                <th>Calendrier</th>
                <th>Utilisations</th>
                <th>État</th>
              </tr>
            </thead>
            <tbody>
              {config.promotions.length === 0 && (
                <tr>
                  <td className="empty" colSpan={7}>
                    Aucune promotion
                  </td>
                </tr>
              )}
              {config.promotions.map((p) => {
                const state = promotionState(p, moment);
                return (
                  <tr key={p.id} className="selectable" aria-selected={p.id === promotionId} onClick={() => setPromotionId(p.id)} onDoubleClick={() => canManage && setPromotionDialog({ promotion: p })}>
                    <td>{p.name}</td>
                    <td className="num">{promotionBadge(p, money)}</td>
                    <td>{targetLabel(p)}</td>
                    <td>{p.code ? <span className="pricing-code">{p.code}</span> : <span className="pricing-empty">—</span>}</td>
                    <td>{scheduleLabel(p)}</td>
                    <td className="num">
                      {p.usesCount}
                      {p.maxUses !== null && ` / ${p.maxUses}`}
                    </td>
                    <td>
                      <span className={STATE_CLASS[state]}>{PROMOTION_STATE_LABELS[state]}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </fieldset>

      {rateDialog && <RateDialog locationId={locationId} rate={rateDialog.rate} save={save} onClose={() => setRateDialog(null)} />}
      {promotionDialog && <PromotionDialog config={config} promotion={promotionDialog.promotion} save={save} onClose={() => setPromotionDialog(null)} />}
      {archiving && (
        <Dialog
          title={`Archiver « ${archiving.name} »`}
          onClose={() => setArchiving(null)}
          footer={
            <>
              <button
                className="btn btn-danger"
                onClick={() => {
                  void act('POST', `/promotions/${archiving.id}/archive`, undefined, `Promotion « ${archiving.name} » archivée.`);
                  setArchiving(null);
                  setPromotionId(null);
                }}
              >
                Archiver
              </button>
              <button className="btn" onClick={() => setArchiving(null)}>
                Annuler
              </button>
            </>
          }
        >
          <div className="dialog-body">
            <p>
              {promotionBadge(archiving, money)} · {targetLabel(archiving)}
              {archiving.code && ` · ${archiving.code}`}
            </p>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function CategoryRates({ config, categoryId, canManage, rateLabel, act }: { config: PricingConfig; categoryId: string; canManage: boolean; rateLabel: (id: string | null) => string; act: Save }) {
  const category = config.categories.find((c) => c.id === categoryId)!;
  const products = config.products.filter((p) => p.categoryId === categoryId);
  const inherited = category.taxRateId ?? config.defaultTaxRateId;
  const options = config.taxRates.map((r) => (
    <option key={r.id} value={r.id}>
      {r.name} {formatRate(r.rateBp)}
    </option>
  ));
  return (
    <>
      <tr>
        <td>
          <strong>{category.name}</strong>
        </td>
        <td>
          <select
            aria-label={`Taxe de ${category.name}`}
            disabled={!canManage}
            value={category.taxRateId ?? ''}
            onChange={(e) => act('PUT', `/categories/${category.id}/tax-rate`, { taxRateId: e.target.value || null }, `Taxe de « ${category.name} » enregistrée.`)}
          >
            <option value="">Par défaut · {rateLabel(config.defaultTaxRateId)}</option>
            {options}
          </select>
        </td>
      </tr>
      {products.map((p) => (
        <tr key={p.id} className="pricing-child">
          <td>{p.name}</td>
          <td>
            <select
              aria-label={`Taxe de ${p.name}`}
              disabled={!canManage}
              value={p.taxRateId ?? ''}
              onChange={(e) => act('PUT', `/products/${p.id}/tax-rate`, { taxRateId: e.target.value || null }, `Taxe de « ${p.name} » enregistrée.`)}
            >
              <option value="">Comme la catégorie · {rateLabel(inherited)}</option>
              {options}
            </select>
          </td>
        </tr>
      ))}
    </>
  );
}

function RateDialog({ locationId, rate, save, onClose }: { locationId: string; rate?: TaxRate; save: Save; onClose: () => void }) {
  const [name, setName] = useState(rate?.name ?? 'TVA');
  const [value, setValue] = useState(rate ? rateInput(rate.rateBp) : '18');
  const [isDefault, setIsDefault] = useState(rate?.isDefault ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const rateBp = parseRate(value);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (rateBp === null) return;
    setBusy(true);
    setError(null);
    try {
      const body = { name: name.trim(), rateBp, isDefault };
      if (rate) await save('PATCH', `/tax-rates/${rate.id}`, body, `Taux « ${body.name} » enregistré.`);
      else await save('POST', `/locations/${locationId}/tax-rates`, body, `Taux « ${body.name} » créé.`);
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Dialog
        title={rate ? `Taux « ${rate.name} »` : 'Nouveau taux'}
        onClose={onClose}
        footer={
          <>
            <button className="btn btn-primary" disabled={busy || !name.trim() || rateBp === null}>
              Enregistrer
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Annuler
            </button>
          </>
        }
      >
        <div className="dialog-body pricing-form">
          <ErrorMessage error={error} />
          <div className="form">
            <label htmlFor="rate-name">Nom</label>
            <input id="rate-name" required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
            <label htmlFor="rate-value">Taux (%)</label>
            <input id="rate-value" inputMode="decimal" required aria-invalid={rateBp === null} value={value} onChange={(e) => setValue(e.target.value)} />
            <label htmlFor="rate-default">Par défaut</label>
            <input id="rate-default" type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          </div>
        </div>
      </Dialog>
    </form>
  );
}

interface PromotionForm {
  name: string;
  kind: PromotionKind;
  scope: PromotionScope;
  targetId: string;
  percent: string;
  amount: number | null;
  buyQuantity: number;
  freeQuantity: number;
  minAmount: number | null;
  code: string;
  startDate: string;
  endDate: string;
  days: number[];
  startTime: string;
  endTime: string;
  maxUses: string;
  isActive: boolean;
}

function PromotionDialog({ config, promotion, save, onClose }: { config: PricingConfig; promotion?: Promotion; save: Save; onClose: () => void }) {
  const currency = config.location.currency;
  const [form, setForm] = useState<PromotionForm>(() => ({
    name: promotion?.name ?? '',
    kind: promotion?.kind ?? 'PERCENT',
    scope: promotion?.scope ?? 'ORDER',
    targetId: promotion?.targetId ?? '',
    percent: promotion?.kind === 'PERCENT' ? rateInput(promotion.value) : '10',
    amount: promotion?.kind === 'AMOUNT' ? promotion.value : null,
    buyQuantity: promotion?.buyQuantity ?? 2,
    freeQuantity: promotion?.freeQuantity ?? 1,
    minAmount: promotion?.minAmount ?? null,
    code: promotion?.code ?? '',
    startDate: promotion?.startDate ?? '',
    endDate: promotion?.endDate ?? '',
    days: promotion?.days ?? [],
    startTime: minuteToTime(promotion?.startMinute ?? null),
    endTime: minuteToTime(promotion?.endMinute ?? null),
    maxUses: promotion?.maxUses ? String(promotion.maxUses) : '',
    isActive: promotion?.isActive ?? true,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = <K extends keyof PromotionForm>(key: K, value: PromotionForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const percentBp = parseRate(form.percent);
  const startMinute = timeToMinute(form.startTime);
  const endMinute = timeToMinute(form.endTime);
  const maxUses = form.maxUses.trim() ? Number(form.maxUses) : null;
  const valueOk = form.kind === 'PERCENT' ? percentBp !== null && percentBp > 0 : form.kind === 'AMOUNT' ? !!form.amount && form.amount > 0 : form.buyQuantity >= 1 && form.freeQuantity >= 1;
  const timeOk = (!form.startTime && !form.endTime) || (startMinute !== null && endMinute !== null && startMinute !== endMinute);
  const valid = form.name.trim() !== '' && valueOk && (form.scope === 'ORDER' || !!form.targetId) && timeOk && (maxUses === null || (Number.isInteger(maxUses) && maxUses >= 1));

  function changeKind(kind: PromotionKind) {
    setForm((f) => ({ ...f, kind, scope: kind === 'FREE_ITEM' && f.scope === 'ORDER' ? 'PRODUCT' : f.scope, targetId: kind === 'FREE_ITEM' && f.scope === 'ORDER' ? '' : f.targetId }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    const body = {
      name: form.name.trim(),
      kind: form.kind,
      scope: form.scope,
      targetId: form.scope === 'ORDER' ? null : form.targetId,
      value: form.kind === 'PERCENT' ? percentBp : form.kind === 'AMOUNT' ? form.amount : 0,
      buyQuantity: form.kind === 'FREE_ITEM' ? form.buyQuantity : null,
      freeQuantity: form.kind === 'FREE_ITEM' ? form.freeQuantity : null,
      minAmount: form.scope === 'ORDER' ? form.minAmount : null,
      code: form.code.trim() || null,
      startDate: form.startDate || null,
      endDate: form.endDate || null,
      days: [...form.days].sort((a, b) => a - b),
      startMinute: form.startTime ? startMinute : null,
      endMinute: form.endTime ? endMinute : null,
      maxUses,
      isActive: form.isActive,
    };
    setBusy(true);
    setError(null);
    try {
      if (promotion) await save('PUT', `/promotions/${promotion.id}`, body, `Promotion « ${body.name} » enregistrée.`);
      else await save('POST', `/locations/${config.location.id}/promotions`, body, `Promotion « ${body.name} » créée.`);
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const scopes: PromotionScope[] = form.kind === 'FREE_ITEM' ? ['CATEGORY', 'PRODUCT'] : ['ORDER', 'CATEGORY', 'PRODUCT'];

  return (
    <form onSubmit={submit}>
      <Dialog
        title={promotion ? `Promotion « ${promotion.name} »` : 'Nouvelle promotion'}
        onClose={onClose}
        wide
        footer={
          <>
            <button className="btn btn-primary" disabled={busy || !valid}>
              Enregistrer
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Annuler
            </button>
          </>
        }
      >
        <div className="dialog-body pricing-form">
          <ErrorMessage error={error} />
          <div className="form">
            <label htmlFor="promo-name">Nom</label>
            <input id="promo-name" required maxLength={60} value={form.name} onChange={(e) => set('name', e.target.value)} />

            <label>Remise</label>
            <span className="segmented">
              {(['PERCENT', 'AMOUNT', 'FREE_ITEM'] as PromotionKind[]).map((k) => (
                <button key={k} type="button" className="btn" aria-pressed={form.kind === k} onClick={() => changeKind(k)}>
                  {PROMOTION_KIND_LABELS[k]}
                </button>
              ))}
            </span>

            {form.kind === 'PERCENT' && (
              <>
                <label htmlFor="promo-percent">Pourcentage (%)</label>
                <input id="promo-percent" inputMode="decimal" required aria-invalid={percentBp === null} value={form.percent} onChange={(e) => set('percent', e.target.value)} />
              </>
            )}
            {form.kind === 'AMOUNT' && (
              <>
                <label htmlFor="promo-amount">{form.scope === 'ORDER' ? 'Montant' : 'Montant par article'}</label>
                <MoneyInput id="promo-amount" value={form.amount} currency={currency} required onChange={(v) => set('amount', v)} />
              </>
            )}
            {form.kind === 'FREE_ITEM' && (
              <>
                <label htmlFor="promo-buy">Achetés · offerts</label>
                <span className="pair">
                  <input id="promo-buy" type="number" inputMode="numeric" min={1} max={99} required value={form.buyQuantity} onChange={(e) => set('buyQuantity', Math.max(1, Math.min(99, Math.round(Number(e.target.value)) || 1)))} />
                  <span>+</span>
                  <input aria-label="Offerts" type="number" inputMode="numeric" min={1} max={99} required value={form.freeQuantity} onChange={(e) => set('freeQuantity', Math.max(1, Math.min(99, Math.round(Number(e.target.value)) || 1)))} />
                </span>
              </>
            )}

            <label>Portée</label>
            <span className="segmented">
              {scopes.map((s) => (
                <button key={s} type="button" className="btn" aria-pressed={form.scope === s} onClick={() => setForm((f) => ({ ...f, scope: s, targetId: '' }))}>
                  {PROMOTION_SCOPE_LABELS[s]}
                </button>
              ))}
            </span>
            {form.scope === 'CATEGORY' && (
              <>
                <label htmlFor="promo-target">Catégorie</label>
                <select id="promo-target" required value={form.targetId} onChange={(e) => set('targetId', e.target.value)}>
                  <option value="">Choisir…</option>
                  {config.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </>
            )}
            {form.scope === 'PRODUCT' && (
              <>
                <label htmlFor="promo-target">Produit</label>
                <select id="promo-target" required value={form.targetId} onChange={(e) => set('targetId', e.target.value)}>
                  <option value="">Choisir…</option>
                  {config.categories.map((c) => (
                    <optgroup key={c.id} label={c.name}>
                      {config.products
                        .filter((p) => p.categoryId === c.id)
                        .map((p) => (
                          <option key={p.id} value={p.id} disabled={p.promoPriced}>
                            {p.name}
                            {p.promoPriced ? ' (prix promotionnel)' : ''}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </>
            )}
            {form.scope === 'ORDER' && (
              <>
                <label htmlFor="promo-min">Commande minimale</label>
                <MoneyInput id="promo-min" value={form.minAmount} currency={currency} allowEmpty onChange={(v) => set('minAmount', v)} />
              </>
            )}

            <label htmlFor="promo-code">Code promo</label>
            <input id="promo-code" className="pricing-code-input" maxLength={20} autoComplete="off" pattern="[A-Za-z0-9_\-]{3,20}" value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} />

            <label htmlFor="promo-start">Dates</label>
            <span className="pair">
              <input id="promo-start" type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
              <span>au</span>
              <input aria-label="Date de fin" type="date" min={form.startDate || undefined} value={form.endDate} onChange={(e) => set('endDate', e.target.value)} />
            </span>

            <label>Jours</label>
            <div className="pricing-days">
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <button key={d} type="button" className="chip" aria-pressed={form.days.includes(d)} onClick={() => set('days', form.days.includes(d) ? form.days.filter((x) => x !== d) : [...form.days, d])}>
                  {WEEKDAY_LABELS[d]}
                </button>
              ))}
            </div>

            <label htmlFor="promo-from">Heures</label>
            <span className="pair">
              <input id="promo-from" type="time" aria-invalid={!timeOk} value={form.startTime} onChange={(e) => set('startTime', e.target.value)} />
              <span>à</span>
              <input aria-label="Heure de fin" type="time" aria-invalid={!timeOk} value={form.endTime} onChange={(e) => set('endTime', e.target.value)} />
            </span>

            <label htmlFor="promo-max">Utilisations max.</label>
            <input id="promo-max" type="number" inputMode="numeric" min={1} value={form.maxUses} onChange={(e) => set('maxUses', e.target.value)} />

            <label htmlFor="promo-active">Active</label>
            <input id="promo-active" type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />
          </div>
        </div>
      </Dialog>
    </form>
  );
}

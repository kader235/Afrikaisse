import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
// Types seulement, et valeurs du sous-module sans Zod : le bundle du menu reste léger.
import type { ClientSession, PublicOrder } from '@afrikaisse/core';
import { CLIENT_PAYMENT_METHODS, NICKNAME_MAX, isTableCode, type ClientPaymentMethod } from '@afrikaisse/core/guests';
import { mdiCardsOutline, mdiClose, mdiTranslate, mdiWifiOff, mdiInformationOutline } from '@mdi/js';
import { errorText, request } from './api.ts';
import { Icon } from './Icon.tsx';
import { LANGS, LANG_NAMES, useLang, type Lang } from './i18n.tsx';
import { nicknameStore, tableCodeStore } from './pwa.ts';

/**
 * Écrans du client autour de la table (§23, §43, I-7, I-9) : feuille générique, suivi des
 * commandes, « Ma table », demande d'addition avec moyen de paiement, bandeau hors ligne, langue.
 */

export type Money = (minor: number) => string;
/** offline : téléphone ou restaurant injoignable ; paused : le Cloud ne voit plus le serveur local. */
export type Blocked = 'offline' | 'paused' | null;

export const ACTIVE_STATUSES = new Set(['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED']);
/** Commande envoyée mais pas encore prête : le client patiente (jeu du mémo proposé). */
export const WAITING_STATUSES = new Set(['PENDING', 'CONFIRMED', 'PREPARING']);
const STEPS = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED'] as const;

export function Sheet({ title, onClose, children, footer, className, closeButton = true }: { title?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; className?: string; closeButton?: boolean }) {
  const { t } = useLang();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);
  return (
    <div className="m-overlay" onClick={onClose}>
      <div className={className ? `m-sheet ${className}` : 'm-sheet'} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        {closeButton && (
          <button className="m-close" aria-label={t('close')} onClick={onClose}>
            <Icon path={mdiClose} size={20} />
          </button>
        )}
        <div className="m-sheet-scroll">{children}</div>
        {footer && <div className="m-sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function OfflineBanner({ blocked }: { blocked: Blocked }) {
  const { t } = useLang();
  if (!blocked) return null;
  return (
    <div className={`m-offline m-offline-${blocked}`} role="status">
      <Icon path={blocked === 'offline' ? mdiWifiOff : mdiInformationOutline} size={20} />
      <div>
        {blocked === 'offline' && <strong>{t('offline')}</strong>}
        <span>{t(blocked === 'offline' ? 'orderingOffline' : 'orderingPaused')}</span>
      </div>
    </div>
  );
}

/** Langue : pastille discrète (icône seule) ; la liste native s'ouvre au toucher. */
export function LanguageSwitch() {
  const { lang, setLang, t } = useLang();
  return (
    <label className="m-lang" title={t('language')}>
      <Icon path={mdiTranslate} size={18} />
      <select aria-label={t('language')} value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
        {LANGS.map((l) => (
          <option key={l} value={l}>
            {LANG_NAMES[l]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Ligne de choix (radio ou case) : grande ligne blanche, pastille à la fin, prix du supplément. */
export function ChoiceRow({ type, name, checked, disabled, off, label, aside, onChange, onClick }: { type: 'radio' | 'checkbox'; name: string; checked: boolean; disabled?: boolean; off?: boolean; label: string; aside?: string; onChange: () => void; onClick?: () => void }) {
  return (
    <label className={`m-choice${checked ? ' on' : ''}${off ? ' off' : ''}${disabled ? ' disabled' : ''}`}>
      <input type={type} name={name} disabled={disabled} checked={checked} onChange={onChange} onClick={onClick} />
      <span className="m-choice-name">{label}</span>
      {aside && <small className="m-choice-aside">{aside}</small>}
      <span className={type === 'radio' ? 'm-tick' : 'm-tick m-tick-box'} />
    </label>
  );
}

/** Nom d'un client : le « Client 2 » du serveur est traduit, un surnom reste tel quel. */
export function useGuestText() {
  const { t } = useLang();
  return (name: string | null) => {
    if (!name) return null;
    const rank = /^Client (\d+)$/.exec(name)?.[1];
    return rank ? t('client', { n: rank }) : name;
  };
}

export function OrdersList({ orders, money, showGuests }: { orders: PublicOrder[]; money: Money; showGuests: boolean }) {
  const { t } = useLang();
  const guestText = useGuestText();
  if (orders.length === 0) return <p className="m-empty">{t('noOrders')}</p>;
  return (
    <>
      {orders.map((o) => {
        const step = STEPS.indexOf(o.status as (typeof STEPS)[number]);
        return (
          <div key={o.id} className={o.mine ? 'm-order mine' : 'm-order'}>
            <div className="m-order-head">
              <strong>{t('orderNo', { n: o.number })}</strong>
              <span className="m-num">{money(o.total)}</span>
            </div>
            {showGuests && (o.guestName || o.mine) && (
              <p className="m-order-guest">
                {guestText(o.guestName)}
                {o.mine && ` (${t('you')})`}
              </p>
            )}
            <p className={o.status === 'CANCELLED' ? 'm-order-status bad' : 'm-order-status'}>{t(`status.${o.status}`)}</p>
            {o.status !== 'CANCELLED' && o.status !== 'COMPLETED' && (
              <ol className="m-steps">
                {STEPS.map((s, i) => (
                  <li key={s} className={i <= step ? 'done' : undefined}>
                    <span />
                    {t(`step.${i}` as 'step.0')}
                  </li>
                ))}
              </ol>
            )}
            <ul className="m-order-items">
              {o.items.map((i, index) => (
                <li key={index}>
                  {i.quantity} × {i.name}
                  {i.variantName && ` (${i.variantName})`}
                  {i.modifiers.length > 0 && <small> — {i.modifiers.join(', ')}</small>}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}

/** Champs « code de table » et « surnom », partagés par le panier et « Ma table ». */
export function GuestFields({ needsCode, code, onCode, nickname, onNickname }: { needsCode: boolean; code: string; onCode: (v: string) => void; nickname: string; onNickname: (v: string) => void }) {
  const { t } = useLang();
  return (
    <>
      {needsCode && (
        <label className="m-field m-code-field">
          <span>{t('tableCode')}</span>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{4}"
            maxLength={4}
            placeholder="····"
            value={code}
            onChange={(e) => onCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
            dir="ltr"
          />
          <small>{t('tableCodeHint')}</small>
        </label>
      )}
      <label className="m-field">
        <span>{t('nickname')}</span>
        <input maxLength={NICKNAME_MAX} value={nickname} onChange={(e) => onNickname(e.target.value)} autoComplete="given-name" />
      </label>
    </>
  );
}

export function TableSheet({
  session,
  token,
  me,
  money,
  blocked,
  onSession,
  onPlay,
  onClose,
}: {
  session: ClientSession | null;
  token: string;
  me: string;
  money: Money;
  blocked: Blocked;
  onSession: (s: ClientSession) => void;
  /** Ouvre le jeu du mémo (proposé tant qu'une commande de la table est en cours de préparation). */
  onPlay?: () => void;
  onClose: () => void;
}) {
  const { t } = useLang();
  const guestText = useGuestText();
  const [code, setCode] = useState(() => (session?.session ? (tableCodeStore.get(session.session.id) ?? '') : ''));
  const [nickname, setNickname] = useState(() => session?.nickname ?? nicknameStore.get());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!session) {
    return (
      <Sheet title={t('myTable')} onClose={onClose}>
        <div className="m-sheet-body">
          <h3>{t('myTable')}</h3>
          <p className="m-empty">{blocked === 'offline' ? t('offline') : t('loading')}</p>
        </div>
      </Sheet>
    );
  }

  const needsCode = session.tableCodeRequired && !session.joined;
  const canJoin = !!session.session && (!session.joined || nickname.trim() !== (session.nickname ?? ''));

  async function join(e: FormEvent) {
    e.preventDefault();
    if (needsCode && !isTableCode(code)) {
      setError(t('errCodeRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await request<ClientSession>('POST', `/api/public/menu/${token}/join`, { clientToken: me, ...(needsCode && { code }), nickname: nickname.trim() || null });
      if (needsCode && next.session) tableCodeStore.set(next.session.id, code);
      nicknameStore.set(nickname);
      onSession(next);
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  const perCustomer = session.billMode === 'PER_CUSTOMER';
  return (
    <Sheet title={t('myTable')} onClose={onClose}>
      <div className="m-sheet-body">
        <h3>{t('myTable')}</h3>
        {onPlay && session.orders.some((o) => WAITING_STATUSES.has(o.status)) && (
          <button className="m-card m-play" onClick={onPlay}>
            <span className="m-play-icon" aria-hidden="true">
              <Icon path={mdiCardsOutline} size={26} />
            </span>
            <span className="m-play-text">
              <strong>{t('memoInviteTitle')}</strong>
              <span>{t('memoInviteBody')}</span>
            </span>
            <span className="m-play-cta">{t('memoPlay')}</span>
          </button>
        )}
        {!session.session && session.tableCodeRequired && <p className="m-hint">{t('tableNotOpen')}</p>}
        {session.session && (needsCode || canJoin) && (
          <form className="m-card m-join" onSubmit={join}>
            <GuestFields needsCode={needsCode} code={code} onCode={setCode} nickname={nickname} onNickname={setNickname} />
            {error && <p className="m-error">{error}</p>}
            <button className="m-button m-wide" disabled={busy || blocked === 'offline'}>
              {session.joined ? t('save') : t('join')}
            </button>
          </form>
        )}

        {session.guests.length > 0 && (
          <div className="m-guests">
            <h4>{t('atTable')}</h4>
            <ul>
              {session.guests.map((g) => (
                <li key={g.rank} className={g.isMe ? 'me' : undefined}>
                  <span>
                    {guestText(g.name)}
                    {g.isMe && ` (${t('you')})`}
                  </span>
                  {perCustomer && <span className="m-guest-share m-num">{money(g.share.total)}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <OrdersList orders={session.orders} money={money} showGuests={session.guests.length > 1} />

        {(session.table.total > 0 || session.mine.total > 0) && (
          <dl className="m-totals">
            {session.table.total > 0 && (
              <>
                <dt>{t('tableTotal')}</dt>
                <dd className="m-num">{money(session.table.total)}</dd>
              </>
            )}
            {perCustomer && (
              <>
                <dt>{t('myShare')}</dt>
                <dd className="m-num">{money(session.mine.total)}</dd>
              </>
            )}
            {(perCustomer ? session.mine.paid : session.table.paid) > 0 && (
              <>
                <dt>{t('alreadyPaid')}</dt>
                <dd className="m-num">{money(perCustomer ? session.mine.paid : session.table.paid)}</dd>
              </>
            )}
          </dl>
        )}
      </div>
    </Sheet>
  );
}

export function PaySheet({
  session,
  token,
  me,
  money,
  blocked,
  onDone,
  onClose,
}: {
  session: ClientSession | null;
  token: string;
  me: string;
  money: Money;
  blocked: Blocked;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const { t } = useLang();
  const perCustomer = session?.billMode === 'PER_CUSTOMER';
  const [scope, setScope] = useState<'MINE' | 'TABLE'>(session?.bill?.scope === 'TABLE' ? 'TABLE' : 'MINE');
  const [method, setMethod] = useState<ClientPaymentMethod>(session?.bill?.paymentMethod ?? 'CASH');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = !session ? 0 : perCustomer && scope === 'MINE' ? session.mine.remaining : Math.max(session.table.remaining, session.mine.remaining);
  const pending = session?.bill ?? null;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await request('POST', `/api/public/menu/${token}/requests`, { clientToken: me, kind: 'BILL', paymentMethod: method, ...(perCustomer && { scope }) });
      onDone(t('billPending', { method: t(method) }));
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={t('payTitle')}
      onClose={onClose}
      footer={
        <>
          {error && <p className="m-error">{error}</p>}
          {blocked === 'offline' && <p className="m-hint">{t('orderingOffline')}</p>}
          <button className="m-button m-wide" disabled={busy || blocked === 'offline'} onClick={submit}>
            {pending ? t('updateBill') : t('requestBill')}
          </button>
          <p className="m-fine">{t('payAtTable')}</p>
        </>
      }
    >
      <div className="m-sheet-body">
        <h3>{t('payTitle')}</h3>
        {pending && <p className="m-pay-pending">{pending.scope === 'TABLE' && !pending.mine ? t('billPendingTable') : t('billPending', { method: t(pending.paymentMethod ?? 'CASH') })}</p>}
        <div className="m-pay-amount">
          <span>{t('remaining')}</span>
          <strong className="m-num">{amount > 0 ? money(amount) : '—'}</strong>
        </div>
        {amount === 0 && <p className="m-hint">{t('nothingToPay')}</p>}
        {perCustomer && (
          <fieldset className="m-group">
            <legend>
              <span className="m-group-head">
                <span>{t('payWhat')}</span>
              </span>
            </legend>
            {(['MINE', 'TABLE'] as const).map((s) => (
              <ChoiceRow key={s} type="radio" name="bill-scope" checked={scope === s} onChange={() => setScope(s)} label={t(s === 'MINE' ? 'payMine' : 'payTable')} aside={session ? money(s === 'MINE' ? session.mine.remaining : session.table.remaining) : undefined} />
            ))}
          </fieldset>
        )}
        <fieldset className="m-group">
          <legend>
            <span className="m-group-head">
              <span>{t('payHow')}</span>
            </span>
          </legend>
          {CLIENT_PAYMENT_METHODS.map((m) => (
            <ChoiceRow key={m} type="radio" name="pay-method" checked={method === m} onChange={() => setMethod(m)} label={t(m)} />
          ))}
        </fieldset>
      </div>
    </Sheet>
  );
}

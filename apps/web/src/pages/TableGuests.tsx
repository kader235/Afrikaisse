import { useState } from 'react';
import { PAYMENT_METHOD_LABELS, formatMoney, type Check, type CurrencyCode, type OpenTableResult, type ServiceRequest } from '@afrikaisse/core';
import { api } from '../api.ts';

/**
 * Clients d'une table vus par le personnel (§23) : code de table (I-9), parts par client,
 * détail des demandes d'addition (moyen de paiement annoncé, I-7). Partagé par Salle et Caisse.
 */

/** « Awa · sa part · Mobile money · 12 000 FCFA » */
export function requestDetail(r: ServiceRequest, currency: CurrencyCode): string | null {
  const parts: string[] = [];
  if (r.guestName) parts.push(r.guestName);
  if (r.kind === 'BILL') {
    if (r.billScope === 'MINE') parts.push('sa part');
    if (r.paymentMethod) parts.push(PAYMENT_METHOD_LABELS[r.paymentMethod]);
    if (r.amount !== null) parts.push(formatMoney(r.amount, currency));
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

export interface GuestShare {
  name: string;
  total: number;
  paid: number;
  remaining: number;
}

/** Parts d'une note par client (commandes QR) ; « Commun » pour ce que le personnel a saisi. */
export function guestShares(check: Check): GuestShare[] {
  const byName = new Map<string, GuestShare>();
  for (const o of check.orders) {
    const name = o.guestName ?? 'Commun';
    const share = byName.get(name) ?? { name, total: 0, paid: 0, remaining: 0 };
    share.total += o.total;
    share.paid += o.paid;
    share.remaining = share.total - share.paid;
    byName.set(name, share);
  }
  return [...byName.values()];
}

/** Addition par client : tableau des parts, affiché seulement s'il y a plusieurs payeurs. */
export function GuestShares({ check }: { check: Check }) {
  if (check.billMode !== 'PER_CUSTOMER') return null;
  const shares = guestShares(check);
  if (shares.length < 2) return null;
  return (
    <table className="grid guest-shares">
      <thead>
        <tr>
          <th>Client</th>
          <th className="num">Total</th>
          <th className="num">Reste</th>
        </tr>
      </thead>
      <tbody>
        {shares.map((s) => (
          <tr key={s.name}>
            <td>{s.name}</td>
            <td className="num">{formatMoney(s.total, check.currency)}</td>
            <td className="num">{formatMoney(s.remaining, check.currency)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Code à donner aux clients de la table ; « Nouveau code » si le code a circulé. */
export function TableCode({ check, canManage, onChanged, onError }: { check: Check; canManage: boolean; onChanged: (code: string | null) => void; onError: (err: unknown) => void }) {
  const [busy, setBusy] = useState(false);
  if (check.kind !== 'session') return null;
  async function renew() {
    setBusy(true);
    try {
      const result = await api<OpenTableResult>('POST', `/table-sessions/${check.id}/code`);
      onChanged(result.joinCode);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="table-code">
      <span className="table-code-label">Code de table</span>
      <strong className="table-code-value num">{check.joinCode ?? '----'}</strong>
      {canManage && (
        <button className="btn" disabled={busy} onClick={renew}>
          {check.joinCode ? 'Nouveau code' : 'Générer'}
        </button>
      )}
    </div>
  );
}

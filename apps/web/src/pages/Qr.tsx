import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import type { QrList } from '@afrikaisse/core';
import { api } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { isNativeApp } from '../platform.ts';
import { Dialog, ErrorMessage, Icon, OkMessage } from '../ui.tsx';

/**
 * QR codes des tables : consultation, régénération, planche A4 à imprimer.
 * L'impression passe par un ordinateur : la WebView de la tablette n'ouvre pas de
 * dialogue d'impression.
 */
export function QrTab({ locationId, canManage }: { locationId: string; canManage: boolean }) {
  const { t } = useI18n();
  const [list, setList] = useState<QrList | null>(null);
  const [svgs, setSvgs] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const selected = list?.codes.find((c) => c.tableId === selectedId) ?? null;

  const load = useCallback(async () => {
    setError(null);
    try {
      const next = await api<QrList>('GET', `/locations/${locationId}/qr-codes`);
      const entries = await Promise.all(
        next.codes.map(async (c) => [c.token, await QRCode.toString(c.url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })] as const),
      );
      setList(next);
      setSvgs(Object.fromEntries(entries));
    } catch (err) {
      setError(err);
    }
  }, [locationId]);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!printing) return;
    const timer = setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 200);
    return () => clearTimeout(timer);
  }, [printing]);

  async function regenerate() {
    if (!selected) return;
    setError(null);
    try {
      await api('POST', `/tables/${selected.tableId}/qr/regenerate`);
      setNotice(t('qr.regenerated'));
      await load();
    } catch (err) {
      setError(err);
    }
    setConfirm(false);
  }

  return (
    <>
      <div className="toolbar">
        {canManage && (
          <button className="btn" disabled={!selected} onClick={() => setConfirm(true)}>
            <Icon name="refresh" />
            {t('qr.regenerate')}
          </button>
        )}
        {!isNativeApp() && (
          <button className="btn" disabled={!list?.codes.length} onClick={() => setPrinting(true)}>
            <Icon name="print" />
            {t('qr.print')}
          </button>
        )}
        <span className="sep" />
        <button className="btn" onClick={load}>
          <Icon name="refresh" />
          {t('common.refresh')}
        </button>
      </div>
      <div className="window-body" style={{ paddingBottom: 0 }}>
        <ErrorMessage error={error} />
        {notice && !error && <OkMessage>{notice}</OkMessage>}
        {list && !list.reachableFromInternet && (
          <div className="msg msg-warn">
            Ces QR mènent à <strong>{list.menuBaseUrl}</strong>, une adresse du réseau du restaurant : un client devrait d'abord rejoindre son Wi-Fi. Pour qu'il scanne et commande
            avec ses données mobiles, créez l'établissement dans AfriKaisse Cloud et reliez-y ce serveur local avant d'imprimer les QR.
          </div>
        )}
      </div>
      <div className="grid-wrap" style={{ marginTop: 10 }}>
        <table className="grid">
          <thead>
            <tr>
              <th style={{ width: 80 }}>{t('qr.colQr')}</th>
              <th>{t('qr.colZone')}</th>
              <th>{t('qr.colTable')}</th>
              <th>{t('qr.colLink')}</th>
            </tr>
          </thead>
          <tbody>
            {list?.codes.length === 0 && (
              <tr>
                <td className="empty" colSpan={4}>
                  {t('qr.none')}
                </td>
              </tr>
            )}
            {list?.codes.map((c) => (
              <tr key={c.tableId} className="selectable qr-row" aria-selected={c.tableId === selectedId} onClick={() => setSelectedId(c.tableId)}>
                <td>
                  <span className="qr-thumb" dangerouslySetInnerHTML={{ __html: svgs[c.token] ?? '' }} />
                </td>
                <td>{c.zoneName}</td>
                <td>
                  <strong>{c.tableLabel}</strong>
                </td>
                <td className="muted">
                  <a href={c.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                    {c.url}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {confirm && selected && (
        <Dialog
          title={`${t('qr.regenerate')} — ${selected.tableLabel}`}
          onClose={() => setConfirm(false)}
          footer={
            <>
              <button className="btn btn-primary" onClick={regenerate}>
                {t('qr.regenerate')}
              </button>
              <button className="btn" onClick={() => setConfirm(false)}>
                {t('common.cancel')}
              </button>
            </>
          }
        >
          <div className="dialog-body">{t('qr.regenerateConfirm')}</div>
        </Dialog>
      )}

      {printing &&
        list &&
        createPortal(
          <div className="print-sheet">
            <div className="print-grid">
              {list.codes.map((c) => (
                <div className="print-card" key={c.tableId}>
                  <div className="print-name">{list.locationName}</div>
                  <div className="print-qr" dangerouslySetInnerHTML={{ __html: svgs[c.token] ?? '' }} />
                  <div className="print-table">
                    {t('qr.colTable')} {c.tableLabel}
                  </div>
                  <div className="print-hint">{t('qr.scan')}</div>
                  <div className="print-zone">{c.zoneName}</div>
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

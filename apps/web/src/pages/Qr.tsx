import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import type { QrList } from '@afrikaisse/core';
import { api } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { LogoAfrikaisse } from '../logo.tsx';
import { isNativeApp, mediaSrc } from '../platform.ts';
import { Dialog, ErrorMessage, Icon, OkMessage } from '../ui.tsx';
import { A4, buildPdf, canvasJpeg, deliverPdf, type PdfImage, type PdfPage } from '../pdf.ts';

type Code = QrList['codes'][number];

/**
 * QR codes des tables, présentés comme les chevalets posés sur les tables :
 * aperçu de chaque carte par zone, affichage en grand (le client scanne l'écran de la tablette),
 * image haute définition pour l'imprimeur, planche A4 de quatre chevalets à découper,
 * PDF A4 à imprimer (quatre chevalets par page, ou une table en grand) : téléchargé sur ordinateur,
 * partagé depuis la tablette (WhatsApp, e-mail, Fichiers) pour l'imprimer ailleurs ;
 * régénération d'un QR compromis.
 */
export function QrTab({ locationId, canManage }: { locationId: string; canManage: boolean }) {
  const { t } = useI18n();
  const [list, setList] = useState<QrList | null>(null);
  const [svgs, setSvgs] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [printing, setPrinting] = useState<Code[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const native = isNativeApp();

  const load = useCallback(async () => {
    setError(null);
    try {
      const next = await api<QrList>('GET', `/locations/${locationId}/qr-codes`);
      const entries = await Promise.all(
        next.codes.map(async (c) => [c.token, await QRCode.toString(c.url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#0b1b2e', light: '#ffffff' } })] as const),
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
      setPrinting(null);
    }, 250);
    return () => clearTimeout(timer);
  }, [printing]);

  const codes = list?.codes ?? [];
  const zones = useMemo(() => {
    const groups = new Map<string, Code[]>();
    for (const c of codes) groups.set(c.zoneName, [...(groups.get(c.zoneName) ?? []), c]);
    return [...groups.entries()];
  }, [codes]);
  const openIndex = codes.findIndex((c) => c.tableId === openId);
  const open = openIndex >= 0 ? codes[openIndex]! : null;
  const card = (c: Code) => <TableCard code={c} list={list!} svg={svgs[c.token]} />;
  const [pdfBusy, setPdfBusy] = useState(false);

  async function makePdf(items: Code[], single: boolean) {
    if (!list || items.length === 0 || pdfBusy) return;
    setPdfBusy(true);
    setError(null);
    try {
      await saveCardsPdf(list, items, single);
    } catch (err) {
      // Partage fermé sans choisir d'application : ce n'est pas une erreur.
      if (!(err instanceof Error && /cancel/i.test(err.message))) setError(err);
    } finally {
      setPdfBusy(false);
    }
  }

  async function regenerate() {
    if (!open) return;
    setError(null);
    try {
      await api('POST', `/tables/${open.tableId}/qr/regenerate`);
      setNotice(`Nouveau QR créé pour la table ${open.tableLabel}.`);
      await load();
    } catch (err) {
      setError(err);
    }
    setConfirm(false);
  }

  return (
    <>
      <div className="toolbar">
        <button className="btn btn-primary" disabled={codes.length === 0 || pdfBusy} onClick={() => void makePdf(codes, false)}>
          <Icon name="pdf" />
          {pdfBusy ? 'Préparation du PDF…' : 'PDF à imprimer'}
        </button>
        {!native && (
          <button className="btn" disabled={codes.length === 0} onClick={() => setPrinting(codes)}>
            <Icon name="print" />
            Imprimer les chevalets
          </button>
        )}
        <button className="btn" onClick={load}>
          <Icon name="refresh" />
          {t('common.refresh')}
        </button>
      </div>

      {(!!error || notice || (list && !list.reachableFromInternet)) && (
        <div className="window-body qr-messages">
          <ErrorMessage error={error} />
          {notice && !error && <OkMessage>{notice}</OkMessage>}
          {list && !list.reachableFromInternet && (
            <div className="msg msg-warn">
              Ces QR mènent à <strong>{list.menuBaseUrl}</strong>, une adresse du réseau du restaurant : le client devrait rejoindre son Wi-Fi.
            </div>
          )}
        </div>
      )}

      <div className="qr-board">
        {list && codes.length === 0 && <p className="empty-state">Aucune table.</p>}
        {zones.map(([zone, items]) => (
          <section key={zone} className="qr-zone">
            <h3 className="qr-zone-title">
              {zone}
              <span className="count-pill">{items.length}</span>
            </h3>
            <div className="qr-grid">
              {items.map((c) => (
                <button key={c.tableId} className="qr-tile" aria-label={`Table ${c.tableLabel} : afficher le chevalet`} onClick={() => setOpenId(c.tableId)}>
                  {card(c)}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      {open && list && (
        <QrPresenter
          code={open}
          position={`${openIndex + 1} / ${codes.length}`}
          onPrev={openIndex > 0 ? () => setOpenId(codes[openIndex - 1]!.tableId) : undefined}
          onNext={openIndex < codes.length - 1 ? () => setOpenId(codes[openIndex + 1]!.tableId) : undefined}
          onClose={() => setOpenId(null)}
          onPrint={native ? undefined : () => setPrinting([open])}
          onPdf={pdfBusy ? undefined : () => void makePdf([open], true)}
          onSaveImage={native ? undefined : () => void saveCardImage(list, open).catch(setError)}
          onRegenerate={canManage ? () => setConfirm(true) : undefined}
        >
          {card(open)}
        </QrPresenter>
      )}

      {confirm && open && (
        <Dialog
          title={`${t('qr.regenerate')} — table ${open.tableLabel}`}
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
          <div className="print-sheet qr-sheet">
            <div className="qr-sheet-grid">
              {printing.map((c) => (
                <div className="qr-sheet-cell" key={c.tableId}>
                  {card(c)}
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/** Le chevalet tel qu'il sera posé sur la table (format A6 : 105 × 148 mm). Tailles en em : même dessin à toute échelle. */
function TableCard({ code, list, svg }: { code: Code; list: QrList; svg: string | undefined }) {
  const place = list.organizationName !== list.locationName ? list.organizationName : null;
  return (
    <div className="table-card">
      <div className="table-card-head">
        {list.logoUrl && <img className="table-card-logo" src={mediaSrc(list.logoUrl)} alt="" />}
        <span className="table-card-name">{list.locationName}</span>
        {place && <span className="table-card-place">{place}</span>}
      </div>
      <div className="table-card-body">
        <div className="table-card-qr" dangerouslySetInnerHTML={{ __html: svg ?? '' }} />
        <p className="table-card-call">
          Scannez pour voir le menu
          <br />
          et commander
        </p>
        <div className="table-card-table">
          <span>Table</span>
          <strong>{code.tableLabel}</strong>
        </div>
      </div>
      <div className="table-card-foot">
        <span>{list.reachableFromInternet ? 'Sans application · sans Wi-Fi' : 'Sans application'}</span>
        <span className="table-card-brand">
          <LogoAfrikaisse />
          AfriKaisse
        </span>
      </div>
    </div>
  );
}

/** Chevalet en grand : le client scanne directement l'écran ; flèches pour passer d'une table à l'autre. */
function QrPresenter({
  code,
  position,
  children,
  onPrev,
  onNext,
  onClose,
  onPrint,
  onPdf,
  onSaveImage,
  onRegenerate,
}: {
  code: Code;
  position: string;
  children: React.ReactNode;
  onPrev?: () => void;
  onNext?: () => void;
  onClose: () => void;
  onPrint?: () => void;
  onPdf?: () => void;
  onSaveImage?: () => void;
  onRegenerate?: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') onPrev?.();
      if (e.key === 'ArrowRight') onNext?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);

  return createPortal(
    <div className="qr-presenter" role="dialog" aria-modal="true" aria-label={`Chevalet de la table ${code.tableLabel}`}>
      <header className="qr-presenter-bar">
        <div className="qr-presenter-title">
          <strong>Table {code.tableLabel}</strong>
          <span>
            {code.zoneName} · {position}
          </span>
        </div>
        <div className="qr-presenter-actions">
          {onPdf && (
            <button className="btn" onClick={onPdf}>
              <Icon name="pdf" />
              PDF
            </button>
          )}
          {onSaveImage && (
            <button className="btn" onClick={onSaveImage}>
              <Icon name="image" />
              Enregistrer l'image
            </button>
          )}
          {onPrint && (
            <button className="btn" onClick={onPrint}>
              <Icon name="print" />
              Imprimer
            </button>
          )}
          {onRegenerate && (
            <button className="btn" onClick={onRegenerate}>
              <Icon name="refresh" />
              Régénérer
            </button>
          )}
          <button className="icon-btn" aria-label="Fermer" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
      </header>
      <div className="qr-presenter-stage">
        <button className="qr-nav" aria-label="Table précédente" disabled={!onPrev} onClick={onPrev}>
          <Icon name="left" />
        </button>
        <div className="qr-presenter-card">{children}</div>
        <button className="qr-nav" aria-label="Table suivante" disabled={!onNext} onClick={onNext}>
          <Icon name="right" />
        </button>
      </div>
      <p className="qr-presenter-link">
        <a href={code.url} target="_blank" rel="noopener noreferrer">
          {code.url}
        </a>
      </p>
    </div>,
    document.body,
  );
}

/** Chevalet dessiné en A6 à 300 dpi (1240 × 1748 px) : image pour un imprimeur, pages du PDF. */
async function drawCard(list: QrList, code: Code): Promise<HTMLCanvasElement> {
  const W = 1240;
  const H = 1748;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  const font = "'Segoe UI', Roboto, 'Noto Sans', Arial, sans-serif";
  const center = (text: string, y: number, weight: number, size: number, color: string, max = W - 160) => {
    let s = size;
    g.font = `${weight} ${s}px ${font}`;
    while (g.measureText(text).width > max && s > 24) g.font = `${weight} ${(s -= 2)}px ${font}`;
    g.fillStyle = color;
    g.fillText(text, W / 2, y);
  };
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);

  const place = list.organizationName !== list.locationName ? list.organizationName : null;
  g.fillStyle = '#0f2a4a';
  g.fillRect(0, 0, W, 290);
  center(list.locationName, place ? 118 : 145, 700, 86, '#ffffff');
  if (place) center(place, 208, 500, 46, 'rgba(255,255,255,0.72)');

  const qr = document.createElement('canvas');
  await QRCode.toCanvas(qr, code.url, { width: 740, margin: 0, errorCorrectionLevel: 'M', color: { dark: '#0b1b2e', light: '#ffffff' } });
  const frame = 860;
  const fx = (W - frame) / 2;
  const fy = 360;
  g.strokeStyle = '#dce1e7';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(fx + 44, fy);
  g.arcTo(fx + frame, fy, fx + frame, fy + frame, 44);
  g.arcTo(fx + frame, fy + frame, fx, fy + frame, 44);
  g.arcTo(fx, fy + frame, fx, fy, 44);
  g.arcTo(fx, fy, fx + frame, fy, 44);
  g.closePath();
  g.stroke();
  g.drawImage(qr, (W - 740) / 2, fy + 60);

  center('Scannez pour voir le menu', 1305, 600, 56, '#111a27');
  center('et commander', 1375, 600, 56, '#111a27');
  center('TABLE', 1462, 600, 38, '#647184');
  center(code.tableLabel, 1545, 700, 112, '#0f2a4a');

  g.fillStyle = '#e9edf1';
  g.fillRect(90, 1622, W - 180, 3);
  g.textAlign = 'left';
  g.font = `500 36px ${font}`;
  g.fillStyle = '#647184';
  g.fillText(list.reachableFromInternet ? 'Sans application · sans Wi-Fi' : 'Sans application', 90, 1684);
  g.textAlign = 'right';
  g.font = `700 38px ${font}`;
  g.fillStyle = '#0f2a4a';
  g.fillText('AfriKaisse', W - 90, 1684);

  return canvas;
}

/** Image PNG du chevalet, pour un imprimeur ou un partage. */
async function saveCardImage(list: QrList, code: Code) {
  const canvas = await drawCard(list, code);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Image impossible à créer."))), 'image/png'));
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `chevalet-table-${code.tableLabel}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const CARD_RATIO = 1748 / 1240;
const fileName = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9.-]+/g, '-');

/**
 * PDF A4 : toutes les tables, quatre chevalets par page séparés par des traits de coupe ;
 * une seule table, son chevalet en grand au centre de la page.
 */
async function saveCardsPdf(list: QrList, codes: Code[], single: boolean) {
  const pages: PdfPage[] = [];
  const image = async (code: Code, x: number, y: number, width: number, height: number): Promise<PdfImage> => {
    const canvas = await drawCard(list, code);
    return { jpeg: await canvasJpeg(canvas), pixelWidth: canvas.width, pixelHeight: canvas.height, x, y, width, height };
  };
  if (single) {
    const width = A4.width - 120;
    const height = width * CARD_RATIO;
    for (const code of codes) pages.push({ images: [await image(code, (A4.width - width) / 2, (A4.height - height) / 2, width, height)] });
  } else {
    const margin = 24;
    const cellW = (A4.width - 2 * margin) / 2;
    const cellH = (A4.height - 2 * margin) / 2;
    const width = Math.min(cellW - 16, (cellH - 16) / CARD_RATIO);
    const height = width * CARD_RATIO;
    for (let first = 0; first < codes.length; first += 4) {
      const images: PdfImage[] = [];
      const group = codes.slice(first, first + 4);
      for (let k = 0; k < group.length; k++) {
        const cx = margin + cellW * (k % 2) + cellW / 2;
        const cy = A4.height - margin - cellH * Math.floor(k / 2) - cellH / 2;
        images.push(await image(group[k]!, cx - width / 2, cy - height / 2, width, height));
      }
      pages.push({
        images,
        cuts: [
          { x1: A4.width / 2, y1: margin / 2, x2: A4.width / 2, y2: A4.height - margin / 2 },
          { x1: margin / 2, y1: A4.height / 2, x2: A4.width - margin / 2, y2: A4.height / 2 },
        ],
      });
    }
  }
  const one = single && codes.length === 1 ? codes[0]! : null;
  const name = one ? `chevalet-table-${one.tableLabel}.pdf` : `chevalets-${list.locationName}.pdf`;
  await deliverPdf(buildPdf(pages), fileName(name), one ? `Chevalet table ${one.tableLabel}` : `Chevalets QR — ${list.locationName}`);
}

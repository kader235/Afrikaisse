import QRCode from 'qrcode';

/**
 * Chevalets QR « photo » (présentoir de table) : grande photo d'un plat, nom du restaurant dans un badge
 * blanc, QR dans un cadre bleu « Menu · Table », appel à scanner sur fond bleu.
 * Deux tailles, même dessin en unités proportionnelles à la largeur :
 * - « photo » : 1240 × 1748 px (A6 à 300 dpi) ;
 * - « photo-petit » : 760 × 1076 px (environ 6,4 × 9 cm à 300 dpi), neuf par page A4.
 *
 * Les photos sont lues en octets puis dessinées depuis une adresse locale (blob:) : une image chargée
 * directement depuis le serveur « salirait » le canevas dans l'application tablette (autre origine),
 * et ni l'image ni le PDF ne pourraient plus être produits.
 */

export type CardModel = 'classique' | 'photo' | 'photo-petit';

export const CARD_MODELS: { id: CardModel; label: string; hint: string }[] = [
  { id: 'photo', label: 'Photo', hint: 'Grand chevalet avec la photo d’un plat · 4 par page A4' },
  { id: 'photo-petit', label: 'Photo petit', hint: 'Petit chevalet avec photo · 9 par page A4' },
  { id: 'classique', label: 'Classique', hint: 'Chevalet sobre sans photo · 4 par page A4' },
];

export const PHOTO_SIZE: Record<Exclude<CardModel, 'classique'>, { w: number; h: number; perRow: number }> = {
  photo: { w: 1240, h: 1748, perRow: 2 },
  'photo-petit': { w: 760, h: 1076, perRow: 3 },
};

const FONT = "'Plus Jakarta Sans', 'Segoe UI', Roboto, Arial, sans-serif";

export async function loadImage(src: string): Promise<HTMLImageElement> {
  const res = await fetch(src);
  if (!res.ok) throw new Error('Photo introuvable.');
  const url = URL.createObjectURL(await res.blob());
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

let fontReady: Promise<unknown> | null = null;
const ensureFont = () => (fontReady ??= document.fonts?.load(`800 40px "Plus Jakarta Sans"`).catch(() => undefined) ?? Promise.resolve());

function rounded(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Texte centré, réduit jusqu'à tenir dans la largeur donnée. */
function fit(g: CanvasRenderingContext2D, text: string, x: number, y: number, weight: number, size: number, max: number) {
  let s = size;
  g.font = `${weight} ${s}px ${FONT}`;
  while (g.measureText(text).width > max && s > size * 0.55) g.font = `${weight} ${(s -= size * 0.04)}px ${FONT}`;
  g.fillText(text, x, y);
}

export interface PhotoCardData {
  url: string;
  restaurant: string;
  table: string;
  photo: HTMLImageElement | null;
}

/** Dessine un chevalet photo ; `scale` réduit la définition (aperçus à l'écran). */
export async function drawPhotoCard(model: Exclude<CardModel, 'classique'>, data: PhotoCardData, scale = 1): Promise<HTMLCanvasElement> {
  await ensureFont();
  const small = model === 'photo-petit';
  const W = Math.round(PHOTO_SIZE[model].w * scale);
  const H = Math.round(PHOTO_SIZE[model].h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  const u = W / 100;
  g.textAlign = 'center';
  g.textBaseline = 'middle';

  // Photo plein cadre sur le haut, recadrée ; sans photo, un bleu nuit uni.
  const photoH = H * 0.56;
  if (data.photo) {
    const k = Math.max(W / data.photo.width, photoH / data.photo.height);
    g.drawImage(data.photo, (W - data.photo.width * k) / 2, (photoH - data.photo.height * k) / 2, data.photo.width * k, data.photo.height * k);
  } else {
    g.fillStyle = '#0F2044';
    g.fillRect(0, 0, W, photoH);
  }

  // Panneau bleu au bord supérieur en courbe douce.
  const top = H * 0.5;
  const grad = g.createLinearGradient(0, top, 0, H);
  grad.addColorStop(0, '#1D4ED8');
  grad.addColorStop(1, '#0F2044');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(0, top + 6 * u);
  g.quadraticCurveTo(W / 2, top - 6 * u, W, top + 6 * u);
  g.lineTo(W, H);
  g.lineTo(0, H);
  g.closePath();
  g.fill();

  // Badge du restaurant accroché en haut.
  const badgeSize = (small ? 6.2 : 5.4) * u;
  g.font = `800 ${badgeSize}px ${FONT}`;
  const badgeW = Math.min(W * 0.78, g.measureText(data.restaurant).width + 12 * u);
  const badgeH = (small ? 13 : 11.5) * u;
  g.save();
  g.shadowColor = 'rgba(0,0,0,.25)';
  g.shadowBlur = 3 * u;
  g.shadowOffsetY = u;
  rounded(g, (W - badgeW) / 2, -4 * u, badgeW, badgeH + 4 * u, 4.5 * u);
  g.fillStyle = '#ffffff';
  g.fill();
  g.restore();
  g.fillStyle = '#0F2044';
  fit(g, data.restaurant, W / 2, badgeH / 2, 800, badgeSize, badgeW - 7 * u);

  // Cadre du QR, à cheval sur la photo et le panneau.
  const frameW = (small ? 62 : 58) * u;
  const labelH = (small ? 12 : 10) * u;
  const frameX = (W - frameW) / 2;
  const frameY = H * (small ? 0.27 : 0.25);
  g.save();
  g.shadowColor = 'rgba(0,0,0,.35)';
  g.shadowBlur = 5 * u;
  g.shadowOffsetY = 1.5 * u;
  rounded(g, frameX, frameY, frameW, frameW + labelH, 6 * u);
  g.fillStyle = '#1D4ED8';
  g.fill();
  g.restore();
  rounded(g, frameX + 3 * u, frameY + 3 * u, frameW - 6 * u, frameW - 6 * u, 4 * u);
  g.fillStyle = '#ffffff';
  g.fill();
  const qrSize = Math.round(frameW - 14 * u);
  const qr = document.createElement('canvas');
  await QRCode.toCanvas(qr, data.url, { width: qrSize, margin: 0, errorCorrectionLevel: 'M', color: { dark: '#0b1b2e', light: '#ffffff' } });
  g.drawImage(qr, (W - qrSize) / 2, frameY + 7 * u, qrSize, qrSize);
  g.fillStyle = '#ffffff';
  fit(g, `MENU · TABLE ${data.table}`, W / 2, frameY + frameW + labelH / 2 - 0.5 * u, 800, (small ? 5.6 : 4.8) * u, frameW - 8 * u);

  // Appel à scanner.
  const textY = frameY + frameW + labelH + (small ? 10 : 9) * u;
  fit(g, 'Scannez le QR code', W / 2, textY, 800, (small ? 6.6 : 6.2) * u, W - 10 * u);
  fit(g, 'et découvrez notre menu', W / 2, textY + (small ? 8 : 7.6) * u, 800, (small ? 6.6 : 6.2) * u, W - 10 * u);
  if (!small) {
    const hint = 'Avec l’appareil photo du téléphone ou Google Lens';
    g.font = `600 ${3 * u}px ${FONT}`;
    const hw = g.measureText(hint).width + 8 * u;
    rounded(g, (W - hw) / 2, textY + 12.5 * u, hw, 6.5 * u, 3.25 * u);
    g.fillStyle = 'rgba(255,255,255,.14)';
    g.fill();
    g.fillStyle = 'rgba(255,255,255,.92)';
    g.fillText(hint, W / 2, textY + 15.8 * u);
  }
  g.font = `700 ${(small ? 3.4 : 2.8) * u}px ${FONT}`;
  g.fillStyle = 'rgba(255,255,255,.7)';
  g.fillText('AfriKaisse', W / 2, H - (small ? 4 : 3.5) * u);
  return canvas;
}

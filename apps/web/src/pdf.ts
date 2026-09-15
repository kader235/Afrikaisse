import { Capacitor } from '@capacitor/core';

/**
 * PDF minimal, écrit à la main : des pages A4 qui portent des images JPEG (cartes QR dessinées sur
 * un canevas) et des traits de coupe. Pas de bibliothèque : quelques centaines d'octets de structure,
 * lisibles par tous les lecteurs et imprimantes.
 *
 * Remise du fichier :
 * - navigateur : téléchargement ;
 * - tablette (Capacitor) : un lien de téléchargement ne fait rien dans la WebView, le PDF est écrit dans
 *   le cache de l'application puis proposé par le partage Android (enregistrer, WhatsApp, e-mail, imprimer).
 */

export const A4 = { width: 595.28, height: 841.89 };

export interface PdfImage {
  /** JPEG complet (octets). */
  jpeg: Uint8Array;
  pixelWidth: number;
  pixelHeight: number;
  /** Position et taille sur la page, en points, origine en bas à gauche. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PdfPage {
  images: PdfImage[];
  /** Traits de coupe, en pointillés gris. */
  cuts?: PdfLine[];
}

const ascii = (s: string) => new TextEncoder().encode(s);
const n = (v: number) => (Math.round(v * 100) / 100).toString();

/** Assemble le fichier PDF (1.4). */
export function buildPdf(pages: PdfPage[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (part: Uint8Array | string) => {
    const bytes = typeof part === 'string' ? ascii(part) : part;
    chunks.push(bytes);
    size += bytes.length;
  };
  // Numérotation : 1 catalogue, 2 arbre des pages, puis pour chaque page : page, contenu, images.
  let next = 3;
  const plan = pages.map((page) => {
    const pageId = next++;
    const contentId = next++;
    const imageIds = page.images.map(() => next++);
    return { page, pageId, contentId, imageIds };
  });
  const object = (id: number, body: () => void) => {
    offsets[id] = size;
    push(`${id} 0 obj\n`);
    body();
    push('\nendobj\n');
  };

  push('%PDF-1.4\n%âãÏÓ\n');
  object(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  object(2, () => push(`<< /Type /Pages /Count ${plan.length} /Kids [${plan.map((p) => `${p.pageId} 0 R`).join(' ')}] >>`));

  for (const { page, pageId, contentId, imageIds } of plan) {
    const resources = imageIds.map((id, i) => `/Im${i} ${id} 0 R`).join(' ');
    object(pageId, () =>
      push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(A4.width)} ${n(A4.height)}] /Resources << /XObject << ${resources} >> >> /Contents ${contentId} 0 R >>`),
    );
    const drawing = [
      ...page.images.map((img, i) => `q ${n(img.width)} 0 0 ${n(img.height)} ${n(img.x)} ${n(img.y)} cm /Im${i} Do Q`),
      ...(page.cuts?.length ? ['q 0.6 G 0.6 w [4 3] 0 d', ...page.cuts.map((c) => `${n(c.x1)} ${n(c.y1)} m ${n(c.x2)} ${n(c.y2)} l S`), 'Q'] : []),
    ].join('\n');
    const content = ascii(drawing);
    object(contentId, () => {
      push(`<< /Length ${content.length} >>\nstream\n`);
      push(content);
      push('\nendstream');
    });
    page.images.forEach((img, i) =>
      object(imageIds[i]!, () => {
        push(`<< /Type /XObject /Subtype /Image /Width ${img.pixelWidth} /Height ${img.pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`);
        push(img.jpeg);
        push('\nendstream');
      }),
    );
  }

  const xref = size;
  const count = next;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id++) table += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Canevas → JPEG (octets), qualité suffisante pour l'impression d'un QR. */
export async function canvasJpeg(canvas: HTMLCanvasElement, quality = 0.92): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Image impossible à créer.'))), 'image/jpeg', quality));
  return new Uint8Array(await blob.arrayBuffer());
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(binary);
}

/** Remet le PDF à l'utilisateur : téléchargement (navigateur) ou partage Android (tablette). */
export async function deliverPdf(bytes: Uint8Array, filename: string, title: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const [{ Directory, Filesystem }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
    const written = await Filesystem.writeFile({ path: filename, data: toBase64(bytes), directory: Directory.Cache });
    await Share.share({ title, dialogTitle: title, url: written.uri });
    return;
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

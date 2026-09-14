import { IMAGE_MAX_BYTES } from '@afrikaisse/core';
import { UserFacingError } from './api.ts';

export interface CompressedImage {
  contentType: 'image/webp' | 'image/jpeg';
  dataBase64: string;
  width: number;
  height: number;
  size: number;
}

/**
 * Réduit une photo sur l'appareil avant l'envoi : une photo de téléphone (3 à 8 Mo)
 * devient ~150 Ko. Moins de données mobiles pour le restaurant, un menu client rapide
 * en 3G, et aucune bibliothèque d'image native côté serveur.
 */
export async function compressImage(file: File, maxSide = 1280, quality = 0.82): Promise<CompressedImage> {
  if (!file.type.startsWith('image/')) throw new UserFacingError('Choisissez une photo (JPEG, PNG ou WebP).');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new UserFacingError('Cette photo ne peut pas être lue.'));
      image.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext('2d');
    if (!g) throw new UserFacingError('Cet appareil ne permet pas de préparer la photo.');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, width, height);
    g.drawImage(img, 0, 0, width, height);

    // WebP quand l'appareil sait l'écrire, sinon JPEG ; qualité réduite si c'est encore trop lourd.
    const attempts: [CompressedImage['contentType'], number][] = [
      ['image/webp', quality],
      ['image/jpeg', quality],
      ['image/jpeg', 0.6],
    ];
    for (const [type, q] of attempts) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, q));
      if (!blob || blob.type !== type || blob.size > IMAGE_MAX_BYTES) continue;
      return { contentType: type, dataBase64: await toBase64(blob), width, height, size: blob.size };
    }
    throw new UserFacingError('Photo trop lourde, même après compression.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

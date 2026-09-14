import type { ImageType } from '@afrikaisse/core';

export interface ImageInfo {
  contentType: ImageType;
  width: number;
  height: number;
}

const ascii = (b: Uint8Array, start: number, length: number) => String.fromCharCode(...b.subarray(start, start + length));

/**
 * Identifie une image par sa signature et lit ses dimensions, sans la décoder.
 * Le serveur ne fait pas confiance au type annoncé par l'appareil : un fichier qui
 * n'est pas une vraie image JPEG, PNG ou WebP est refusé.
 * (Aucune bibliothèque native : o2switch n'a pas de compilateur.)
 */
export function inspectImage(b: Uint8Array): ImageInfo | null {
  // PNG : signature de 8 octets, puis le bloc IHDR (largeur, hauteur en gros-boutiste).
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG' && ascii(b, 12, 4) === 'IHDR') {
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return valid({ contentType: 'image/png', width: view.getUint32(16), height: view.getUint32(20) });
  }

  // JPEG : FF D8, puis segments jusqu'à un SOFn qui porte hauteur et largeur.
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1]!;
      if (marker === 0xff) {
        i += 1;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const length = (b[i + 2]! << 8) | b[i + 3]!;
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        return valid({ contentType: 'image/jpeg', height: (b[i + 5]! << 8) | b[i + 6]!, width: (b[i + 7]! << 8) | b[i + 8]! });
      }
      if (length < 2) return null;
      i += 2 + length;
    }
    return null;
  }

  // WebP : RIFF….WEBP puis un bloc VP8X, VP8 (avec perte) ou VP8L (sans perte).
  if (b.length >= 30 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    const chunk = ascii(b, 12, 4);
    if (chunk === 'VP8X') {
      return valid({
        contentType: 'image/webp',
        width: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)),
        height: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)),
      });
    }
    if (chunk === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
      return valid({ contentType: 'image/webp', width: (b[26]! | (b[27]! << 8)) & 0x3fff, height: (b[28]! | (b[29]! << 8)) & 0x3fff });
    }
    if (chunk === 'VP8L' && b[20] === 0x2f) {
      const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
      return valid({ contentType: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 });
    }
  }
  return null;
}

function valid(info: ImageInfo): ImageInfo | null {
  return info.width > 0 && info.height > 0 ? info : null;
}

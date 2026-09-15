import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

/**
 * Icônes de l'application installable du menu client (§49) : `node apps/web/scripts/menu-icons.mjs`.
 * Même dessin que l'icône de la tablette (apps/tablet/android/dessiner-identite.py) : aplat bleu
 * #1D4D82 et ticket de caisse blanc. PNG écrits en JavaScript pur (zlib de Node) : ni module
 * natif, ni Python, ni Pillow. Les fichiers produits sont versionnés dans public/m/.
 */

const ici = dirname(fileURLToPath(import.meta.url));
const sortie = join(ici, '..', 'public', 'm');
const BLEU = [29, 77, 130];
const BLANC = [255, 255, 255];
const SUR = 4; // 16 échantillons par pixel : bords lissés

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function png(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 8 bits par canal
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function insidePolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function nearSegment(x, y, [ax, ay], [bx, by], r) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 <= r * r;
}
function insideRoundedRect(x, y, size, radius) {
  if (radius === 0) return x >= 0 && y >= 0 && x <= size && y <= size;
  const cx = Math.min(Math.max(x, radius), size - radius);
  const cy = Math.min(Math.max(y, radius), size - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
}

/** Couleur d'un point : fond, ticket, traits du ticket (repère 32 × 32 du logo). */
function painter(size, { radius, ticketHeight }) {
  const k = ticketHeight / 20;
  const p = (x, y) => [size / 2 + (x - 16) * k, size / 2 + (y - 16) * k];
  const ticket = [p(9, 6), p(23, 6), p(23, 26), p(20.67, 24.25), p(18.33, 26), p(16, 24.25), p(13.67, 26), p(11.33, 24.25), p(9, 26)];
  const lines = [
    [p(12.5, 12), p(19.5, 12)],
    [p(12.5, 16), p(17, 16)],
  ];
  const stroke = 0.9 * k;
  return (x, y) => {
    if (!insideRoundedRect(x, y, size, radius)) return null;
    if (insidePolygon(x, y, ticket)) return lines.some(([a, b]) => nearSegment(x, y, a, b, stroke)) ? BLEU : BLANC;
    return BLEU;
  };
}

function render(size, options) {
  const paint = painter(size, options);
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SUR; sy++) {
        for (let sx = 0; sx < SUR; sx++) {
          const c = paint(px + (sx + 0.5) / SUR, py + (sy + 0.5) / SUR);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          a += 1;
        }
      }
      const o = (py * size + px) * 4;
      if (a > 0) {
        rgba[o] = Math.round(r / a);
        rgba[o + 1] = Math.round(g / a);
        rgba[o + 2] = Math.round(b / a);
        rgba[o + 3] = Math.round((255 * a) / (SUR * SUR));
      }
    }
  }
  return png(size, rgba);
}

mkdirSync(sortie, { recursive: true });
const fichiers = {
  'icon-192.png': render(192, { radius: 192 * 0.18, ticketHeight: 192 * 0.62 }),
  'icon-512.png': render(512, { radius: 512 * 0.18, ticketHeight: 512 * 0.62 }),
  // « maskable » : plein cadre, dessin dans la zone sûre (cercle de 80 %).
  'icon-maskable-512.png': render(512, { radius: 0, ticketHeight: 512 * 0.46 }),
};
for (const [nom, octets] of Object.entries(fichiers)) {
  writeFileSync(join(sortie, nom), octets);
  console.log(`${nom} : ${octets.length} octets`);
}

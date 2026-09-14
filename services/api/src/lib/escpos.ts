import { connect } from 'node:net';

/**
 * Tickets ESC/POS pour les imprimantes thermiques réseau (Epson TM-T20, Xprinter, Sunmi…).
 * Le texte est encodé en page de codes 850 : la plupart des imprimantes vendues en Afrique
 * francophone l'ont d'origine, et elle couvre tous les accents du français.
 */

const ESC = 0x1b;
const GS = 0x1d;

/** Caractères au-delà de l'ASCII pris en charge par la page 850 (le reste devient « ? »). */
const CP850: Record<string, number> = {
  Ç: 0x80, ü: 0x81, é: 0x82, â: 0x83, ä: 0x84, à: 0x85, å: 0x86, ç: 0x87, ê: 0x88, ë: 0x89, è: 0x8a, ï: 0x8b, î: 0x8c, ì: 0x8d, Ä: 0x8e, Å: 0x8f,
  É: 0x90, æ: 0x91, Æ: 0x92, ô: 0x93, ö: 0x94, ò: 0x95, û: 0x96, ù: 0x97, ÿ: 0x98, Ö: 0x99, Ü: 0x9a, ø: 0x9b, '£': 0x9c, Ø: 0x9d, '×': 0x9e,
  á: 0xa0, í: 0xa1, ó: 0xa2, ú: 0xa3, ñ: 0xa4, Ñ: 0xa5, ª: 0xa6, º: 0xa7, '¿': 0xa8, '®': 0xa9, '½': 0xab, '¼': 0xac, '¡': 0xad, '«': 0xae, '»': 0xaf,
  Á: 0xb5, Â: 0xb6, À: 0xb7, '©': 0xb8, 'ã': 0xc6, 'Ã': 0xc7, 'ð': 0xd0, Ê: 0xd2, Ë: 0xd3, È: 0xd4, Í: 0xd6, Î: 0xd7, Ï: 0xd8, Ì: 0xde,
  Ó: 0xe0, ß: 0xe1, Ô: 0xe2, Ò: 0xe3, õ: 0xe4, Õ: 0xe5, µ: 0xe6, Ú: 0xe9, Û: 0xea, Ù: 0xeb, ý: 0xec, Ý: 0xed, '°': 0xf8, '·': 0xfa,
};

/** Espaces fines et insécables (formatage des montants en français), tirets typographiques, guillemets. */
const PLAIN: Record<string, string> = { ' ': ' ', ' ': ' ', '–': '-', '—': '-', '’': "'", '‘': "'", '“': '"', '”': '"', '…': '...', 'œ': 'oe', 'Œ': 'OE', '€': 'EUR' };

export function encodeCp850(text: string): number[] {
  const bytes: number[] = [];
  for (const raw of text) {
    const ch = PLAIN[raw] ?? raw;
    for (const c of ch) {
      const code = c.charCodeAt(0);
      if (code < 0x80) bytes.push(code);
      else bytes.push(CP850[c] ?? 0x3f);
    }
  }
  return bytes;
}

export type Align = 'left' | 'center' | 'right';

/** Constructeur de ticket : largeur en caractères (48 en 80 mm, 32 en 58 mm). */
export class Ticket {
  private bytes: number[] = [ESC, 0x40, ESC, 0x74, 2]; // initialisation, page de codes 850

  constructor(readonly width: 48 | 32 = 48) {}

  align(a: Align) {
    this.bytes.push(ESC, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2);
    return this;
  }

  bold(on: boolean) {
    this.bytes.push(ESC, 0x45, on ? 1 : 0);
    return this;
  }

  /** Double hauteur et largeur : numéros de commande lisibles à distance en cuisine. */
  big(on: boolean) {
    this.bytes.push(GS, 0x21, on ? 0x11 : 0x00);
    return this;
  }

  text(line: string) {
    this.bytes.push(...encodeCp850(line), 0x0a);
    return this;
  }

  /** Texte coupé sur plusieurs lignes à la largeur du ticket (divisée par 2 en double taille). */
  wrap(line: string, width = this.width) {
    for (const part of wrapText(line, width)) this.text(part);
    return this;
  }

  /** Libellé à gauche, valeur à droite. */
  row(left: string, right: string) {
    const room = this.width - right.length - 1;
    const lines = wrapText(left, Math.max(8, room));
    lines.forEach((l, i) => this.text(i === lines.length - 1 ? `${l.padEnd(room)} ${right}` : l));
    return this;
  }

  rule(char = '-') {
    return this.text(char.repeat(this.width));
  }

  feed(lines = 1) {
    this.bytes.push(ESC, 0x64, lines);
    return this;
  }

  cut() {
    this.bytes.push(GS, 0x56, 0x42, 0x03); // avance puis coupe partielle
    return this;
  }

  build(): Buffer {
    return Buffer.from(this.bytes);
  }
}

export function wrapText(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (word.length > width) {
      if (current) lines.push(current);
      for (let i = 0; i < word.length; i += width) lines.push(word.slice(i, i + width));
      current = lines.pop() ?? '';
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length > width) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  if (current || lines.length === 0) lines.push(current);
  return lines;
}

/** Envoi brut au port 9100 de l'imprimante. Rejette si elle ne répond pas dans le délai. */
export function sendToPrinter(host: string, port: number, data: Buffer, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };
    socket.setTimeout(timeoutMs, () => finish(new Error(`Imprimante ${host}:${port} injoignable (délai dépassé).`)));
    socket.once('error', (err) => finish(new Error(`Imprimante ${host}:${port} injoignable : ${err.message}`)));
    socket.once('connect', () => socket.end(data, () => finish()));
  });
}

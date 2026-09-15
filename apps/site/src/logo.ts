/**
 * Logo AfriKaisse (même dessin que apps/web/src/logo.tsx) : le continent, un ticket de caisse et une pile
 * de pièces. `id` rend les dégradés uniques quand le logo figure deux fois dans la page (bandeau, pied).
 */
export function logoSvg(id: string): string {
  const or = `url(#afk-or-${id})`;
  const bleu = `url(#afk-bleu-${id})`;
  return (
    `<svg class="logo" viewBox="0 0 64 64" aria-hidden="true" focusable="false">` +
    `<defs><linearGradient id="afk-or-${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f2d38c"/><stop offset="1" stop-color="#b8862f"/></linearGradient>` +
    `<linearGradient id="afk-bleu-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a6fc4"/><stop offset="1" stop-color="#123f78"/></linearGradient></defs>` +
    `<path d="M14 8L26 6L40 7L45 10L49 18L53 24L60 25L55 32L50 38L49 45L44 52L39 58L34 58L31 50L29 42L27 35L23 32L16 32L9 29L4 23L6 16Z" fill="${bleu}" stroke="${or}" stroke-width="2" stroke-linejoin="round"/>` +
    `<ellipse cx="56" cy="44" rx="1.7" ry="3.8" fill="${or}" transform="rotate(20 56 44)"/>` +
    `<g transform="rotate(-8 34 28)"><path d="M24 12h18v28l-3-2-3 2-3-2-3 2-3-2-3 2z" fill="#ffffff" stroke="${or}" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<path d="M28 19h10M28 24h10M28 29h6" stroke="#123f78" stroke-width="2" stroke-linecap="round"/></g>` +
    `<g stroke="#8a6320" stroke-width="0.8"><path d="M43 55v3a7 2.6 0 0 0 14 0v-3" fill="${or}"/><ellipse cx="50" cy="55" rx="7" ry="2.6" fill="${or}"/>` +
    `<path d="M43 51.5v3.5a7 2.6 0 0 0 14 0v-3.5" fill="${or}"/><ellipse cx="50" cy="51.5" rx="7" ry="2.6" fill="${or}"/>` +
    `<path d="M43 48v3.5a7 2.6 0 0 0 14 0V48" fill="${or}"/><ellipse cx="50" cy="48" rx="7" ry="2.6" fill="#f3d892"/></g>` +
    `</svg>`
  );
}

"""Icône Windows d'AfriKaisse (.ico multi-tailles), mêmes aplats que l'application tablette.

Usage : python dessiner-icone.py <fichier.ico>
"""

from __future__ import annotations

import sys

from PIL import Image, ImageDraw

BLEU = (29, 77, 130, 255)  # #1D4D82, barre d'application
BLANC = (255, 255, 255, 255)
TAILLES = [16, 24, 32, 48, 64, 128, 256]


def dessiner(taille: int) -> Image.Image:
    k = 4  # dessin agrandi puis réduit : bords nets
    t = taille * k
    image = Image.new("RGBA", (t, t), (0, 0, 0, 0))
    d = ImageDraw.Draw(image)
    d.rounded_rectangle([0, 0, t - 1, t - 1], radius=t * 0.18, fill=BLEU)
    # Le ticket de caisse du logo (repère 32 × 32).
    s = t / 32

    def p(x: float, y: float) -> tuple[float, float]:
        return (x * s, y * s)

    d.polygon([p(9, 6), p(23, 6), p(23, 26), p(20.67, 24.25), p(18.33, 26), p(16, 24.25), p(13.67, 26), p(11.33, 24.25), p(9, 26)], fill=BLANC)
    largeur = max(1, round(1.8 * s))
    for x1, y1, x2, y2 in [(12.5, 12, 19.5, 12), (12.5, 16, 17, 16)]:
        d.line([p(x1, y1), p(x2, y2)], fill=BLEU, width=largeur)
    return image.resize((taille, taille), Image.LANCZOS)


if __name__ == "__main__":
    sortie = sys.argv[1] if len(sys.argv) > 1 else "afrikaisse.ico"
    grande = dessiner(256)
    grande.save(sortie, format="ICO", sizes=[(n, n) for n in TAILLES], append_images=[dessiner(n) for n in TAILLES[:-1]])
    print(f"Icône écrite : {sortie}")

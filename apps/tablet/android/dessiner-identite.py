"""Dessine l'icône et l'écran de lancement de la tablette AfriKaisse.

Aplats, sans dégradé (charte « logiciel de gestion ») : le bleu de la barre
d'application et le ticket de caisse blanc du logo. Chaque image est régénérée
à la taille exacte du fichier produit par Capacitor, pour toutes les densités.

Usage : python dessiner-identite.py
"""

from __future__ import annotations

import pathlib

from PIL import Image, ImageDraw, ImageFont

RES = pathlib.Path(__file__).parent / "app" / "src" / "main" / "res"
BLEU = (29, 77, 130, 255)  # #1D4D82, barre d'application
BLANC = (255, 255, 255, 255)
SURECHANTILLON = 4  # dessin 4x plus grand puis réduit : bords nets sans crénelage

POLICES = [
    "C:/Windows/Fonts/segoeuisb.ttf",
    "C:/Windows/Fonts/segoeui.ttf",
    "C:/Windows/Fonts/arial.ttf",
]


def ticket(dessin: ImageDraw.ImageDraw, cx: float, cy: float, hauteur: float, fond, trait) -> None:
    """Le ticket du logo, repris du SVG (repère 32 × 32, corps de 20 de haut)."""
    k = hauteur / 20

    def p(x: float, y: float) -> tuple[float, float]:
        return (cx + (x - 16) * k, cy + (y - 16) * k)

    corps = [p(9, 6), p(23, 6), p(23, 26), p(20.67, 24.25), p(18.33, 26), p(16, 24.25), p(13.67, 26), p(11.33, 24.25), p(9, 26)]
    dessin.polygon(corps, fill=fond)
    epaisseur = 1.8 * k
    for x1, y1, x2, y2 in [(12.5, 12, 19.5, 12), (12.5, 16, 17, 16)]:
        a, b = p(x1, y1), p(x2, y2)
        dessin.line([a, b], fill=trait, width=max(1, round(epaisseur)))
        r = epaisseur / 2
        for x, y in (a, b):
            dessin.ellipse([x - r, y - r, x + r, y + r], fill=trait)


def rendre(taille: tuple[int, int], peintre) -> Image.Image:
    grand = Image.new("RGBA", (taille[0] * SURECHANTILLON, taille[1] * SURECHANTILLON), (0, 0, 0, 0))
    peintre(ImageDraw.Draw(grand), grand.size)
    return grand.resize(taille, Image.LANCZOS)


def icone_carree(dessin, taille) -> None:
    l, h = taille
    dessin.rounded_rectangle([0, 0, l - 1, h - 1], radius=l * 0.18, fill=BLEU)
    ticket(dessin, l / 2, h / 2, h * 0.62, BLANC, BLEU)


def icone_ronde(dessin, taille) -> None:
    l, h = taille
    dessin.ellipse([0, 0, l - 1, h - 1], fill=BLEU)
    ticket(dessin, l / 2, h / 2, h * 0.56, BLANC, BLEU)


def premier_plan(dessin, taille) -> None:
    # Icône adaptative : Android recadre, le sujet doit tenir dans les 2/3 centraux.
    l, h = taille
    ticket(dessin, l / 2, h / 2, h * 0.40, BLANC, BLEU)


def police(taille: int) -> ImageFont.ImageFont:
    for chemin in POLICES:
        if pathlib.Path(chemin).exists():
            return ImageFont.truetype(chemin, taille)
    return ImageFont.load_default()


def lancement(dessin, taille) -> None:
    l, h = taille
    dessin.rectangle([0, 0, l, h], fill=BLEU)
    cote = min(l, h)
    ticket(dessin, l / 2, h / 2 - cote * 0.07, cote * 0.26, BLANC, BLEU)
    dessin.text((l / 2, h / 2 + cote * 0.10), "AfriKaisse", font=police(round(cote * 0.075)), fill=BLANC, anchor="mt")


def regenerer(motif: str, peintre) -> int:
    fichiers = sorted(RES.glob(motif))
    for fichier in fichiers:
        with Image.open(fichier) as image:
            taille = image.size
        rendre(taille, peintre).save(fichier)
    return len(fichiers)


def main() -> None:
    print("icônes carrées     :", regenerer("mipmap-*/ic_launcher.png", icone_carree))
    print("icônes rondes      :", regenerer("mipmap-*/ic_launcher_round.png", icone_ronde))
    print("premiers plans     :", regenerer("mipmap-*/ic_launcher_foreground.png", premier_plan))
    print("écrans de lancement:", regenerer("drawable*/splash.png", lancement))
    (RES / "values" / "ic_launcher_background.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#1D4D82</color>\n</resources>\n',
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()

"""Build README screenshots from browser captures.

Usage:
    python scripts/make_preview.py --popup path/to/popup.png --options path/to/options.png
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    names = ["seguisb.ttf" if bold else "segoeui.ttf", "arialbd.ttf" if bold else "arial.ttf"]
    for name in names:
        path = Path("C:/Windows/Fonts") / name
        if path.exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def rounded(image: Image.Image, radius: int) -> Image.Image:
    result = Image.new("RGBA", image.size, (0, 0, 0, 0))
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, image.width - 1, image.height - 1), radius, fill=255)
    result.paste(image.convert("RGBA"), (0, 0), mask)
    return result


def paste_card(canvas: Image.Image, image: Image.Image, position: tuple[int, int], radius: int = 24) -> None:
    x, y = position
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle(
        (x - 14, y + 10, x + image.width + 14, y + image.height + 30),
        radius + 10,
        fill=(0, 0, 0, 150),
    )
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(24)))
    canvas.alpha_composite(rounded(image, radius), position)


def gradient_background(width: int, height: int) -> Image.Image:
    image = Image.new("RGBA", (width, height), (7, 11, 20, 255))
    pixels = image.load()
    for y in range(height):
        for x in range(width):
            amount = (x / width) * 0.38 + (y / height) * 0.18
            pixels[x, y] = (
                round(7 + 16 * amount),
                round(11 + 7 * amount),
                round(20 + 22 * amount),
                255,
            )

    glow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(glow)
    draw.ellipse((-240, -300, 520, 460), fill=(124, 58, 237, 105))
    draw.ellipse((1040, 480, 1640, 1080), fill=(219, 39, 119, 75))
    image.alpha_composite(glow.filter(ImageFilter.GaussianBlur(110)))
    return image


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--popup", required=True, type=Path)
    parser.add_argument("--options", required=True, type=Path)
    args = parser.parse_args()

    DOCS.mkdir(exist_ok=True)

    popup_source = Image.open(args.popup).convert("RGB")
    popup = popup_source.crop((0, 0, min(372, popup_source.width), min(492, popup_source.height)))
    popup.save(DOCS / "popup.png", optimize=True)

    options = Image.open(args.options).convert("RGB")
    options.save(DOCS / "options.png", optimize=True)

    canvas = gradient_background(1400, 900)
    draw = ImageDraw.Draw(canvas)
    draw.text((72, 55), "INSTAFLOW", fill=(167, 139, 250), font=font(20, True))
    draw.text((72, 82), "Один клик — и готово", fill=(248, 250, 252), font=font(48, True))
    draw.text(
        (74, 145),
        "Фото, Reels и карусели — без копирования ссылок и лишних сайтов.",
        fill=(148, 163, 184),
        font=font(22),
    )

    popup_scaled = popup.resize((420, round(popup.height * 420 / popup.width)), Image.Resampling.LANCZOS)
    options_crop = options.crop((0, 45, options.width, min(795, options.height)))
    options_scaled = options_crop.resize(
        (780, round(options_crop.height * 780 / options_crop.width)),
        Image.Resampling.LANCZOS,
    )

    paste_card(canvas, options_scaled, (560, 200), 26)
    paste_card(canvas, popup_scaled, (72, 260), 26)

    draw.rounded_rectangle((90, 808, 465, 856), 24, fill=(30, 41, 59, 220), outline=(124, 58, 237, 150), width=2)
    draw.text((118, 819), "Скачать всю публикацию", fill=(226, 232, 240), font=font(18, True))

    canvas.convert("RGB").save(DOCS / "preview.png", quality=92, optimize=True)
    print(DOCS / "preview.png")


if __name__ == "__main__":
    main()

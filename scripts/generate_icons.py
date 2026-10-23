"""Generate Chrome toolbar icons for InstaFlow.

Requires Pillow. Run from the project root:
    python scripts/generate_icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "icons"
SIZES = (16, 32, 48, 128)


def lerp(first: int, second: int, amount: float) -> int:
    return round(first + (second - first) * amount)


def make_icon(size: int) -> Image.Image:
    scale = 4
    canvas_size = size * scale
    image = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))

    gradient = Image.new("RGBA", image.size)
    pixels = gradient.load()
    start = (124, 58, 237)
    middle = (217, 70, 239)
    end = (244, 63, 94)

    for y in range(canvas_size):
        for x in range(canvas_size):
            amount = (x + y) / max(1, 2 * canvas_size - 2)
            if amount < 0.55:
                local = amount / 0.55
                color = tuple(lerp(start[i], middle[i], local) for i in range(3))
            else:
                local = (amount - 0.55) / 0.45
                color = tuple(lerp(middle[i], end[i], local) for i in range(3))
            pixels[x, y] = (*color, 255)

    mask = Image.new("L", image.size, 0)
    mask_draw = ImageDraw.Draw(mask)
    inset = round(canvas_size * 0.055)
    radius = round(canvas_size * 0.27)
    mask_draw.rounded_rectangle(
        (inset, inset, canvas_size - inset - 1, canvas_size - inset - 1),
        radius=radius,
        fill=255,
    )
    image.alpha_composite(Image.composite(gradient, Image.new("RGBA", image.size), mask))

    draw = ImageDraw.Draw(image)
    white = (255, 255, 255, 255)
    line_width = max(scale * 2, round(canvas_size * 0.075))
    center = canvas_size / 2

    draw.line(
        (center, canvas_size * 0.245, center, canvas_size * 0.59),
        fill=white,
        width=line_width,
    )
    draw.line(
        (canvas_size * 0.37, canvas_size * 0.47, center, canvas_size * 0.61),
        fill=white,
        width=line_width,
    )
    draw.line(
        (center, canvas_size * 0.61, canvas_size * 0.63, canvas_size * 0.47),
        fill=white,
        width=line_width,
    )

    tray_left = canvas_size * 0.28
    tray_right = canvas_size * 0.72
    tray_top = canvas_size * 0.66
    tray_bottom = canvas_size * 0.77
    draw.line((tray_left, tray_top, tray_left, tray_bottom), fill=white, width=line_width)
    draw.line((tray_left, tray_bottom, tray_right, tray_bottom), fill=white, width=line_width)
    draw.line((tray_right, tray_bottom, tray_right, tray_top), fill=white, width=line_width)

    return image.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        output = ICON_DIR / f"icon{size}.png"
        make_icon(size).save(output, optimize=True)
        print(output.relative_to(ROOT))


if __name__ == "__main__":
    main()

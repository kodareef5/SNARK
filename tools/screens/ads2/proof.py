"""Build the handoff proof from the shipped JPEGs and decoded inspection frames."""
import csv
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[3]
WORK = ROOT / "var/ads2/work"
OUT = ROOT / "var/ads2/out"
FONTS = Path("/usr/share/fonts/opentype/urw-base35")
W, MARGIN, GAP = 1840, 38, 24
PAPER, INK, RED = "#fff8e9", "#292921", "#932f25"
HEAD = ImageFont.truetype(FONTS / "P052-Bold.otf", 54)
ID = ImageFont.truetype(FONTS / "NimbusSans-Bold.otf", 24)
META = ImageFont.truetype(FONTS / "NimbusMonoPS-Regular.otf", 19)


def page(title, detail, height):
    surface = Image.new("RGB", (W, height), PAPER)
    pen = ImageDraw.Draw(surface)
    pen.text((MARGIN, 35), title, fill=INK, font=HEAD, anchor="lt")
    pen.text((W - MARGIN, 53), detail, fill=RED, font=META, anchor="rt")
    pen.line((MARGIN, 102, W - MARGIN, 102), fill=INK, width=2)
    return surface, pen


def still_page(rows, title, detail):
    width = (W - 2 * MARGIN - GAP) // 2
    with Image.open(OUT / rows[0]["file"]) as first:
        height = round(first.height * width / first.width)
    step = height + 54
    surface, pen = page(title, detail, 140 + ((len(rows) + 1) // 2) * step)
    for i, row in enumerate(rows):
        x, y = MARGIN + i % 2 * (width + GAP), 126 + i // 2 * step
        with Image.open(OUT / row["file"]) as image:
            surface.paste(image.resize((width, height), Image.Resampling.LANCZOS), (x, y))
        pen.text((x, y + height + 10), row["name"], fill=INK, font=ID, anchor="lt")
    return surface


def motion_page(rows, tv):
    cols = 5 if tv else 4
    width = (W - 2 * MARGIN - (cols - 1) * 8) // cols
    height = round(width * (480 if tv else 280) / 854)
    step = height + 68
    title = "Television commercials" if tv else "Roadside loops"
    surface, pen = page(title, "SNARK    /    2026", 132 + len(rows) * step)
    for i, row in enumerate(rows):
        name, y = row["name"], 128 + i * step
        pen.text((MARGIN, y), name, font=ID, fill=INK, anchor="lt")
        pen.text((W - MARGIN, y + 3), f"Poster at {row['poster']} s", font=META, fill=RED, anchor="rt")
        if tv:
            samples = sorted((WORK / "tv" / name).glob("sample-*.png"))
            assert len(samples) in (4, 5), name
            frames = []
            for sample in samples:
                with Image.open(sample) as image:
                    frames.append(image.convert("RGB"))
        else:
            with Image.open(WORK / "loops" / (name + "-inspection.jpg")) as strip:
                assert strip.size == (854, 1200), name
                frames = [strip.crop((0, j * 300 + 20, 854, (j + 1) * 300)) for j in range(4)]
        for j, frame in enumerate(frames):
            surface.paste(frame.resize((width, height), Image.Resampling.LANCZOS),
                          (MARGIN + j * (width + 8), y + 34))
    return surface


def main():
    with (OUT / "sheet.csv").open(newline="") as sheet:
        rows = list(csv.DictReader(sheet))
    boards = [r for r in rows if r["types"] == "billboard" and r["kind"] == "image"]
    laptops = [r for r in rows if r["types"] == "laptop"]
    loops = [r for r in rows if r["types"] == "billboard" and r["kind"] == "clip"]
    spots = [r for r in rows if r["types"] == "tv"]
    pages = [still_page(boards[:10], "Roadside stills", "SNARK    /    01—10"),
             still_page(boards[10:], "Roadside stills", "SNARK    /    11—20"),
             motion_page(loops, False), motion_page(spots, True),
             still_page(laptops[:4], "Laptop screens", "SNARK    /    01—04"),
             still_page(laptops[4:], "Laptop screens", "SNARK    /    05—08")]
    target = WORK / "screen-library.pdf"
    pages[0].save(target, save_all=True, append_images=pages[1:], resolution=150,
                  quality=90, title="SNARK screen library", author="SNARK")
    print(target)


if __name__ == "__main__":
    main()

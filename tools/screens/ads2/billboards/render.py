"""Finish the twenty illustrated broadside plates and write their importer rows."""
import argparse
import csv
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
WORK = ROOT / "var/ads2/work/billboards"
OUT = ROOT / "var/ads2/out"
FONTS = Path("/usr/share/fonts/opentype/urw-base35")
FIELDS = "file,name,title,kind,types,channels,rights,licence,by,year,poster,audio,flashes".split(",")


def font(name, size):
    return ImageFont.truetype(FONTS / (name + ".otf"), size)


def make_footer(campaign, finish):
    style, paper, ink, accent, face, label = finish
    height = 32
    strip = Image.new("RGB", (1280, height), paper)
    pen = ImageDraw.Draw(strip)
    text = campaign["fine"]
    size = 20 if style != "policy" else 18
    body = font(face, size)
    center = height // 2 + 1
    if style == "menu":
        pen.text((640, center), text, font=body, fill=ink, anchor="mm")
        end = (1280 - pen.textlength(text, font=body)) / 2 - 18
        for x1, x2 in [(36, end), (1280 - end, 1244)]:
            pen.line((x1, center, x2, center), fill=accent, width=1)
    else:
        tag = font("NimbusSansNarrow-Bold", 18)
        left = 29
        boundary = left + round(pen.textlength(label, font=tag)) + 23
        pen.text((left, center), label, font=tag, fill=ink, anchor="lm")
        if style == "spec":
            pen.polygon([(boundary - 7, 6), (boundary - 3, 6),
                         (boundary - 10, 26), (boundary - 14, 26)], fill=accent)
            pen.polygon([(boundary, 6), (boundary + 4, 6),
                         (boundary - 3, 26), (boundary - 7, 26)], fill=accent)
        else:
            pen.line((boundary - 3, 6, boundary - 3, height - 6), fill=accent, width=1)
        start = boundary + 15
        assert start + pen.textlength(text, font=body) <= 1252, campaign["name"]
        pen.text((start, center), text, font=body, fill=ink, anchor="lm")
    return strip


def render(campaign, finishes):
    name = campaign["name"]
    strip = make_footer(campaign, finishes[name])
    with Image.open(WORK / (name + ".png")) as source:
        # The typeset rider replaces a little vertical print space while preserving the full illustration.
        image = source.convert("RGB").resize((1280, 420 - strip.height), Image.Resampling.LANCZOS)
    final = Image.new("RGB", (1280, 420))
    final.paste(image, (0, 0))
    final.paste(strip, (0, image.height))
    target = OUT / (name + ".jpg")
    for quality in (95, 93, 91, 89):
        final.save(target, quality=quality, subsampling=0, optimize=True)
        if target.stat().st_size < 400_000:
            return
    raise ValueError(f"{name}: JPEG exceeds 400,000 bytes")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("names", nargs="*", help="limit render to these campaigns")
    args = parser.parse_args()
    campaigns = json.loads((HERE / "campaigns.json").read_text())
    finishes = json.loads((HERE / "finish.json").read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    if set(args.names) - finishes.keys():
        parser.error("Unknown campaign")
    for campaign in campaigns:
        if not args.names or campaign["name"] in args.names:
            render(campaign, finishes)
    if not args.names:
        with (WORK / "rows.csv").open("w", newline="") as file:
            writer = csv.writer(file, lineterminator="\n")
            writer.writerow(FIELDS)
            for c in campaigns:
                writer.writerow([c["name"] + ".jpg", c["name"], c["brand"] + " — " + c["headline"],
                                 "image", "billboard", "Billboard ads", "Made for SNARK, 2026",
                                 "Made for the game and given to it under CC0 1.0.", "SNARK", "2026", "", "no", "no"])


if __name__ == "__main__":
    main()

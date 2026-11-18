"""Compose the review sheets from pinned native renderer captures; requires Pillow."""

import argparse
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageOps

FINAL = "36891e64d2bc61a11b77a9a2174aae35e738b332604ec7775ea5eb92ba1566ba"
BEFORE_HIP = "d929bc98e24c1f7297e30b1377dd3d9fc871797a1db2b63b79cb1f60b4076515"
BEFORE = "5a990153f6c87427f4b6e9e6eab70d6518693f532af0cc044dacc5394da7cb97"
LABEL = "#334036"
PAPER = "#f4f4ef"


def font(size, bold=False):
    try:
        return ImageFont.truetype("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf", size)
    except OSError:
        return ImageFont.load_default(size=size)


def verify(folder, digest, variant):
    rec = json.loads((folder / "receipt.json").read_text())
    if rec["packSha256"] != digest or rec["textureVariant"] != variant:
        raise ValueError(f"Wrong native capture in {folder}")


def read(folder, name):
    return Image.open(folder / (name + ".png")).convert("RGB")


def place(canvas, picture, box, fill=False):
    x, y, w, h = box
    if fill:
        canvas.paste(ImageOps.fit(picture, (w, h), Image.Resampling.LANCZOS), (x, y))
        return
    canvas.paste(picture.getpixel((0, 0)), (x, y, x + w, y + h))
    picture = ImageOps.contain(picture, (w, h), Image.Resampling.LANCZOS)
    canvas.paste(picture, (x + (w - picture.width) // 2, y + (h - picture.height) // 2))


def trimmed(picture):
    flat = Image.new("RGB", picture.size, picture.getpixel((0, 0)))
    diff = ImageChops.difference(picture, flat).convert("L").point(lambda p: 255 * (p > 10))
    x, y, r, b = diff.getbbox()
    return picture.crop((max(0, x - 15), max(0, y - 15), min(r + 15, picture.width), min(b + 15, picture.height)))


def hip_sheet(before, revised, output):
    receipts = []
    for folder, digest in ((before, BEFORE_HIP), (revised, FINAL)):
        rec = json.loads((folder / "hip-receipt.json").read_text())
        pack = rec.pop("packSha256")
        if pack != digest or rec["textureVariant"] != "bc" or rec["maximumMip"] != 128 or rec["lod"] != 2:
            raise ValueError(f"Wrong hip capture in {folder}")
        receipts.append(rec)
    if receipts[0] != receipts[1] or not receipts[0].get("textureHashes"):
        raise ValueError("Hip captures must use identical cameras, native poses and encoded materials")

    board = Image.new("RGB", (1024, 640), PAPER)
    draw = ImageDraw.Draw(board)
    draw.text((14, 11), "Tyrannosaurus rex  /  upper hindlimb and tail root", font=font(22, True), fill="#24362c")
    draw.text((14, 44), "Idle frame 0  ·  6,200 triangles  ·  128 px BC texture ceiling", font=font(15), fill=LABEL)
    for y, folder, phase in [(79, before, "Before"), (363, revised, "Revised")]:
        for x, filename, material in [(14, "hip-clay", "Neutral surface"), (516, "hip-paint", "Production colour")]:
            picture = read(folder, filename).crop((70, 75, 1130, 615))
            place(board, picture, (x, y, 496, 253))
            draw.text((x, y + 257), f"{phase}   /   {material}", font=font(15), fill=LABEL)
    board.save(output / "hip-comparison.png", optimize=True)


def main():
    args = argparse.ArgumentParser()
    args.add_argument(
        "before", type=Path, help="BC profile-lod2.png, quarter-lod2.png and receipt.json for the original packed asset"
    )
    args.add_argument("--views", type=Path, default=Path("var/rex/review"))
    args.add_argument("--out", type=Path, default=Path("assets/source/core/creatures/rex/ref"))
    a = args.parse_args()
    bc = a.views / "bc"
    astc = a.views / "astc"
    medium = a.views / "bc-128"
    for folder, digest, variant in [
        (bc, FINAL, "bc"),
        (astc, FINAL, "astc"),
        (medium, FINAL, "bc"),
        (a.before, BEFORE, "bc"),
    ]:
        verify(folder, digest, variant)
    if json.loads((medium / "receipt.json").read_text())["maximumMip"] != 128:
        raise ValueError("Expected the 128 px capture")
    hip_sheet(a.views / "bc-128-earlier", medium, a.out)
    board = Image.new("RGB", (1500, 1098), PAPER)
    d = ImageDraw.Draw(board)
    d.text((26, 20), "Tyrannosaurus rex", font=font(37, True), fill="#20261f")
    d.text((1474, 38), "Native creature and riding saddle", font=font(19), anchor="ra", fill=LABEL)
    for name, folder, box, label, close in [
        ("profile", bc, (26, 90, 828, 267), "Adult profile", False),
        ("quarter", bc, (866, 90, 608, 267), "Front three-quarter", False),
        ("face", bc, (26, 402, 718, 329), "Resting jaw, nostril and orbit  /  BC", True),
        ("roar", astc, (756, 402, 718, 329), "Roar at frame 25  /  ASTC", True),
        ("saddle", bc, (26, 779, 410, 237), "Worn saddle", True),
        ("stride", bc, (448, 779, 501, 237), "Run at 8.4 m/s", False),
        ("rest", bc, (961, 779, 513, 237), "Unconscious side rest", False),
    ]:
        x, y, w, h = box
        im = read(folder, name)
        place(board, im if close else trimmed(im), box, close)
        d.text((x, y + h + 6), label, font=font(17), fill=LABEL)
    d.text(
        (26, 1064),
        "Finest packed geometry   ·   Independent body and facial materials at 2048 px   ·   30 Hz skeletal poses",
        font=font(15),
        fill=LABEL,
    )
    board.save(a.out / "native-review.png", optimize=True)

    board = Image.new("RGB", (786, 910), PAPER)
    d = ImageDraw.Draw(board)
    d.text((22, 18), "Tyrannosaurus rex", font=font(29, True), fill="#20261f")
    d.text(
        (22, 59),
        "Matched native views  ·  6,200 triangles  ·  idle frame 0  ·  noon lighting",
        font=font(16),
        fill=LABEL,
    )
    for x, label in [(22, "Profile"), (403, "Three-quarter")]:
        d.text((x, 99), label, font=font(16, True), fill=LABEL)
    for y, folder, label in [(126, a.before, "Before"), (319, bc, "Revised")]:
        for name, x in [("profile-lod2", 22), ("quarter-lod2", 403)]:
            # One fixed pixel crop and scale for both animals in both rows.
            im = read(folder, name).crop((0, 92, 1220, 660))
            place(board, im, (x, y, 360, 169))
            d.text((x, y + 168), label, font=font(14), fill=LABEL)
    d.text((22, 542), "Revised muzzle and brow", font=font(21, True), fill="#20261f")
    d.text((22, 579), "The same native LOD, with every BC texture capped at 128 px.", font=font(15), fill=LABEL)
    for name, x, label in [("face", 22, "Side of muzzle"), ("front", 403, "Front of cranium")]:
        im = read(medium, name)
        place(board, im, (x, 616, 360, 234), True)
        d.text((x, 858), label, font=font(14), fill=LABEL)
    board.save(a.out / "resculpt-comparison.png", optimize=True)


if __name__ == "__main__":
    main()

"""Assemble the screen sheet and verify the files it will hand to the importer."""
import argparse
import csv
import json
import re
import struct
import subprocess
from collections import Counter
from fractions import Fraction
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
WORK = ROOT / "var/ads2/work"
OUT = ROOT / "var/ads2/out"
FIELDS = "file,name,title,kind,types,channels,rights,licence,by,year,poster,audio,flashes".split(",")
EXPECTED = {("billboard", "image"): 20, ("billboard", "clip"): 6,
            ("tv", "clip"): 6, ("laptop", "image"): 8}
CHANNELS = {"billboard": "Billboard ads", "tv": "TV spots", "laptop": "Laptop screens"}
SIZES = {("billboard", "image"): (1280, 420), ("billboard", "clip"): (854, 280),
         ("tv", "clip"): (854, 480), ("laptop", "image"): (1280, 800)}
FIXED = {"rights": "Made for SNARK, 2026", "licence": "Made for the game and given to it under CC0 1.0.",
         "by": "SNARK", "year": "2026", "audio": "no"}


def require(ok, message):
    if not ok:
        raise ValueError(message)


def read_rows(path):
    with path.open(newline="", encoding="utf-8-sig") as file:
        reader = csv.DictReader(file)
        require(reader.fieldnames == FIELDS, f"{path} has unexpected columns")
        return list(reader)


def atom_order(path):
    atoms = []
    with path.open("rb") as movie:
        end = path.stat().st_size
        while movie.tell() < end:
            start = movie.tell()
            size, name = struct.unpack(">I4s", movie.read(8))
            if size == 1:
                size, = struct.unpack(">Q", movie.read(8))
            if size == 0:
                size = end - start
            require(size >= movie.tell() - start and start + size <= end, f"{path}: invalid MP4 atom")
            atoms.append(name)
            movie.seek(start + size)
    return atoms


def inspect_file(row):
    name, file = row["name"], row["file"]
    path = OUT / file
    require(re.fullmatch(r"[a-z]+(?:-[a-z]+)*", name) and len(name) <= 48, f"Invalid name: {name}")
    require(file == Path(file).name and path.stem == name and path.is_file(), f"Invalid file: {file}")
    require(row["title"].strip(), f"{name}: missing title")
    require(not (ROOT / "assets/source/core/screens" / name).exists(), f"Name already in use: {name}")
    for field, value in FIXED.items():
        require(row[field] == value, f"{name}: unexpected {field}")
    require(row["flashes"] in ("yes", "no"), f"{name}: invalid flash flag")
    screen, kind = row["types"], row["kind"]
    size = SIZES[screen, kind]
    require(row["channels"] == CHANNELS[screen], f"{name}: unexpected channel")
    if kind == "image":
        with Image.open(path) as pic:
            require(pic.format in ("JPEG", "PNG") and pic.size == size, f"{name}: invalid still")
            pic.load()
        require(path.stat().st_size < 400_000 and not row["poster"], f"{name}: size or poster")
        return
    result = subprocess.check_output(["ffprobe", "-v", "error", "-show_streams", "-show_format",
                                      "-of", "json", str(path)])
    movie = json.loads(result)
    stream, = movie["streams"]
    require((stream["width"], stream["height"]) == size, f"{name}: invalid video dimensions")
    require(stream["codec_name"] == "h264" and stream["pix_fmt"] == "yuv420p", f"{name}: invalid codec")
    require(Fraction(stream["avg_frame_rate"]) in (24, 30), f"{name}: invalid frame rate")
    duration = float(movie["format"]["duration"])
    lo, hi = (6, 10) if screen == "billboard" else (12, 20)
    require(lo <= duration <= hi and 0 <= float(row["poster"]) < duration, f"{name}: timing")
    require(int(movie["format"]["bit_rate"]) <= 1_500_000, f"{name}: excessive bit rate")
    atoms = atom_order(path)
    require(atoms.index(b"moov") < atoms.index(b"mdat"), f"{name}: missing faststart")
    subprocess.run(["ffmpeg", "-v", "error", "-xerror", "-i", str(path),
                    "-f", "null", "-"], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assemble", action="store_true", help="build sheet.csv from the four batches")
    args = parser.parse_args()
    sheet = OUT / "sheet.csv"
    if args.assemble:
        rows = [row for batch in ("billboards", "loops", "tv", "laptops")
                for row in read_rows(WORK / batch / "rows.csv")]
    else:
        rows = read_rows(sheet)
    require(Counter((r["types"], r["kind"]) for r in rows) == EXPECTED, "Unexpected item counts")
    require(len({r["name"] for r in rows}) == len(rows), "Duplicate item names")
    require({p.name for p in OUT.iterdir() if p != sheet} == {r["file"] for r in rows}, "Output and sheet differ")
    for row in rows:
        inspect_file(row)
    if args.assemble:
        with sheet.open("w", newline="", encoding="utf-8") as file:
            writer = csv.DictWriter(file, fieldnames=FIELDS, lineterminator="\n")
            writer.writeheader()
            writer.writerows(rows)
    print("40 media files passed. All 12 movies decoded.")


if __name__ == "__main__":
    main()

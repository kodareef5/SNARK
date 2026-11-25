"""The HUD's and the title's face as two WOFF2 files split by character range: Latin, which every page fetches, and the
rest of the face, which a browser fetches only when it shows one of its characters (CSS unicode-range).

Hinting and the browser's default layout features are kept, so text measures and draws as the whole face did.

    python3 -m venv /tmp/fontenv && /tmp/fontenv/bin/pip install fonttools brotli
    /tmp/fontenv/bin/python -I tools/ui/font-subset.py assets/raw/fonts/barlow

It writes latin.woff2, rest.woff2 and faces.json beside the face. faces.json names the face's SHA-256, so the build can
tell when the face has changed and the files must be made again (tools/ui/assets.ts).
"""

import hashlib
import io
import json
import sys
from pathlib import Path

from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont

FACE = "BarlowSemiCondensed-Medium.ttf"
# Google Fonts' "latin" range.
LATIN = [(0x0000, 0x00FF), (0x0131, 0x0131), (0x0152, 0x0153), (0x02BB, 0x02BC), (0x02C6, 0x02C6), (0x02DA, 0x02DA),
         (0x02DC, 0x02DC), (0x2000, 0x206F), (0x2074, 0x2074), (0x20AC, 0x20AC), (0x2122, 0x2122), (0x2191, 0x2191),
         (0x2193, 0x2193), (0x2212, 0x2212), (0x2215, 0x2215), (0xFEFF, 0xFEFF), (0xFFFD, 0xFFFD)]


def runs(codes):
    out = []
    for c in sorted(codes):
        if out and out[-1][1] == c - 1:
            out[-1][1] = c
        else:
            out.append([c, c])
    return out


def css_range(codes):
    return ", ".join(f"U+{a:04X}" + (f"-{b:04X}" if b != a else "") for a, b in runs(codes))


def woff2(face, codes):
    # The face's own date is kept, so the same face makes the same bytes.
    font = TTFont(face, recalcTimestamp=False)
    options = Options()
    options.flavor = "woff2"
    options.hinting = True
    options.name_IDs = ["*"]
    options.notdef_outline = True
    subsetter = Subsetter(options)
    subsetter.populate(unicodes=codes)
    subsetter.subset(font)
    out = io.BytesIO()
    font.flavor = "woff2"
    font.save(out)
    return out.getvalue()


def main():
    folder = Path(sys.argv[1])
    face = folder / FACE
    codes = set(TTFont(face).getBestCmap())
    latin = {c for c in codes if any(a <= c <= b for a, b in LATIN)}
    rest = codes - latin
    faces = []
    for name, part in (("latin", latin), ("rest", rest)):
        data = woff2(face, part)
        (folder / f"{name}.woff2").write_bytes(data)
        faces.append({"file": f"{name}.woff2", "range": css_range(part)})
        print(f"{name}.woff2: {len(part)} characters, {len(data)} bytes")
    sha = hashlib.sha256(face.read_bytes()).hexdigest()
    (folder / "faces.json").write_text(json.dumps({"face": FACE, "sha256": sha, "faces": faces}, indent=2) + "\n")


main()

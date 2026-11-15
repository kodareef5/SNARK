"""Draws the bakes from the surface bake.py wrote: for the opaque material `dodo`, its layout, pieces, colour regions,
position, normal, feather direction and curvature; for `dodo_cards`, its layout and regions. Needs NumPy and Pillow.

    python3 ref/bakes/draw.py [--size 2048] [--new-layout]

Paint is on the layout, so if any piece covers a texel it did not cover in the dodo_pieces.png already here, nothing
is drawn and it says which pieces moved; --new-layout draws them anyway, once a new layout is agreed. What each
picture holds is in bakes.json beside them.
"""

import hashlib
import json
import os
import sys
import tempfile

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
# The build's region colours (rig.py: REGION_MAP_COLOURS), black for what is never dyed.
REGION = [(255, 0, 0), (0, 255, 0), (0, 0, 255), (0, 255, 255), (255, 0, 255), (255, 255, 0), (0, 0, 0)]
SOFT = [(214, 170, 170), (170, 214, 170), (170, 170, 220), (165, 215, 215), (215, 170, 215), (220, 215, 160), (150, 150, 150)]
PAD = 8


def font(size):
    for path in ("/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/Supplemental/Arial.ttf",
                 "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def triangles(face):
    n = len(face["uv"])
    for k in range(1, n - 1):
        yield 0, k, k + 1


def rasterize(faces, size, values):
    """Fills each face's texels with `values(face, corner)` (a vector) interpolated across it. Returns the picture
    (size, size, channels) and which texels were covered."""
    first = values(faces[0], 0)
    out = np.zeros((size, size, len(first)))
    hit = np.zeros((size, size), bool)
    for f in faces:
        uv = np.array(f["uv"]) * size
        uv[:, 1] = size - uv[:, 1]
        vals = np.array([values(f, c) for c in range(len(f["uv"]))], float)
        for a, b, c in triangles(f):
            p = uv[[a, b, c]]
            x0, y0 = np.floor(p.min(axis=0)).astype(int)
            x1, y1 = np.ceil(p.max(axis=0)).astype(int)
            x0, y0 = max(x0, 0), max(y0, 0)
            x1, y1 = min(x1, size - 1), min(y1, size - 1)
            if x1 < x0 or y1 < y0:
                continue
            xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            d = (p[1, 1] - p[2, 1]) * (p[0, 0] - p[2, 0]) + (p[2, 0] - p[1, 0]) * (p[0, 1] - p[2, 1])
            if abs(d) < 1e-12:
                continue
            w0 = ((p[1, 1] - p[2, 1]) * (xs - p[2, 0]) + (p[2, 0] - p[1, 0]) * (ys - p[2, 1])) / d
            w1 = ((p[2, 1] - p[0, 1]) * (xs - p[2, 0]) + (p[0, 0] - p[2, 0]) * (ys - p[2, 1])) / d
            w2 = 1 - w0 - w1
            inside = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
            if not inside.any():
                continue
            v = w0[..., None] * vals[a] + w1[..., None] * vals[b] + w2[..., None] * vals[c]
            region = out[y0:y1 + 1, x0:x1 + 1]
            region[inside] = v[inside]
            hit[y0:y1 + 1, x0:x1 + 1] |= inside
    return out, hit


def pad(img, hit, steps=PAD):
    """Grows each covered area outward by `steps` texels, so the pictures' smaller sizes do not bleed in the gaps."""
    img = img.copy()
    hit = hit.copy()
    for _ in range(steps):
        acc = np.zeros_like(img)
        cnt = np.zeros(hit.shape)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, 1), (-1, 1), (1, -1)):
            s = np.roll(np.roll(hit, dy, 0), dx, 1)
            acc += np.roll(np.roll(img, dy, 0), dx, 1) * s[..., None]
            cnt += s
        grow = (~hit) & (cnt > 0)
        img[grow] = acc[grow] / cnt[grow][:, None]
        hit |= grow
    return img, hit


def save(arr, name):
    Image.fromarray((np.clip(arr, 0, 1) * 255).round().astype(np.uint8)).save(os.path.join(HERE, name))


def curvature(f):
    """How sharply a face bends: the mean over its edges of how the normal turns along it, + where it bulges."""
    p = np.array(f["p"])
    n = np.array(f["n"])
    k = 0.0
    m = len(p)
    for a in range(m):
        b = (a + 1) % m
        e = p[b] - p[a]
        k += np.dot(n[b] - n[a], e) / max(np.dot(e, e), 1e-12)
    return k / m


def layout(faces, size, title, labels, atlas=None):
    """The texture's pieces in soft region colours with their edges drawn and their names written on them."""
    img = Image.new("RGB", (size, size), (255, 255, 255))
    d = ImageDraw.Draw(img)
    for f in faces:
        pts = [(u * size, (1 - v) * size) for u, v in f["uv"]]
        r = f["r"] if 0 <= f["r"] < 6 else 6
        d.polygon(pts, fill=SOFT[r], outline=(90, 90, 90))
    if atlas:
        for name, (u0, v0, u1, v1) in atlas.items():
            d.rectangle([u0 * size, (1 - v1) * size, u1 * size, (1 - v0) * size], outline=(200, 0, 0), width=2)
    big = font(max(12, size // 70))
    for text, (u, v) in labels.items():
        x, y = u * size, (1 - v) * size
        box = d.textbbox((x, y), text, font=big, anchor="mm")
        d.rectangle(box, fill=(255, 255, 255))
        d.text((x, y), text, fill=(0, 0, 0), font=big, anchor="mm")
    d.text((8, 6), title, fill=(0, 0, 0), font=font(max(12, size // 60)))
    return img


def piece_colour(name):
    """A colour of its own for each piece, the same in every bake."""
    return tuple(64 + b % 192 for b in hashlib.md5(name.encode()).digest()[:3])


def pieces(left, size):
    """Each texel's piece, in the piece's colour; black where there is none."""
    names = sorted({f["i"] for f in left})
    colours = {n: piece_colour(n) for n in names}
    if len(set(colours.values())) < len(names):
        sys.exit("draw: two pieces share a colour; give piece_colour another way to tell them apart")
    img, hit = rasterize(left, size, lambda f, c: np.array(colours[f["i"]], float))
    return np.where(hit[..., None], img, 0.0).round().astype(np.uint8), colours


def moved(old, new, colours):
    """How many texels each piece gained or lost against the published pieces."""
    out = {}
    for name, c in colours.items():
        was, now = np.all(old == c, axis=2), np.all(new == c, axis=2)
        n = int((was != now).sum())
        if n:
            out[name] = n
    return out


def main():
    size = 2048
    if "--size" in sys.argv:
        size = int(sys.argv[sys.argv.index("--size") + 1])
    data = json.load(open(os.path.join(tempfile.gettempdir(), "dodo_surface.json")))
    faces = data["faces"]
    mats = data["materials"]
    atlas = data["atlas"]
    opaque = [f for f in faces if f["m"] == mats.index("dodo")]
    cards = [f for f in faces if f["m"] == mats.index("dodo_cards")]
    # the left side carries the picture; the right side is its mirror, drawn over it exactly
    left = [f for f in opaque if np.mean(np.array(f["p"])[:, 0]) > 0]

    pic, colours = pieces(left, size)
    published = os.path.join(HERE, "dodo_pieces.png")
    if os.path.exists(published) and "--new-layout" not in sys.argv:
        old = np.array(Image.open(published).convert("RGB"))
        if old.shape != pic.shape:
            sys.exit(f"draw: the published pieces are {old.shape[0]} texels square; draw at that --size")
        gone = moved(old, pic, colours)
        if gone or (old != pic).any():
            sys.exit("draw: the layout moved, and paint is on it; nothing was drawn. Texels gained or lost: " +
                     (", ".join(f"{k} {v}" for k, v in sorted(gone.items())) or "a piece no longer here") +
                     ". With a new layout agreed with the texture maker, run again with --new-layout.")
    Image.fromarray(pic).save(published)

    pts = np.array([c for f in opaque for c in f["p"]])
    lo, hi = pts.min(axis=0), pts.max(axis=0)
    span = hi - lo

    img, hit = rasterize(left, size, lambda f, c: np.array(REGION[f["r"] if 0 <= f["r"] < 6 else 6]) / 255)
    # down the nape the hood narrows to a wedge (model.py: NAPE_WEDGE); the rest of its piece there is neck feathers
    wedge = data.get("nape_wedge")
    if wedge:
        at, _ = rasterize(left, size, lambda f, c: np.array(f["p"][c]))
        hood, _ = rasterize(left, size, lambda f, c: np.array([1.0 if f["i"] == "shell_hood" else 0.0]))
        half = np.interp(at[..., 1], [y for y, _ in wedge], [w for _, w in wedge], left=0.0, right=1.0)
        nape = hit & (hood[..., 0] > 0.5) & (at[..., 2] < 0.11) & (np.abs(at[..., 0]) > half)
        img[nape] = np.array(REGION[0]) / 255
    save(np.where(hit[..., None], img, 0.0), "dodo_regions.png")
    img, hit = rasterize(left, size, lambda f, c: (np.array(f["p"][c]) - lo) / span)
    img, hit = pad(img, hit)
    save(np.where(hit[..., None], img, 0.0), "dodo_position.png")
    img, hit = rasterize(left, size, lambda f, c: 0.5 + 0.5 * np.array(f["n"][c]) / max(np.linalg.norm(f["n"][c]), 1e-9))
    img, hit = pad(img, hit)
    save(np.where(hit[..., None], img, 0.5), "dodo_normal_object.png")
    img, hit = rasterize(left, size, lambda f, c: np.array([0.5 + 0.5 * f["f"][c][0], 0.5 + 0.5 * f["f"][c][1],
                                                           1.0 if any(f["f"][c]) else 0.0]))
    img, hit = pad(img, hit)
    save(np.where(hit[..., None], img, 0.0), "dodo_feather_direction.png")
    curv = {id(f): curvature(f) for f in left}
    scale = np.percentile(np.abs(list(curv.values())), 95)
    img, hit = rasterize(left, size, lambda f, c: np.array([0.5 + 0.5 * np.clip(curv[id(f)] / scale, -1, 1)] * 3))
    img, hit = pad(img, hit)
    save(np.where(hit[..., None], img, 0.5), "dodo_curvature.png")

    # labels: each piece's name at the middle of its texture
    labels = {}
    by = {}
    for f in left:
        by.setdefault(f["i"], []).append(np.mean(f["uv"], axis=0))
    for name, uvs in by.items():
        uvs = np.array(uvs)
        mid = uvs.mean(axis=0)
        labels[name.replace("_l_", "_").replace("_l", "").replace("shell_", "")] = tuple(uvs[np.argmin(np.linalg.norm(uvs - mid, axis=1))])
    layout(left, size, "dodo: the bird's left side; the right side is its mirror", labels).save(os.path.join(HERE, "dodo_layout.png"))

    # the cards: each kind of card shares its rectangle of the picture
    csize = 1024
    reg = {}
    for f in cards:
        reg.setdefault(f["i"], f["r"])
    rimg = np.zeros((csize, csize, 3))
    clabels = {}
    kinds = {"tail": 0, "finger": 5, "forehead": 4, "mane": 4, "hood": 4, "body": 0, "trousers": 0}
    for name, (u0, v0, u1, v1) in atlas.items():
        rimg[int((1 - v1) * csize):int((1 - v0) * csize), int(u0 * csize):int(u1 * csize)] = np.array(REGION[kinds[name]]) / 255
        clabels[name] = ((u0 + u1) / 2, (v0 + v1) / 2)
    save(rimg, "dodo_cards_regions.png")
    layout(cards, csize, "dodo_cards: every card of a kind shares its rectangle", clabels, atlas).save(os.path.join(HERE, "dodo_cards_layout.png"))

    info = {
        "material dodo": {
            "size": size,
            "dodo_layout.png": "the texture's pieces in soft region colours, named: the bird's left side. The right side is the left mirrored, so paint each piece once.",
            "dodo_pieces.png": "each texel's piece in the piece's colour (below), black where there is none: a mask for each piece. The layout is pinned (model.py: layout.json); draw.py stops if a piece's outline moves.",
            "pieces": {k: "#%02X%02X%02X" % v for k, v in sorted(colours.items())},
            "dodo_regions.png": "colour regions in the build's colours: red body, green face, blue beak, cyan forehead neck and feet, magenta hood, yellow wings and patterning; black is never dyed (eye, claws, inside of the mouth, tongue). The bars of the back and the tail bands are yours to paint as yellow.",
            "dodo_position.png": "each texel's place on the bird at rest, (x left, y up, z forward) scaled from the box below to 0..1",
            "position_box": {"min": [round(float(x), 4) for x in lo], "max": [round(float(x), 4) for x in hi]},
            "dodo_normal_object.png": "the smooth surface normal in the bird's frame (x left, y up, z forward), 0.5 + 0.5 n",
            "dodo_feather_direction.png": "which way the feathers lie, as a direction in the picture: red = 0.5 + 0.5 u, green = 0.5 + 0.5 v (v up the picture); blue 1 where it is defined (shell, wings, legs), 0 elsewhere",
            "dodo_curvature.png": "grey 0.5 is flat; lighter bulges, darker hollows",
            "dodo_occlusion.png": "ambient occlusion from the opaque surface alone, the cards left out",
            "dodo_occlusion_apart.png": "the same with the wings and legs taken a metre out to their sides",
            "dodo_covered.png": "white where a wing or a leg hides the surface at rest, or is the side of it that is hidden; compose.py takes the occlusion there from the bake apart",
        },
        "material dodo_cards": {
            "size": 512,
            "dodo_cards_layout.png": "each kind of card and its rectangle; every card of a kind is drawn from it. Strips (hood, body, trousers, mane, forehead) hang from the top of their rectangle, roots up and tips down; tail and finger feathers stand root down, tip up. A strip's u runs along its length. The card is cut out by your alpha.",
            "dodo_cards_regions.png": "the region each rectangle belongs to; tail bands and any pale tips are yellow where you paint them",
            "rectangles": atlas,
        },
    }
    with open(os.path.join(HERE, "bakes.json"), "w") as fh:
        json.dump(info, fh, indent=1)
    print("draw: wrote the bakes to", HERE)


main()

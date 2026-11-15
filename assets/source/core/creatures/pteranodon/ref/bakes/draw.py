"""Draws the bakes from the surface bake.py wrote, for each of the animal's two materials: its layout, pieces, colour
regions, position, normal, the way the fuzz and the veins run, and curvature. Needs NumPy and Pillow.

    python3 ref/bakes/draw.py [--new-layout]

Paint is on the layout, so if any piece of the body material covers a texel it did not cover in the
pteranodon_pieces.png already here, nothing is drawn and it says which pieces moved; --new-layout draws them anyway,
once a new layout is agreed. The wing material's layout is not pinned by file: each face of the membrane is a view of
it from above or below (model.py: WING_UV), so it stays put whatever the grid. What each picture holds is in
bakes.json beside them.
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
SOFT = [(150, 150, 160), (205, 190, 165), (225, 170, 130), (120, 120, 130), (165, 180, 205), (232, 228, 214), (90, 70, 70)]
PAD = 8
SIZE = {"pteranodon": 2048, "pteranodon_wing": 2048}


def font(size):
    for path in ("/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/Supplemental/Arial.ttf",
                 "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


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
        for a, b, c in [(0, k, k + 1) for k in range(1, len(f["uv"]) - 1)]:
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


def layout(faces, size, title, labels):
    """The texture's pieces in soft region colours with their edges drawn and their names written on them."""
    img = Image.new("RGB", (size, size), (255, 255, 255))
    d = ImageDraw.Draw(img)
    for f in faces:
        pts = [(u * size, (1 - v) * size) for u, v in f["uv"]]
        r = f["r"] if 0 <= f["r"] < 6 else 6
        d.polygon(pts, fill=SOFT[r], outline=(110, 110, 110))
    big = font(max(12, size // 64))
    for text, (u, v) in labels.items():
        x, y = u * size, (1 - v) * size
        box = d.textbbox((x, y), text, font=big, anchor="mm")
        d.rectangle(box, fill=(255, 255, 255))
        d.text((x, y), text, fill=(0, 0, 0), font=big, anchor="mm")
    d.text((size - 10, size - 8), title, fill=(0, 0, 0), font=font(max(12, size // 64)), anchor="rd")
    return img


def flipped(faces):
    """How many faces lay the picture the other way round from most of their piece's faces."""
    by = {}
    for f in faces:
        q = np.array(f["uv"])
        a = sum((q[k][0] - q[0][0]) * (q[k + 1][1] - q[0][1]) - (q[k + 1][0] - q[0][0]) * (q[k][1] - q[0][1])
                for k in range(1, len(q) - 1))
        by.setdefault(f["i"], []).append((np.sign(a), np.round(np.mean(f["p"], axis=0), 3)))
    out = {}
    for k, v in by.items():
        signs = np.array([s for s, _ in v])
        minority = 1 if (signs > 0).sum() < (signs < 0).sum() else -1
        where = [list(p) for s, p in v if s == minority]
        if where:
            out[k] = (len(where), where[:4])
    return out


def piece_colour(name):
    """A colour of its own for each piece, the same in every bake."""
    return tuple(64 + b % 192 for b in hashlib.md5(name.encode()).digest()[:3])


def pieces(left, size):
    names = sorted({f["i"] for f in left})
    colours = {n: piece_colour(n) for n in names}
    if len(set(colours.values())) < len(names):
        sys.exit("draw: two pieces share a colour; give piece_colour another way to tell them apart")
    img, hit = rasterize(left, size, lambda f, c: np.array(colours[f["i"]], float))
    return np.where(hit[..., None], img, 0.0).round().astype(np.uint8), colours


def moved(old, new, colours):
    out = {}
    for name, c in colours.items():
        was, now = np.all(old == c, axis=2), np.all(new == c, axis=2)
        n = int((was != now).sum())
        if n:
            out[name] = n
    return out


def labels_of(left, rename):
    by = {}
    for f in left:
        by.setdefault(f["i"], []).append(np.mean(f["uv"], axis=0))
    out = {}
    for name, uvs in by.items():
        uvs = np.array(uvs)
        mid = uvs.mean(axis=0)
        out[rename(name)] = tuple(uvs[np.argmin(np.linalg.norm(uvs - mid, axis=1))])
    return out


def maps(left, size, prefix, info):
    """Regions, position, normal, flow and curvature of one material's left side."""
    pts = np.array([c for f in left for c in f["p"]])
    lo, hi = pts.min(axis=0), pts.max(axis=0)
    span = np.maximum(hi - lo, 1e-6)
    img, hit = rasterize(left, size, lambda f, c: np.array(REGION[f["r"] if 0 <= f["r"] < 6 else 6]) / 255)
    save(np.where(hit[..., None], img, 0.0), f"{prefix}_regions.png")
    img, hit = rasterize(left, size, lambda f, c: (np.array(f["p"][c]) - lo) / span)
    img, hit = pad(img, hit)
    save(np.where(hit[..., None], img, 0.0), f"{prefix}_position.png")
    img, hit = rasterize(left, size, lambda f, c: 0.5 + 0.5 * np.array(f["n"][c]) / max(np.linalg.norm(f["n"][c]), 1e-9))
    img, hit = pad(img, hit)
    save(np.where(hit[..., None], img, 0.5), f"{prefix}_normal_object.png")
    img, hit = rasterize(left, size, lambda f, c: np.array([0.5 + 0.5 * f["f"][c][0], 0.5 + 0.5 * f["f"][c][1],
                                                           1.0 if any(f["f"][c]) else 0.0]))
    img, hit = pad(img, hit)
    save(np.where(hit[..., None], img, 0.0), f"{prefix}_flow.png")
    curv = {id(f): curvature(f) for f in left}
    scale = np.percentile(np.abs(list(curv.values())), 95)
    img, hit = rasterize(left, size, lambda f, c: np.array([0.5 + 0.5 * np.clip(curv[id(f)] / scale, -1, 1)] * 3))
    img, hit = pad(img, hit)
    save(np.where(hit[..., None], img, 0.5), f"{prefix}_curvature.png")
    info["position_box"] = {"min": [round(float(x), 4) for x in lo], "max": [round(float(x), 4) for x in hi]}


def main():
    data = json.load(open(os.path.join(tempfile.gettempdir(), "pteranodon_surface.json")))
    faces = data["faces"]
    mats = data["materials"]
    info = {}
    for m, name in enumerate(mats):
        size = SIZE[name]
        mine = [f for f in faces if f["m"] == m]
        left = [f for f in mine if np.mean(np.array(f["p"])[:, 0]) > 0]
        bad = flipped(left)
        if bad:
            print(f"draw: {name}: faces laid the other way round from their piece:", bad)
        pic, colours = pieces(left, size)
        published = os.path.join(HERE, f"{name}_pieces.png")
        if name == "pteranodon" and os.path.exists(published) and "--new-layout" not in sys.argv:
            old = np.array(Image.open(published).convert("RGB"))
            gone = moved(old, pic, colours) if old.shape == pic.shape else {"(another size)": 1}
            if gone or (old != pic).any():
                sys.exit("draw: the layout moved, and paint is on it; nothing was drawn. Texels gained or lost: " +
                         (", ".join(f"{k} {v}" for k, v in sorted(gone.items())) or "a piece no longer here") +
                         ". With a new layout agreed with the texture maker, run again with --new-layout.")
        Image.fromarray(pic).save(published)
        part = {"size": size}
        maps(left, size, name, part)
        rename = (lambda n: n.replace("_l", "")) if name == "pteranodon" else (lambda n: n.replace("membrane_", "membrane, ").replace("_l", ""))
        title = (f"{name}: the animal's left side; the right side is its mirror" if name == "pteranodon" else
                 f"{name}: the left wing; the right wing is its mirror. Membrane above as seen from above, below it as seen from below")
        layout(left, size, title, labels_of(left, rename)).save(os.path.join(HERE, f"{name}_layout.png"))
        part.update({
            f"{name}_layout.png": "the texture's pieces in soft region colours, named",
            f"{name}_pieces.png": "each texel's piece in the piece's colour (below), black where there is none: a mask for each piece",
            "pieces": {k: "#%02X%02X%02X" % v for k, v in sorted(colours.items())},
            f"{name}_regions.png": "the colour regions where the model places them, in the build's colours: red patterning, green wing base, blue face crest and hands (the horn), cyan inner crest (the band), magenta wing membrane, yellow body; black is never dyed (eyes, claws, the inside of the mouth). A guide, face by face: paint the real edges",
            f"{name}_position.png": "each texel's place on the animal at rest, (x left, y up, z forward) scaled from position_box to 0..1",
            f"{name}_normal_object.png": "the surface normal in the animal's frame (x left, y up, z forward), 0.5 + 0.5 n; on the membrane each face's own side",
            f"{name}_flow.png": "which way the fuzz lies (and on the membrane, which way the veins run), as a direction in the picture: red = 0.5 + 0.5 u, green = 0.5 + 0.5 v (v up the picture); blue 1 where it is defined",
            f"{name}_curvature.png": "grey 0.5 is flat; lighter bulges, darker hollows",
            f"{name}_occlusion.png": "ambient occlusion from the whole animal at rest, the glide",
        })
        if name == "pteranodon_wing":
            part["note"] = ("The membrane's two faces are views of the left wing: its upper face (top band) as the "
                            "concept's top view shows it, its under face (middle band) as the underside view shows "
                            "it, at %.0f texels a metre. Below them the arm (shoulder to knuckle) and the wing finger "
                            "(knuckle to tip), each a strip along its length, cut along the back where the membrane "
                            "goes in." % (data["wing_uv"]["scale"] * size))
        info["material " + name] = part
    with open(os.path.join(HERE, "bakes.json"), "w") as fh:
        json.dump(info, fh, indent=1)
    print("draw: wrote the bakes to", HERE)


main()

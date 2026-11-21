"""Trim atlases for the Miami instruments: eight strips each, 2048 pixels long and 256 tall, at 64 pixels a metre.

A strip is 32 m of a course 4 m tall. It tiles along its length and never across: a face shows it from its top edge to
its bottom, so what hangs (a rust weep, a salt run, a drip of verdigris) is painted down the strip and hangs true on any
course laid level. `instrument` is what all three wear; `livery` is the Sextant's fired enamel and the Lantern's copper.

The colour's weathering comes from flat-lit scans (tex/scan-a.png, scan-b.png, four materials each), laid as a field
that does not repeat within the strip. Everything with a shape (joints, laps, rivets, weeps, graduations) is painted
here in metres, and the height, the roughness and the metal are painted with it and never read off the colour, apart
from the scans' own fine grain.
"""

from pathlib import Path
import numpy as np
from PIL import Image

HERE = Path(__file__).parent
OUT = HERE / "tex"
W, S, PXM = 2048, 256, 64
TILE = 512
V, U = np.mgrid[:S, :W].astype(np.float32)
# The part of a strip a face shows: instrument.py leaves 4% of it above and below.
TOP, FOOT = 0.04 * S, 0.96 * S
BAND = FOOT - TOP


def clamp(x, lo=0.0, hi=1.0):
    return np.maximum(x, lo) if hi is None else np.minimum(np.maximum(x, lo), hi)


def smooth(x, a, b):
    t = clamp((x - a) / (b - a))
    return t * t * (3 - 2 * t)


def wrapped(u, at):
    """Pixels from `at` along the strip, the short way round."""
    return (u - at + W / 2) % W - W / 2


def cloud(seed, across, down, beta=1.6):
    """Noise that tiles along the strip, about -1 to 1: features `across` pixels wide and `down` tall."""
    r = np.random.default_rng(seed)
    spectrum = np.fft.rfft2(r.normal(0, 1, (2 * S, W)))
    fy = np.fft.fftfreq(2 * S)[:, None] * down
    fx = np.fft.rfftfreq(W)[None, :] * across
    f = np.sqrt(fx * fx + fy * fy)
    gain = 1 / np.maximum(f, 0.35) ** beta * np.exp(-((f / 6.0) ** 2))
    gain[0, 0] = 0
    out = np.fft.irfft2(spectrum * gain, (2 * S, W))[:S]
    return (out / (out.std() + 1e-9) / 2.2).astype(np.float32)


def blur(a, sigma):
    """Gaussian, wrapping along the strip and reflecting across it."""
    pad = int(3 * sigma) + 1
    b = np.pad(a, ((pad, pad), (0, 0)) + ((0, 0),) * (a.ndim - 2), mode="reflect")
    fy = np.fft.fftfreq(b.shape[0])[:, None]
    fx = np.fft.rfftfreq(b.shape[1])[None, :]
    kernel = np.exp(-2 * (np.pi * sigma) ** 2 * (fx * fx + fy * fy))
    if a.ndim == 3:
        out = np.stack([np.fft.irfft2(np.fft.rfft2(b[..., c]) * kernel, b.shape[:2]) for c in range(a.shape[2])], -1)
    else:
        out = np.fft.irfft2(np.fft.rfft2(b) * kernel, b.shape[:2])
    return out[pad:-pad].astype(np.float32)


# The scans: a material to a quarter of each sheet.
def quarters(name):
    im = np.asarray(Image.open(OUT / name).convert("RGB"), dtype=np.float32)
    h, w = im.shape[0] // 2, im.shape[1] // 2
    cut = 6
    return [
        np.asarray(
            Image.fromarray(im[r * h + cut : (r + 1) * h - cut, c * w + cut : (c + 1) * w - cut].astype(np.uint8)).resize(
                (TILE, TILE), Image.Resampling.LANCZOS
            ),
            dtype=np.float32,
        )
        for r in range(2)
        for c in range(2)
    ]


def tiling(q, both=True):
    """A scan that meets itself at its edges: each edge is crossed with the scan's own middle, moved half its size."""
    n = q.shape[1]
    ramp = smooth(np.minimum(np.arange(n), n - 1 - np.arange(n)).astype(np.float32), 0, n * 0.22)
    mean = q.mean((0, 1))

    def cross(a, weight, axis):
        w = weight[None, :, None] if axis == 1 else weight[:, None, None]
        mixed = (a - mean) * w + (np.roll(a, n // 2, axis) - mean) * (1 - w)
        # Two layers crossed lose contrast where they are half and half. Give it back.
        return mean + mixed / np.sqrt(w * w + (1 - w) ** 2)

    out = cross(q, ramp, 1)
    return cross(out, ramp, 0) if both else out


def field(tile, seed, flips=True):
    """The strip filled from a tiling scan, four copies of it laid over one another at their own places and crossed by
    clouds, so the eye finds no copy twice. It tiles along the strip, as 2048 is four of the scan."""
    r = np.random.default_rng(seed)
    mean = tile.mean((0, 1))
    total = np.zeros((S, W, 3), np.float32)
    norm = np.zeros((S, W, 1), np.float32)
    for k in range(4):
        t = tile[:, ::-1] if flips and k % 2 else tile
        oy, ox = int(r.integers(0, TILE)), int(r.integers(0, TILE))
        layer = t[(np.arange(S)[:, None] + oy) % TILE, (np.arange(W)[None, :] + ox) % TILE]
        w = clamp(0.5 + 1.9 * cloud(seed * 31 + k, 300 + 90 * k, 150))[..., None] ** 2 + 0.02
        total += (layer - mean) * w
        norm += w * w
    return mean + total / np.sqrt(norm)


def grain(rgb, sigma=2.5):
    """A scan's fine relief, as its light and dark against its own blur: about -1 to 1."""
    lum = rgb @ np.array([0.30, 0.59, 0.11], np.float32)
    fine = lum - blur(lum, sigma)
    return fine / (fine.std() * 3 + 1e-6)


def toned(rgb, colour, keep=1.0):
    """The scan's variation about `colour` in place of about its own mean."""
    return np.asarray(colour, np.float32) + (rgb - rgb.mean((0, 1))) * keep


def joints(places, half=1.6):
    """Grooves across the strip at these places along it: 1 in the groove."""
    g = np.zeros((S, W), np.float32)
    for at in places:
        g = np.maximum(g, np.exp(-((wrapped(U, at) / half) ** 2)))
    return g


def studs(pitch, rows, radius, offset=0.0):
    """Round heads every `pitch` along the strip on each of `rows`: a dome 0 to 1, and the dark ring round its foot."""
    du = (U + offset) % pitch - pitch / 2
    d = np.full((S, W), 1e9, np.float32)
    for row in rows:
        d = np.minimum(d, np.hypot(du, V - row))
    dome = np.sqrt(clamp(1 - (d / radius) ** 2))
    ring = np.exp(-(((d - radius * 1.25) / (radius * 0.45)) ** 2))
    return dome, ring


def weeps(seed, sources, width=2.2, length=120.0, spread=0.03):
    """What runs down from each (u, v, strength): narrow at its head, wider and fainter as it falls, never quite straight."""
    r = np.random.default_rng(seed)
    out = np.zeros((S, W), np.float32)
    wander = cloud(seed + 5, 40, 900, 1.2) * 5
    for u0, v0, strength in sources:
        fall = V - v0
        reach = length * (0.45 + 1.1 * r.random())
        half = width * (0.7 + 0.7 * r.random()) + spread * clamp(fall, 0, None)
        across = wrapped(U, u0) - wander * smooth(fall, 0, 60)
        body = np.exp(-((across / half) ** 2)) * smooth(fall, -1.5, 3) * np.exp(-clamp(fall, 0, None) / reach)
        out = np.maximum(out, strength * body)
    return out


def lap(depth=13.0):
    """The shade under the course above, and the wet line a course leaves at its own foot."""
    under = np.exp(-clamp(V - TOP, 0, None) / depth)
    foot = np.exp(-clamp(FOOT - V, 0, None) / 5.0)
    return under, foot


def strip():
    return {
        "base": np.zeros((S, W, 3), np.float32),
        "height": np.full((S, W), 0.5, np.float32),
        "ao": np.ones((S, W), np.float32),
        "rough": np.full((S, W), 0.5, np.float32),
        "metal": np.zeros((S, W), np.float32),
        "mask": np.zeros((S, W), np.float32),
    }


def stain(base, amount, colour):
    """Multiply towards `colour` (of 1) where `amount` is 1."""
    return base * (1 - amount[..., None] * (1 - np.asarray(colour, np.float32)))


def over(base, amount, colour):
    return base * (1 - amount[..., None]) + np.asarray(colour, np.float32) * amount[..., None]


SCAN = {}


def scans():
    a, b = quarters("scan-a.png"), quarters("scan-b.png")
    names = ["ceramic", "bronze", "steel", "paving", "enamel", "verdigris", "brass", "glass"]
    for name, q in zip(names, a + b):
        # What runs in a scan runs down it: those are made to tile along the strip's length alone.
        SCAN[name] = tiling(q)


RUST = (0.74, 0.47, 0.27)
GRIME = (0.63, 0.61, 0.56)
SALT = (236, 233, 224)


def ceramic(seed, places, tone, wear):
    """A course of glazed cladding: plates between `places`, lapped under the course above, bolted at their corners."""
    s = strip()
    glaze = toned(field(SCAN["ceramic"], seed), tone, 0.85)
    fine = grain(glaze)
    groove = joints(places, 1.7)
    shoulder = joints(places, 7.0)
    under, foot = lap()
    # Each plate has its own firing: a shade warmer or cooler, lighter or darker.
    r = np.random.default_rng(seed)
    edges = sorted(places) + [places[0] + W]
    plate = np.zeros((S, W), np.float32)
    warm = np.zeros((S, W), np.float32)
    inside = np.ones((S, W), np.float32)
    bolts = []
    for a, b in zip(edges, edges[1:]):
        within = ((U - a) % W) < (b - a)
        plate[within] = r.normal(0, 1)
        warm[within] = r.normal(0, 1)
        x = ((U - a) % W) / (b - a)
        y = (V - TOP) / BAND
        pillow = (1 - np.abs(2 * x - 1) ** 10) * (1 - np.abs(2 * clamp(y) - 1) ** 10)
        inside = np.where(within, pillow, inside)
        for du in (26, b - a - 26):
            bolts.append((a + du) % W)
    glaze = glaze * (1 + 0.035 * plate[..., None]) + warm[..., None] * np.array([2.5, 0.5, -3.0], np.float32)
    # Bolt heads near each plate's top corners and its foot, bronze caps weeping rust.
    head = np.zeros((S, W), np.float32)
    ring = np.zeros((S, W), np.float32)
    for at in bolts:
        for row in (TOP + 22, FOOT - 20):
            d = np.hypot(wrapped(U, at), V - row)
            head = np.maximum(head, np.sqrt(clamp(1 - (d / 3.6) ** 2)))
            ring = np.maximum(ring, np.exp(-(((d - 4.6) / 1.5) ** 2)))
    sources = [(at + r.normal(0, 1), TOP + 25, 0.35 + 0.65 * r.random() ** 2) for at in bolts]
    sources += [(r.random() * W, TOP + 2 + 5 * r.random(), 0.2 + 0.5 * r.random() ** 2) for _ in range(int(10 * wear))]
    sources += [(at + r.normal(0, 2), TOP + 8 + 30 * r.random(), 0.5 * r.random()) for at in places for _ in range(2)]
    rust = weeps(seed + 1, sources, 2.4, 110 * (0.7 + 0.5 * wear), 0.045) * (0.7 + 0.5 * wear)
    rust *= 0.75 + 0.5 * clamp(0.5 + cloud(seed + 2, 30, 30))
    damp = clamp(0.7 * under + 0.4 * foot + 0.5 * cloud(seed + 3, 500, 90) * under + 0.22 * smooth(cloud(seed + 8, 260, 420), 0.1, 0.7) * wear) * (0.65 + 0.4 * wear)
    # Chips where a plate's edge has been knocked: the grey body under the glaze.
    edge = np.maximum(shoulder, 0.8 * np.maximum(np.exp(-clamp(V - TOP, 0, None) / 3.0), np.exp(-clamp(FOOT - V, 0, None) / 3.0)))
    chip = smooth(cloud(seed + 4, 26, 22, 1.1) + 0.8 * edge - 1.42 + 0.2 * wear, 0, 0.12) * (1 - groove)
    salt = smooth(cloud(seed + 6, 120, 70) + 0.55 * foot + 0.25 * wear, 0.62, 0.95) * (1 - under * 0.7)
    base = stain(glaze, damp, GRIME)
    base = stain(base, clamp(rust * 1.45), RUST)
    base = over(base, 0.55 * salt, SALT)
    base = over(base, chip, (128, 124, 116))
    base = over(base, groove, (36, 34, 32))
    base = over(base, clamp(head * 1.4), (120, 86, 52))
    base = stain(base, 0.5 * ring, (0.5, 0.42, 0.36))
    s["base"] = base
    s["height"] = (
        0.5 + 0.13 * inside - 0.30 * groove + 0.014 * fine - 0.10 * chip + 0.022 * salt + 0.10 * head - 0.04 * ring
        - 0.04 * under * smooth(V, TOP + 3, TOP)
    )
    s["ao"] = clamp(1 - 0.42 * under - 0.6 * groove - 0.3 * ring - 0.12 * foot)
    s["rough"] = clamp(0.30 + 0.09 * cloud(seed + 7, 90, 90) + 0.42 * salt + 0.35 * rust + 0.5 * chip + 0.55 * groove + 0.2 * damp, 0.16, 0.95)
    s["metal"] = clamp(0.9 * head)
    return s


def bronze(seed):
    """A cast flange: a raised lip along each edge, round heads inside it, patina in the field and polish on the lips."""
    s = strip()
    cast = field(SCAN["bronze"], seed)
    fine = grain(cast)
    lip = np.maximum(np.exp(-(((V - TOP - 9) / 6.5) ** 2)), np.exp(-(((FOOT - 9 - V) / 6.5) ** 2)))
    dome, ring = studs(32, (TOP + 27, FOOT - 27), 4.2, seed % 17)
    weld = joints([256, 1280], 2.2)
    # Verdigris gathers in the pits and under each head, and runs from them.
    r = np.random.default_rng(seed)
    heads = [(k * 32 + 16 - seed % 17, TOP + 30, 0.25 + 0.6 * r.random() ** 3) for k in range(W // 32)]
    run = weeps(seed + 1, heads, 2.4, 70, 0.05)
    green = clamp(smooth(cloud(seed + 2, 80, 60) + 0.3 * ring, 0.45, 0.9) * 0.8 + run * 0.9) * (1 - lip)
    polish = clamp(lip * (0.55 + 0.6 * cloud(seed + 3, 140, 30)) + 0.8 * dome * smooth(cloud(seed + 4, 60, 60), -0.4, 0.4))
    base = cast * 1.06
    base = over(base, 0.62 * green, (86, 142, 122))
    base = over(base, 0.72 * polish, (196, 142, 84))
    base = stain(base, 0.6 * ring + 0.7 * weld, (0.42, 0.38, 0.36))
    s["base"] = base
    s["height"] = 0.46 + 0.17 * lip + 0.2 * dome - 0.05 * ring - 0.16 * weld + 0.03 * fine + 0.02 * green
    s["ao"] = clamp(1 - 0.45 * ring - 0.4 * weld - 0.12 * (1 - lip) * smooth(np.abs(V - S / 2), 80, 110))
    s["rough"] = clamp(0.52 + 0.1 * cloud(seed + 5, 70, 70) + 0.3 * green - 0.33 * polish + 0.2 * weld, 0.14, 0.95)
    s["metal"] = clamp(0.95 - 0.8 * green - 0.3 * ring)
    return s


def steel(seed):
    """Blued structural plate: riveted along both edges, welded every 8 m, salt running down it, freckled with rust."""
    s = strip()
    plate = field(SCAN["steel"], seed) * 0.92
    fine = grain(plate)
    dome, ring = studs(32, (TOP + 14, FOOT - 14), 3.0, 0)
    seam = joints([208, 720, 1232, 1744], 1.5)
    bead = joints([208, 720, 1232, 1744], 4.5)
    r = np.random.default_rng(seed)
    runs = weeps(seed + 1, [(r.random() * W, TOP + r.random() * 30, 0.3 + 0.7 * r.random()) for _ in range(34)], 1.6, 150, 0.02)
    rust = smooth(cloud(seed + 2, 14, 14, 0.9) + 0.4 * cloud(seed + 3, 200, 120) + 0.7 * ring, 0.98, 1.25)
    worn = np.maximum(np.exp(-clamp(V - TOP, 0, None) / 3.0), np.exp(-clamp(FOOT - V, 0, None) / 3.0)) * smooth(cloud(seed + 4, 60, 20), -0.2, 0.5)
    base = over(plate, 0.33 * runs, (190, 192, 188))
    base = over(base, 0.75 * rust, (108, 62, 38))
    base = over(base, 0.6 * worn + 0.5 * dome * smooth(cloud(seed + 5, 50, 50), 0, 0.5), (126, 134, 142))
    base = stain(base, 0.6 * ring + 0.5 * seam, (0.4, 0.4, 0.42))
    s["base"] = base
    s["height"] = 0.5 + 0.2 * dome - 0.05 * ring + 0.07 * bead - 0.2 * seam + 0.03 * fine + 0.04 * rust + 0.015 * runs
    s["ao"] = clamp(1 - 0.5 * ring - 0.5 * seam)
    s["rough"] = clamp(0.5 + 0.1 * cloud(seed + 6, 80, 80) + 0.4 * rust + 0.22 * runs - 0.28 * worn, 0.18, 0.95)
    s["metal"] = clamp(0.88 - 0.85 * rust - 0.4 * runs)
    return s


def glass(seed):
    """Cut optical glass in a bronze came: blocks 2 m long, bevelled all round, with cords and seeds in the body. The
    glass is pale and takes the site's dye; the came does not."""
    s = strip()
    body = toned(field(SCAN["glass"], seed), (214, 222, 232), 0.9)
    fine = grain(body, 1.5)
    block = 128
    x = ((U + 64) % block) / block
    y = clamp((V - TOP) / BAND)
    # Distance into the block from its nearest edge, in pixels.
    inset = np.minimum(np.minimum(x, 1 - x) * block, np.minimum(y, 1 - y) * BAND)
    came = smooth(inset, 5.0, 3.0)
    bevel = smooth(inset, 5.0, 19.0)
    table = smooth(inset, 19.0, 21.0)
    # The bevel leans four ways, so each face of a block takes the sky differently.
    facet = np.where(np.minimum(x, 1 - x) * block < np.minimum(y, 1 - y) * BAND, np.sign(x - 0.5) * 0.5, np.sign(y - 0.5))
    deep = 0.5 + 0.5 * cloud(seed + 1, 220, 120)
    base = body * (0.80 + 0.14 * bevel)[..., None] + 14 * ((1 - table) * (0.5 + 0.5 * facet))[..., None]
    base = base * (0.93 + 0.14 * deep)[..., None]
    base = base * (1 - came[..., None]) + toned(field(SCAN["bronze"], seed + 3), (118, 86, 54), 0.8) * came[..., None]
    s["base"] = base
    s["height"] = 0.34 + 0.34 * bevel + 0.012 * fine * table - 0.1 * smooth(inset, 3.0, 0.5) + 0.12 * came * smooth(inset, 0.5, 3.0)
    s["ao"] = clamp(1 - 0.4 * np.exp(-(((inset - 5.0) / 2.0) ** 2)))
    s["rough"] = clamp(0.07 + 0.05 * (1 - table) + 0.05 * clamp(fine) + 0.4 * came + 0.06 * cloud(seed + 2, 160, 160), 0.05, 0.9)
    s["metal"] = clamp(0.9 * came)
    s["mask"] = 1 - smooth(inset, 6.0, 4.0)
    return s


def paving(seed):
    """Deck plates: cast stone 4 m long with a joint at each end and along the course, salt drifted against the joints,
    and shallow places that hold water and show the sky."""
    s = strip()
    stone = toned(field(SCAN["paving"], seed), (150, 147, 138), 0.95)
    fine = grain(stone, 2.0)
    places = [128, 384, 640, 896, 1152, 1408, 1664, 1920]
    groove = np.maximum(joints(places, 1.4), np.maximum(np.exp(-(((V - TOP - 1) / 1.6) ** 2)), np.exp(-(((FOOT - 1 - V) / 1.6) ** 2))))
    near = np.maximum(joints(places, 12.0), np.maximum(np.exp(-clamp(V - TOP, 0, None) / 12.0), np.exp(-clamp(FOOT - V, 0, None) / 12.0)))
    r = np.random.default_rng(seed)
    slab = np.zeros((S, W), np.float32)
    for k, a in enumerate(places):
        slab[((U - a) % W) < 256] = r.normal(0, 1)
    pool = smooth(cloud(seed + 1, 300, 160) - 0.25 * near, 0.38, 0.62)
    salt = smooth(cloud(seed + 2, 110, 80) + 0.6 * near - 0.6 * pool, 0.55, 0.95)
    base = stone * (1 + 0.03 * slab[..., None])
    base = stain(base, 0.42 * pool, (0.62, 0.64, 0.66))
    base = over(base, 0.6 * salt, SALT)
    base = over(base, groove, (40, 40, 38))
    s["base"] = base
    s["height"] = 0.52 - 0.3 * groove + 0.03 * fine * (1 - pool) - 0.035 * pool + 0.02 * salt
    s["ao"] = clamp(1 - 0.55 * groove)
    s["rough"] = clamp(0.78 + 0.08 * cloud(seed + 3, 60, 60) - 0.66 * pool + 0.1 * salt + 0.1 * groove, 0.08, 0.96)
    return s


def brass(seed):
    """A graduated register: brushed along its length, a fine mark every 25 cm, a longer one each metre and the longest
    every fourth, cut in and filled dark, between two polished beads."""
    s = strip()
    sheet = toned(field(SCAN["brass"], seed, flips=False), (196, 158, 84), 0.7)
    # The scan's fingermarks would say how large it is. Keep its brushing and its broad tarnish alone.
    sheet = blur(sheet, 18.0) + (sheet - blur(sheet, 2.2)) * 1.1
    brush = cloud(seed + 1, 240, 1.6, 0.8)
    bead = np.maximum(np.exp(-(((V - TOP - 12) / 5.0) ** 2)), np.exp(-(((FOOT - 12 - V) / 5.0) ** 2)))
    rule = np.maximum(np.exp(-(((V - TOP - 24) / 1.2) ** 2)), np.exp(-(((FOOT - 24 - V) / 1.2) ** 2)))
    m = U % 16
    long = np.where((U % 256) < 16, FOOT - 150, np.where((U % 64) < 16, FOOT - 105, FOOT - 70))
    tick = np.exp(-(((m - 8) / 1.15) ** 2)) * smooth(V, long - 2, long + 1) * smooth(V, FOOT - 26, FOOT - 29)
    # A lozenge at each fourth metre, in place of a figure a mirrored face would turn about.
    lozenge = smooth(1 - (np.abs(wrapped(U, 8) % 256 - 0) / 9 + np.abs(V - TOP - 52) / 14), 0, 0.12) * ((U % 256) < 40)
    cut = clamp(tick + rule + lozenge)
    tarnish = smooth(cloud(seed + 2, 190, 120) + 0.5 * cut, 0.5, 0.95)
    base = stain(sheet, 0.5 * tarnish, (0.62, 0.5, 0.36))
    base = over(base, 0.5 * bead, (228, 196, 120))
    base = over(base, 0.92 * cut, (30, 24, 18))
    s["base"] = base
    s["height"] = 0.5 + 0.16 * bead - 0.2 * cut + 0.02 * brush
    s["ao"] = clamp(1 - 0.5 * cut)
    s["rough"] = clamp(0.24 + 0.06 * brush + 0.3 * tarnish - 0.1 * bead + 0.5 * cut, 0.12, 0.9)
    s["metal"] = clamp(1 - 0.9 * cut - 0.15 * tarnish)
    return s


def vents(seed):
    """The underplate: dark steel in frames 2 m long, each with a bank of slots that breathe, soot above every slot."""
    s = strip()
    plate = field(SCAN["steel"], seed) * 0.72
    fine = grain(plate)
    bay = 128
    x = (U + 64) % bay
    frame = np.maximum(np.exp(-(((x - 4) / 3.0) ** 2)) + np.exp(-(((bay - 4 - x) / 3.0) ** 2)), np.maximum(np.exp(-(((V - TOP - 8) / 4.0) ** 2)), np.exp(-(((FOOT - 8 - V) / 4.0) ** 2))))
    frame = clamp(frame)
    k = (x - 20) % 11
    slot = (smooth(k, 1.5, 3.0) * smooth(k, 7.5, 6.0)) * (x > 18) * (x < bay - 18) * smooth(V, TOP + 34, TOP + 38) * smooth(V, FOOT - 34, FOOT - 38)
    lip = (np.exp(-(((k - 2.2) / 0.9) ** 2)) + np.exp(-(((k - 7.0) / 0.9) ** 2))) * (x > 18) * (x < bay - 18) * smooth(V, TOP + 30, TOP + 36) * smooth(V, FOOT - 30, FOOT - 36)
    soot = blur(slot.astype(np.float32), 5.0) * smooth(V, S * 0.6, S * 0.2)
    dome, ring = studs(bay, (TOP + 20, FOOT - 20), 2.6, bay / 2 - 12)
    base = stain(plate, 0.5 * soot, (0.5, 0.48, 0.46))
    base = over(base, 0.94 * slot, (8, 9, 10))
    base = over(base, 0.4 * clamp(lip) + 0.35 * frame * smooth(cloud(seed + 1, 40, 40), 0, 0.5), (110, 118, 126))
    base = stain(base, 0.5 * ring, (0.45, 0.45, 0.45))
    s["base"] = base
    s["height"] = 0.5 + 0.12 * frame - 0.34 * slot + 0.1 * clamp(lip) + 0.14 * dome + 0.02 * fine
    s["ao"] = clamp(1 - 0.75 * slot - 0.3 * ring - 0.2 * soot)
    s["rough"] = clamp(0.58 + 0.1 * cloud(seed + 2, 70, 70) + 0.25 * soot - 0.2 * clamp(lip) + 0.3 * slot, 0.2, 0.95)
    s["metal"] = clamp(0.85 - 0.8 * slot - 0.3 * soot)
    return s


def enamel(seed, wear):
    """Fired carmine on steel plates 8 m long: glassy and a little mottled, chipped to its pale ground at the edges and
    where it has been struck, each chip rimmed with rust that has begun to run."""
    s = strip()
    red = toned(field(SCAN["enamel"], seed), (150, 24, 20), 1.0)
    fine = grain(red, 2.0)
    places = [96, 576, 1120, 1664]
    groove = joints(places, 1.6)
    shoulder = joints(places, 9.0)
    under, foot = lap(10.0)
    edge = np.maximum(shoulder, np.maximum(np.exp(-clamp(V - TOP, 0, None) / 4.0), np.exp(-clamp(FOOT - V, 0, None) / 4.0)))
    chips = cloud(seed + 1, 30, 26, 1.0) + 0.62 * edge + 0.34 * wear
    chip = smooth(chips, 1.2, 1.3) * (1 - groove)
    rim = smooth(chips, 1.08, 1.2) * (1 - chip) * (1 - groove)
    r = np.random.default_rng(seed)
    heads = [(r.random() * W, TOP + r.random() * BAND * 0.6, 0.3 + 0.7 * r.random()) for _ in range(int(8 + 16 * wear))]
    run = weeps(seed + 2, heads, 2.0, 80, 0.03) * smooth(blur(chip + rim, 6.0), 0.02, 0.2)
    dark = clamp(0.5 * under + 0.3 * cloud(seed + 3, 28, 400) * smooth(V, TOP, TOP + 40))
    dome, ring = studs(128, (TOP + 20, FOOT - 20), 3.4, 30)
    base = stain(red, 0.4 * clamp(dark), (0.55, 0.42, 0.42))
    base = over(base, chip, (212, 190, 150))
    base = over(base, 0.85 * rim, (74, 38, 24))
    base = stain(base, 0.7 * run, RUST)
    base = over(base, groove, (30, 16, 14))
    base = over(base, clamp(dome * 1.3), (176, 140, 84))
    base = stain(base, 0.5 * ring, (0.5, 0.4, 0.4))
    pillow = np.ones((S, W), np.float32)
    edges = places + [places[0] + W]
    for a, b in zip(edges, edges[1:]):
        x = ((U - a) % W) / (b - a)
        within = ((U - a) % W) < (b - a)
        y = clamp((V - TOP) / BAND)
        pillow = np.where(within, (1 - np.abs(2 * x - 1) ** 12) * (1 - np.abs(2 * y - 1) ** 8), pillow)
    s["base"] = base
    s["height"] = 0.5 + 0.1 * pillow - 0.3 * groove - 0.08 * chip - 0.03 * rim + 0.012 * fine + 0.12 * dome - 0.04 * ring
    s["ao"] = clamp(1 - 0.35 * under - 0.6 * groove - 0.3 * ring)
    s["rough"] = clamp(0.2 + 0.07 * cloud(seed + 4, 90, 90) + 0.55 * chip + 0.6 * rim + 0.4 * run + 0.5 * groove, 0.1, 0.95)
    s["metal"] = clamp(0.5 * rim + 0.95 * dome)
    return s


def harlequin(seed):
    """The keel's dress band: carmine and ivory lozenges in fired enamel, between two brass rules."""
    s = enamel(seed, 0.2)
    ivory = toned(field(SCAN["ceramic"], seed + 9), (222, 212, 186), 0.7)
    period = 256
    x = wrapped(U, 0) % period - period / 2
    y = V - S / 2
    diamond = smooth(1 - (np.abs(x) / (period / 2) + np.abs(y) / (BAND * 0.42)), 0.0, 0.03)
    inner = smooth(1 - (np.abs(x) / (period / 2) + np.abs(y) / (BAND * 0.42)), 0.42, 0.45)
    line = diamond * (1 - smooth(1 - (np.abs(x) / (period / 2) + np.abs(y) / (BAND * 0.42)), 0.05, 0.08))
    keep = s["rough"] > 0.6
    paint = clamp(diamond - inner) * (~keep)
    s["base"] = over(s["base"], paint, (0, 0, 0)) + ivory * paint[..., None]
    s["base"] = over(s["base"], 0.8 * line * (~keep), (176, 140, 84))
    rule = np.maximum(np.exp(-(((V - TOP - 8) / 3.0) ** 2)), np.exp(-(((FOOT - 8 - V) / 3.0) ** 2)))
    s["base"] = over(s["base"], 0.9 * rule, (190, 150, 86))
    s["metal"] = clamp(s["metal"] + 0.95 * rule + 0.8 * line * (~keep))
    s["rough"] = np.where(rule > 0.5, 0.26, s["rough"]).astype(np.float32)
    s["height"] = s["height"] + 0.08 * rule + 0.03 * line
    return s


def copper(seed, green):
    """Standing-seam copper sheet, a seam every metre: verdigris over dark oxide, washed pale where salt runs from the
    seams' clips, and worn back to bright metal along each seam's crown."""
    s = strip()
    patina = field(SCAN["verdigris"], seed)
    fine = grain(patina, 2.0)
    seam_at = U % 64 - 32
    crown = np.exp(-((seam_at / 3.0) ** 2))
    foot_of = np.exp(-(((np.abs(seam_at) - 6.5) / 2.2) ** 2))
    under, foot = lap(11.0)
    r = np.random.default_rng(seed)
    oxide = smooth(cloud(seed + 1, 140, 110) - 0.7 * green + 0.25, 0.1, 0.6)
    clips = [(k * 64 + 32, TOP + 10 + 40 * r.random(), 0.3 + 0.7 * r.random() ** 2) for k in range(W // 64) for _ in range(1)]
    run = weeps(seed + 2, clips, 2.2, 150, 0.03)
    bright = clamp(crown * smooth(cloud(seed + 3, 50, 120) + 0.9 - green, 0.2, 0.9) + 0.6 * np.exp(-clamp(FOOT - V, 0, None) / 3.0) * smooth(cloud(seed + 4, 40, 10), 0, 0.6))
    base = patina * (0.9 + 0.12 * green)
    base = over(base, 0.75 * oxide, (58, 46, 36))
    base = over(base, 0.5 * run, (178, 214, 200))
    base = over(base, 0.85 * bright, (196, 122, 82))
    base = stain(base, 0.5 * foot_of + 0.35 * under, (0.5, 0.52, 0.5))
    s["base"] = base
    s["height"] = 0.42 + 0.34 * crown - 0.08 * foot_of + 0.03 * fine * (1 - bright) + 0.02 * run
    s["ao"] = clamp(1 - 0.4 * foot_of - 0.35 * under)
    s["rough"] = clamp(0.74 + 0.08 * cloud(seed + 5, 70, 70) - 0.2 * oxide + 0.1 * run - 0.5 * bright, 0.16, 0.96)
    s["metal"] = clamp(0.1 + 0.5 * oxide + 0.88 * bright)
    return s


def bright_copper(seed):
    """A rolled copper lip: polished salmon metal brushed along its length, darkening to oxide at its edges, with a first
    bloom of green where water stands."""
    s = strip()
    sheet = toned(field(SCAN["brass"], seed, flips=False), (190, 116, 78), 0.6)
    sheet = blur(sheet, 18.0) + (sheet - blur(sheet, 2.2))
    brush = cloud(seed + 1, 260, 1.8, 0.8)
    edge = np.maximum(np.exp(-clamp(V - TOP, 0, None) / 16.0), np.exp(-clamp(FOOT - V, 0, None) / 16.0))
    oxide = smooth(cloud(seed + 2, 170, 60) + 0.9 * edge, 0.5, 1.1)
    green = smooth(cloud(seed + 3, 60, 40) + 1.0 * np.exp(-clamp(FOOT - V, 0, None) / 22.0), 0.75, 1.15)
    roll = np.sin(np.pi * clamp((V - TOP) / BAND))
    base = over(sheet, 0.7 * oxide, (72, 50, 38))
    base = over(base, 0.7 * green, (96, 168, 142))
    s["base"] = base
    s["height"] = 0.3 + 0.4 * roll + 0.02 * brush
    s["rough"] = clamp(0.2 + 0.06 * brush + 0.3 * oxide + 0.5 * green, 0.1, 0.95)
    s["metal"] = clamp(1 - 0.3 * oxide - 0.85 * green)
    return s


def scale_blocks(seed):
    """The bow's scale: ivory blocks 4 m long with a brass came between them, each cut with black graduations that are
    filled with pitch, long at the block's middle."""
    s = ceramic(seed, [128, 384, 640, 896, 1152, 1408, 1664, 1920], (228, 220, 198), 0.35)
    # A block is from one came to the next: its marks are placed within it.
    B = (U - 128) % 256
    m = U % 32
    long = np.where((B > 112) & (B < 144), TOP + 150, np.where((U % 64) < 32, TOP + 96, TOP + 62))
    tick = np.exp(-(((m - 16) / 1.6) ** 2)) * smooth(V, TOP + 30, TOP + 33) * smooth(V, long + 1, long - 2)
    tick *= (B > 30) & (B < 226)
    rule = np.exp(-(((V - TOP - 30) / 1.5) ** 2)) * ((B > 30) & (B < 226))
    cut = clamp(tick + rule)
    s["base"] = over(s["base"], 0.93 * cut, (24, 22, 20))
    s["height"] = s["height"] - 0.12 * cut
    s["rough"] = clamp(s["rough"] + 0.4 * cut)
    s["ao"] = clamp(s["ao"] - 0.3 * cut)
    return s


def atlas(strips):
    """The strips one over another. The last few rows are brought to the first: they lie outside what any face shows,
    and a picture that is said to tile is held to meeting itself there too."""
    out = {k: np.concatenate([s[k] for s in strips], 0) for k in strips[0]}
    for layer in out.values():
        for i in range(5):
            weight = (5 - i) / 5
            layer[-1 - i] = layer[-1 - i] * (1 - weight) + layer[0] * weight
    return out


def save(name, data):
    Image.fromarray(np.clip(data, 0, 255).round().astype(np.uint8)).save(OUT / (name + ".png"), optimize=True)


def write(prefix, a, regions=False):
    h = clamp(a["height"])
    # The slope is taken along the strip round its end, and across it within the strip alone.
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 5.0
    dy = np.zeros_like(h)
    for k in range(8):
        part = h[k * S : (k + 1) * S]
        d = np.empty_like(part)
        d[1:-1] = part[2:] - part[:-2]
        d[0] = d[1]
        d[-1] = d[-2]
        dy[k * S : (k + 1) * S] = d * 5.0
    nz = 1 / np.sqrt(1 + dx * dx + dy * dy)
    save(prefix + "base", a["base"])
    save(prefix + "normal", (np.stack([-dx * nz, dy * nz, nz], -1) * 0.5 + 0.5) * 255)
    save(prefix + "height", h * 255)
    save(prefix + "orm", np.stack([a["ao"], a["rough"], a["metal"]], -1) * 255)
    if regions:
        save(prefix + "regions", np.stack([a["mask"] > 0.5, np.zeros_like(h), np.zeros_like(h)], -1) * 255.0)


def main():
    scans()
    # Porcelain, cast bronze, dark steel, optical glass, paving, brass register, vented underplate, weathered porcelain.
    instrument = [
        ceramic(11, [96, 544, 1120, 1632], (228, 221, 200), 0.35),
        bronze(21),
        steel(31),
        glass(41),
        paving(51),
        brass(61),
        vents(71),
        ceramic(81, [160, 736, 1312, 1760], (216, 207, 184), 1.0),
    ]
    write("", atlas(instrument), regions=True)
    # Carmine enamel, the same chipped, the keel's lozenges, the bow's scale blocks; copper green, copper going dark,
    # bright rolled copper, and a second green.
    livery = [
        enamel(111, 0.15),
        enamel(121, 1.0),
        harlequin(131),
        scale_blocks(141),
        copper(151, 0.9),
        copper(161, 0.25),
        bright_copper(171),
        copper(181, 0.6),
    ]
    write("livery-", atlas(livery))


if __name__ == "__main__":
    main()

"""Paints the air freight machines' swatch atlases into tex/. Run with a Python that has numpy and Pillow:

    python3 assets/source/core/vehicles/air_freight/paint.py

Everything is drawn here from seeded noise; the lettering is Pillow's bundled Aileron face, which is CC0.
"""

from pathlib import Path
import math
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, str(Path(__file__).parent))
from swatch import GRID, HULL, HULL_SIDE, LAMP, LAMP_SIDE  # noqa: E402

OUT = Path(__file__).with_name("tex")
# The model maps a part's faces into its swatch inside this margin; wear is drawn just inside it.
INSET = 0.045


def noise(h, w, cells, rng, octaves=4, falloff=0.5):
    """Smooth fractal noise in about -1..1."""
    out = np.zeros((h, w), np.float32)
    amp, total = 1.0, 0.0
    for k in range(octaves):
        n = max(2, int(cells * 2 ** k))
        grid = rng.random((n + 1, n + 1)).astype(np.float32)
        img = Image.fromarray((grid * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
        out += amp * (np.asarray(img, np.float32) / 127.5 - 1)
        total += amp
        amp *= falloff
    return out / total


def coords(h, w):
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    return (x + 0.5) / w, (y + 0.5) / h


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


class Surface:
    def __init__(self, w, h, colour, rough, metal):
        self.w, self.h = w, h
        self.rgb = np.ones((h, w, 3), np.float32) * np.array(colour, np.float32)
        self.height = np.zeros((h, w), np.float32)
        self.rough = np.full((h, w), rough, np.float32)
        self.metal = np.full((h, w), metal, np.float32)
        self.ao = np.ones((h, w), np.float32)

    def tint(self, mask, colour, amount=1.0):
        m = (np.clip(mask, 0, 1) * amount)[..., None]
        self.rgb = self.rgb * (1 - m) + np.array(colour, np.float32) * m

    def shade(self, delta):
        self.rgb = self.rgb + delta[..., None]


def edge_distance(h, w):
    u, v = coords(h, w)
    # Distance from the mapped edge of the part, in shares of the shorter side.
    du = np.minimum(u - INSET, 1 - INSET - u) * (w / min(w, h))
    dv = np.minimum(v - INSET, 1 - INSET - v) * (h / min(w, h))
    return np.minimum(du, dv)


def weather(s, rng, wear=0.5, wear_colour=(96, 98, 100), grime=0.5, scratches=30, mottle=5.0, grain=2.0, chips=True):
    h, w = s.h, s.w
    s.shade(noise(h, w, 3, rng) * mottle + noise(h, w, 24, rng, 2) * grain)
    s.rough += noise(h, w, 6, rng, 3) * 0.06
    s.height += noise(h, w, 12, rng, 3) * 0.08
    if grime:
        _, v = coords(h, w)
        streak = np.clip(noise(h, w, 2, rng, 2) * 0.5 + 0.5, 0, 1)
        lower = smooth(0.45, 1.0, v) * grime * (0.6 + 0.4 * streak)
        s.tint(lower * smooth(-0.2, 0.6, noise(h, w, 8, rng, 3)), (30, 29, 27), 0.45)
        s.rough += lower * 0.12
    if wear:
        d = edge_distance(h, w)
        band = (1 - smooth(0.0, 0.006 + 0.012 * wear, d)) * (d > -0.004)
        n = noise(h, w, 22, rng, 3)
        mask = band * smooth(*np.quantile(n, [0.55 - wear * 0.4, 0.75 - wear * 0.4]), n)
        if chips:
            # A few chips of paint knocked off away from the edges.
            c = noise(h, w, 26, rng, 3)
            mask = np.maximum(mask, smooth(*np.quantile(c, [1 - wear * 0.012, 1 - wear * 0.006]), c) * 0.8)
        s.tint(mask, wear_colour, 0.85)
        s.metal = s.metal * (1 - mask) + 0.75 * mask
        s.rough = s.rough * (1 - mask) + 0.38 * mask
        s.height -= mask * 0.15
        # The gutter outside the mapped edge carries the edge's colour so mips do not bleed a seam.
        gutter = d < 0
        s.rgb[gutter] = s.rgb[gutter] * 0.85
    if scratches:
        img = Image.new("L", (w, h), 0)
        dr = ImageDraw.Draw(img)
        for _ in range(scratches):
            x, y = rng.random() * w, rng.random() * h
            a = rng.random() * math.tau if rng.random() < 0.6 else rng.normal(0, 0.3)
            ln = (0.03 + rng.random() * 0.12) * min(w, h)
            dr.line([(x, y), (x + math.cos(a) * ln, y + math.sin(a) * ln)], fill=int(90 + rng.random() * 120), width=1)
        m = np.asarray(img, np.float32) / 255
        s.tint(m, (120, 122, 124), 0.5)
        s.rough -= m * 0.2
        s.height -= m * 0.25


def screws(s, rng, every=0.1, r=0.0065, inset=0.075, colour=(40, 42, 44)):
    """Countersunk fasteners in a row just inside each edge."""
    h, w = s.h, s.w
    u, v = coords(h, w)
    scale = min(w, h)
    for edge in range(4):
        length = w if edge < 2 else h
        n = max(2, int(round((1 - 2 * inset) * length / (every * scale))))
        for k in range(n + 1):
            t = inset + (1 - 2 * inset) * k / n
            cu, cv = [(t, inset), (t, 1 - inset), (inset, t), (1 - inset, t)][edge]
            d = np.hypot((u - cu) * w, (v - cv) * h) / scale
            if d.min() > r * 2:
                continue
            head = 1 - smooth(r * 0.75, r, d)
            ring = (1 - smooth(r, r * 1.25, d)) - head
            slot = head * (np.abs(((u - cu) * w + (v - cv) * h) / scale) < r * 0.18)
            s.tint(ring, (20, 21, 22), 0.5)
            s.tint(head, colour, 0.6)
            s.tint(slot, (8, 8, 8), 0.9)
            s.height += head * 0.5 - ring * 0.3
            s.metal = s.metal * (1 - head) + 0.6 * head
            s.rough = s.rough * (1 - head) + 0.45 * head


def panel(colour, rough, metal, seed, wear=0.45, screw=True, fibre=0.0, seams=0):
    def make(w, h):
        rng = np.random.default_rng(seed)
        s = Surface(w, h, colour, rough, metal)
        if fibre:
            u, v = coords(h, w)
            weave = np.sin((u * w + v * h) * 0.9) * np.sin((u * w - v * h) * 0.9)
            s.shade(weave * fibre)
            s.height += weave * 0.03
        if seams:
            u, v = coords(h, w)
            lines = np.zeros((h, w), np.float32)
            for k in range(1, seams):
                t = INSET + (1 - 2 * INSET) * k / seams
                lines = np.maximum(lines, 1 - smooth(0.0, 2.2, np.abs(u - t) * w))
                lines = np.maximum(lines, 1 - smooth(0.0, 2.2, np.abs(v - t) * h))
            s.tint(lines, (14, 15, 16), 0.85)
            s.height -= lines * 0.9
            s.rough += lines * 0.15
            s.ao -= lines * 0.35
        weather(s, rng, wear=wear)
        if screw:
            screws(s, rng)
        return s
    return make


def steel(colour, rough, metal, seed, brushed=4.0, wear=0.6):
    def make(w, h):
        rng = np.random.default_rng(seed)
        s = Surface(w, h, colour, rough, metal)
        streak = np.asarray(Image.fromarray(((rng.random((h, max(4, w // 40))) * 255).astype(np.uint8))).resize((w, h), Image.BILINEAR), np.float32) / 255 - 0.5
        s.shade(streak * brushed)
        s.rough += streak * 0.08
        weather(s, rng, wear=wear, wear_colour=(150, 152, 155), grime=0.35, scratches=60, chips=False)
        return s
    return make


def chassis_paint(w, h):
    rng = np.random.default_rng(31)
    s = Surface(w, h, (27, 28, 29), 0.58, 0.25)
    weather(s, rng, wear=0.75, wear_colour=(88, 88, 86), grime=1.0, scratches=50)
    _, v = coords(h, w)
    road = smooth(0.35, 1, v) * np.clip(noise(h, w, 10, rng, 4) * 0.8 + 0.4, 0, 1)
    s.tint(road, (58, 52, 45), 0.5)
    s.rough += road * 0.2
    return s


def carbon(w, h):
    rng = np.random.default_rng(5)
    s = Surface(w, h, (26, 28, 30), 0.32, 0.15)
    c = 12
    y, x = np.mgrid[0:h, 0:w]
    i, j = x // c, y // c
    fx, fy = (x % c) / c, (y % c) / c
    across = ((i + j) // 2) % 2 == 0
    tow = np.where(across, np.sin(np.pi * fy), np.sin(np.pi * fx))
    sheen = np.where(across, 0.6 + 0.4 * np.sin(np.pi * fx), 0.25 + 0.3 * np.sin(np.pi * fy))
    s.shade((sheen * tow) * 14 - 4)
    s.height += tow * 0.25
    weather(s, rng, wear=0.2, grime=0.2, scratches=10, mottle=2, grain=1)
    return s


def hexes(w, h, hole=(9, 9, 10), rim=(56, 59, 62)):
    rng = np.random.default_rng(9)
    s = Surface(w, h, rim, 0.45, 0.6)
    size = 9.0
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    # Axial hex coordinates, rounded to the nearest cell, and the distance to its edge.
    q = (x * math.sqrt(3) / 3 - y / 3) / size
    r = (y * 2 / 3) / size
    cx, cz = q, r
    cy = -cx - cz
    rx, ry, rz = np.round(cx), np.round(cy), np.round(cz)
    dx, dy, dz = np.abs(rx - cx), np.abs(ry - cy), np.abs(rz - cz)
    fixx = (dx > dy) & (dx > dz)
    fixy = ~fixx & (dy > dz)
    rx = np.where(fixx, -ry - rz, rx)
    ry = np.where(fixy, -rx - rz, ry)
    d = np.maximum.reduce([np.abs(cx - rx), np.abs(cy - ry), np.abs(cz - rz)])
    inner = 1 - smooth(0.32, 0.38, d)
    s.tint(inner, hole)
    s.height += (1 - inner) * 0.8
    s.ao -= inner * 0.4
    s.rough += inner * 0.3
    weather(s, rng, wear=0.3, grime=0.3, scratches=8, mottle=3, grain=1)
    return s


def grip(w, h):
    rng = np.random.default_rng(13)
    s = Surface(w, h, (42, 44, 46), 0.88, 0.1)
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    p = 22.0
    a = np.abs(((x + y) % p) / p - 0.5) * 2
    b = np.abs(((x - y) % p) / p - 0.5) * 2
    diamond = (1 - smooth(0.05, 0.2, np.minimum(a, b))) * (((x // p + y // p) % 2) == 0)
    s.height += diamond * 0.6
    s.shade(diamond * 10)
    grit = (rng.random((h, w)) > 0.93).astype(np.float32)
    s.shade(grit * 18)
    s.height += grit * 0.2
    weather(s, rng, wear=0.5, grime=0.8, scratches=20)
    return s


def vent(w, h):
    rng = np.random.default_rng(17)
    s = Surface(w, h, (44, 46, 49), 0.55, 0.4)
    _, v = coords(h, w)
    period = 16.0
    f = ((v * h) % period) / period
    slat = smooth(0.15, 0.25, f) * (1 - smooth(0.78, 0.86, f))
    s.shade(slat * (1 - f) * 22 - (1 - slat) * 30)
    s.height += slat * (1 - f) * 0.9
    s.ao -= (1 - slat) * 0.5
    weather(s, rng, wear=0.4, grime=0.5, scratches=6)
    return s


def tread(w, h):
    rng = np.random.default_rng(19)
    s = Surface(w, h, (27, 27, 28), 0.92, 0.0)
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    # Circumferential ribs with angled sipes, as a drive tyre's.
    rib = np.abs(((x / w) * 5) % 1 - 0.5) < 0.08
    sipe = np.abs((((y + np.abs(x - w / 2) * 0.6) / 18.0) % 1) - 0.5) < 0.13
    groove = np.clip(rib.astype(np.float32) + sipe.astype(np.float32), 0, 1)
    s.tint(groove, (11, 11, 11))
    s.height -= groove
    s.ao -= groove * 0.4
    weather(s, rng, wear=0.0, grime=0.7, scratches=0, mottle=2, grain=2)
    return s


def mesh_screen(w, h):
    rng = np.random.default_rng(23)
    s = Surface(w, h, (14, 15, 16), 0.6, 0.5)
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    wire = np.maximum(np.abs(np.sin(x * math.pi / 5)), np.abs(np.sin(y * math.pi / 5))) ** 6
    s.tint(wire, (62, 64, 66))
    s.height += wire * 0.5
    weather(s, rng, wear=0.2, grime=0.3, scratches=0)
    return s


def lens(w, h):
    s = Surface(w, h, (10, 10, 11), 0.15, 0.4)
    u, v = coords(h, w)
    d = np.hypot(u - 0.5, v - 0.5) * 2
    glass = 1 - smooth(0.72, 0.76, d)
    # Coated optics: violet at the rim of the glass, green-blue deeper in, black at the centre.
    coat = np.stack([40 + 30 * d, 46 + 10 * (1 - d), 70 + 30 * d], -1)
    s.rgb = s.rgb * (1 - glass[..., None]) + coat * glass[..., None] * (0.35 + 0.65 * d[..., None])
    for r0, r1 in ((0.76, 0.8), (0.9, 0.93)):
        ring = smooth(r0 - 0.01, r0, d) * (1 - smooth(r1, r1 + 0.01, d))
        s.tint(ring, (70, 72, 75))
        s.metal = np.maximum(s.metal, ring * 0.9)
    glint = np.exp(-((u - 0.36) ** 2 + (v - 0.33) ** 2) / 0.004) + 0.5 * np.exp(-((u - 0.6) ** 2 + (v - 0.62) ** 2) / 0.0015)
    s.rgb += glint[..., None] * 220
    s.rough = np.where(glass > 0.5, 0.04, s.rough)
    s.metal = np.where(glass > 0.5, 0.7, s.metal)
    s.height += (1 - glass) * 0.4
    return s


def hazard(w, h):
    rng = np.random.default_rng(29)
    s = Surface(w, h, (40, 42, 44), 0.6, 0.1)
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    stripe = (((x + y) / (h * 0.55)) % 1) < 0.5
    s.tint(stripe.astype(np.float32), (118, 92, 42))
    weather(s, rng, wear=0.7, wear_colour=(70, 70, 70), grime=0.6, scratches=30)
    return s


def flat(colour, rough, metal, seed=0, wear=0.3, grime=0.3, scratches=8):
    def make(w, h):
        rng = np.random.default_rng(100 + seed)
        s = Surface(w, h, colour, rough, metal)
        weather(s, rng, wear=wear, grime=grime, scratches=scratches, mottle=3, grain=1.5)
        return s
    return make


def chrome(w, h):
    rng = np.random.default_rng(37)
    s = Surface(w, h, (196, 198, 202), 0.12, 1.0)
    _, v = coords(h, w)
    s.shade(np.sin(v * 40) * 8 + noise(h, w, 8, rng, 2) * 6)
    return s


def glass(w, h):
    s = Surface(w, h, (18, 24, 29), 0.06, 0.5)
    u, v = coords(h, w)
    streak = np.exp(-((u - v * 0.6 - 0.2) ** 2) / 0.004) * 0.6
    s.rgb += streak[..., None] * 60
    return s


def bolt(w, h):
    s = Surface(w, h, (70, 72, 74), 0.4, 0.85)
    u, v = coords(h, w)
    a = np.arctan2(v - 0.5, u - 0.5)
    d = np.hypot(u - 0.5, v - 0.5) * 2
    hexr = 0.7 / np.cos(((a + math.pi / 6) % (math.pi / 3)) - math.pi / 6)
    head = 1 - smooth(hexr - 0.04, hexr, d)
    s.shade(head * 20 - (1 - head) * 25)
    s.height += head
    return s


def gauge(w, h):
    s = Surface(w, h, (16, 17, 18), 0.2, 0.2)
    img = Image.new("L", (w, h), 0)
    dr = ImageDraw.Draw(img)
    c = w / 2
    for k in range(11):
        a = math.radians(225 - k * 27)
        dr.line([(c + math.cos(a) * w * 0.3, c - math.sin(a) * w * 0.3), (c + math.cos(a) * w * 0.4, c - math.sin(a) * w * 0.4)], fill=200, width=2)
    a = math.radians(120)
    dr.line([(c, c), (c + math.cos(a) * w * 0.36, c - math.sin(a) * w * 0.36)], fill=255, width=3)
    dr.ellipse([c - w * 0.45, c - w * 0.45, c + w * 0.45, c + w * 0.45], outline=120, width=3)
    m = np.asarray(img, np.float32) / 255
    s.tint(m, (160, 160, 150))
    return s


def screen(w, h):
    s = Surface(w, h, (10, 13, 15), 0.1, 0.3)
    _, v = coords(h, w)
    s.shade(((v * h) % 6 < 1).astype(np.float32) * 3)
    return s


FONT_CACHE = {}


def font(size):
    if size not in FONT_CACHE:
        FONT_CACHE[size] = ImageFont.load_default(size=size)
    return FONT_CACHE[size]


def stencil_text(img, text, box, fill, size, bridges=True):
    """Bold stencilled lettering centred in box, with the gaps a stencil leaves across each letter."""
    dr = ImageDraw.Draw(img)
    f = font(size)
    x0, y0, x1, y1 = box
    l, t, r, b = dr.textbbox((0, 0), text, font=f, stroke_width=max(1, size // 14))
    if r - l > (x1 - x0) * 0.92:
        size = int(size * (x1 - x0) * 0.92 / (r - l))
        f = font(size)
        l, t, r, b = dr.textbbox((0, 0), text, font=f, stroke_width=max(1, size // 14))
    x = (x0 + x1 - (r - l)) / 2 - l
    y = (y0 + y1 - (b - t)) / 2 - t
    mask = Image.new("L", img.size, 0)
    md = ImageDraw.Draw(mask)
    md.text((x, y), text, font=f, fill=255, stroke_width=max(1, size // 14), stroke_fill=255)
    if bridges:
        # Thin ties where a stencil holds its counters in.
        cy = (y0 + y1) / 2
        md.rectangle([x0, cy - size * 0.025, x1, cy + size * 0.025], fill=0)
    return np.asarray(mask, np.float32) / 255


def lettered(text, colour, background=(46, 49, 52), size_share=0.62, seed=0, arrows=False, frame=False):
    def make(w, h):
        rng = np.random.default_rng(300 + seed)
        s = Surface(w, h, background, 0.64, 0.08)
        img = Image.new("L", (w, h), 0)
        m = stencil_text(img, text, (0, 0, w, h), 255, int(h * size_share))
        if arrows:
            a = Image.new("L", (w, h), 0)
            dr = ImageDraw.Draw(a)
            for cx in (h * 0.55, w - h * 0.55):
                dr.polygon([(cx, h * 0.18), (cx + h * 0.3, h * 0.62), (cx + h * 0.12, h * 0.62), (cx + h * 0.12, h * 0.82), (cx - h * 0.12, h * 0.82), (cx - h * 0.12, h * 0.62), (cx - h * 0.3, h * 0.62)], fill=255)
            m = np.maximum(m, np.asarray(a, np.float32) / 255)
        if frame:
            u, v = coords(h, w)
            border = ((np.minimum(u, 1 - u) * w < 6) | (np.minimum(v, 1 - v) * h < 6)) & ((np.minimum(u, 1 - u) * w > 2) & (np.minimum(v, 1 - v) * h > 2))
            m = np.maximum(m, border.astype(np.float32))
        # Painted on, so worn where the panel is.
        n = noise(h, w, 30, rng, 3)
        worn = 1 - 0.7 * smooth(*np.quantile(n, [0.9, 0.97]), n)
        s.tint(m * worn, colour)
        s.height += m * 0.05
        weather(s, rng, wear=0.15, grime=0.3, scratches=6, mottle=3, grain=1.5)
        return s
    return make


def bay_number(n):
    def make(w, h):
        rng = np.random.default_rng(400 + n)
        s = Surface(w, h, (34, 36, 38), 0.6, 0.1)
        img = Image.new("L", (w, h), 0)
        m = stencil_text(img, str(n), (0, 0, w, h), 255, int(h * 0.78))
        u, v = coords(h, w)
        e = np.minimum(np.minimum(u, 1 - u), np.minimum(v, 1 - v))
        frame = ((e > 0.06) & (e < 0.1)).astype(np.float32)
        g = noise(h, w, 20, rng, 3)
        s.tint(np.maximum(m, frame) * (1 - 0.7 * smooth(*np.quantile(g, [0.9, 0.97]), g)), (122, 125, 126))
        weather(s, rng, wear=0.3, grime=0.2, scratches=6, mottle=2, grain=1.5)
        return s
    return make


def arrow(w, h):
    s = Surface(w, h, (40, 42, 44), 0.6, 0.1)
    img = Image.new("L", (w, h), 0)
    dr = ImageDraw.Draw(img)
    for k in range(2):
        y = h * (0.2 + k * 0.3)
        dr.polygon([(w * 0.5, y), (w * 0.85, y + h * 0.3), (w * 0.7, y + h * 0.3), (w * 0.5, y + h * 0.15), (w * 0.3, y + h * 0.3), (w * 0.15, y + h * 0.3)], fill=255)
    s.tint(np.asarray(img, np.float32) / 255, (122, 94, 44))
    return s


def data_plate(w, h):
    rng = np.random.default_rng(41)
    s = Surface(w, h, (92, 95, 95), 0.45, 0.7)
    img = Image.new("L", (w, h), 0)
    dr = ImageDraw.Draw(img)
    f = font(int(h * 0.13))
    lines = ["AFU-07  RACK ASSY 6-BAY", "MASS 14 200 KG   GVW 24 000", "LIFT LUGS 4 X 9 000 KG SWL", "SER 0417-22-B   LOT 9"]
    for k, line in enumerate(lines):
        dr.text((w * 0.06, h * (0.1 + k * 0.2)), line, font=f, fill=255)
    for k in range(40):
        x = w * (0.62 + k * 0.008)
        if rng.random() < 0.6:
            dr.rectangle([x, h * 0.78, x + rng.integers(1, 3), h * 0.92], fill=255)
    s.tint(np.asarray(img, np.float32) / 255, (24, 25, 26))
    weather(s, rng, wear=0.2, grime=0.5, scratches=10, mottle=3)
    for cu, cv in ((0.03, 0.08), (0.97, 0.08), (0.03, 0.92), (0.97, 0.92)):
        u, v = coords(h, w)
        d = np.hypot((u - cu) * w, (v - cv) * h)
        s.tint(1 - smooth(3, 5, d), (40, 40, 40))
    return s


def tyre_wall(w, h):
    rng = np.random.default_rng(43)
    s = Surface(w, h, (30, 30, 31), 0.85, 0.0)
    weather(s, rng, wear=0.0, grime=0.9, scratches=4, mottle=3, grain=2)
    return s


def blade(w, h):
    rng = np.random.default_rng(47)
    s = Surface(w, h, (36, 38, 40), 0.5, 0.15)
    u, v = coords(h, w)
    tip = smooth(0.86, 0.87, u) * (1 - smooth(0.93, 0.94, u))
    s.tint(tip, (128, 100, 46))
    edge = smooth(0.80, 0.81, u)
    s.tint(edge * (1 - tip), (58, 60, 62), 0.6)
    weather(s, rng, wear=0.3, grime=0.1, scratches=20, mottle=3)
    return s


def duct(w, h):
    rng = np.random.default_rng(53)
    s = Surface(w, h, (40, 43, 46), 0.48, 0.3)
    _, v = coords(h, w)
    band = smooth(0.48, 0.49, v) * (1 - smooth(0.56, 0.57, v))
    s.tint(band, (110, 86, 40), 0.8)
    weather(s, rng, wear=0.5, grime=0.2, scratches=30)
    return s


def hose(w, h):
    rng = np.random.default_rng(59)
    s = Surface(w, h, (22, 22, 23), 0.7, 0.05)
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    braid = np.sin((x + y) * 0.8) * np.sin((x - y) * 0.8)
    s.shade(braid * 6)
    s.height += braid * 0.2
    weather(s, rng, wear=0.0, grime=0.5, scratches=0, mottle=2)
    return s


def numbers(w, h):
    return lettered("07", (120, 123, 124), background=(46, 49, 52), size_share=0.8, seed=9)(w, h)


RECIPES = {
    "panel": panel((46, 49, 52), 0.64, 0.08, 1, fibre=0.8),
    "panel_b": panel((60, 64, 68), 0.5, 0.42, 2, wear=0.55),
    "panel_d": panel((30, 32, 34), 0.7, 0.1, 3, wear=0.4),
    "panel_l": panel((72, 75, 78), 0.55, 0.2, 4, wear=0.4),
    "panel_seamed": panel((48, 51, 54), 0.62, 0.1, 5, seams=3),
    "under": panel((34, 33, 32), 0.85, 0.15, 6, wear=0.6, screw=False),
    "panel_w": panel((112, 114, 110), 0.55, 0.1, 11, wear=0.6),
    "steel": steel((84, 87, 90), 0.38, 0.9, 7),
    "rail": steel((64, 67, 70), 0.42, 0.85, 8, brushed=6),
    "frame": steel((50, 52, 55), 0.5, 0.75, 10, brushed=3, wear=0.7),
    "chassis": chassis_paint,
    "carbon": carbon,
    "hex": hexes,
    "grip": grip,
    "vent": vent,
    "rim": flat((46, 48, 50), 0.52, 0.3, 1, wear=0.5, grime=0.6),
    "tread": tread,
    "mesh": mesh_screen,
    "lens": lens,
    "hazard": hazard,
    "amber": flat((124, 95, 42), 0.55, 0.1, 2, wear=0.4),
    "red": flat((106, 38, 34), 0.55, 0.1, 3, wear=0.4),
    "white": flat((150, 152, 150), 0.55, 0.1, 4, wear=0.3),
    "brass": flat((138, 108, 58), 0.35, 0.9, 5, wear=0.2),
    "chrome": chrome,
    "rubber": flat((28, 28, 29), 0.9, 0.0, 6, wear=0, scratches=0),
    "seam": flat((12, 12, 13), 0.9, 0.0, 7, wear=0, scratches=0, grime=0),
    "inside": flat((19, 20, 21), 0.85, 0.05, 8, wear=0, scratches=0),
    "dark": flat((24, 25, 27), 0.6, 0.1, 9, wear=0.3),
    "cable": hose,
    "hose": hose,
    "glass": glass,
    "bolt": bolt,
    "gauge": gauge,
    "screen": screen,
    "arrow": arrow,
    "plate": data_plate,
    "tyre_wall": tyre_wall,
    "blade": blade,
    "duct": duct,
    "numbers": numbers,
    "text_unit": lettered("AFU-07   AIR FREIGHT", (112, 115, 117), seed=1),
    "text_lift": lettered("LIFT POINT", (122, 95, 44), seed=2, arrows=True, size_share=0.5),
    "text_step": lettered("NO STEP", (112, 115, 117), seed=3, frame=True),
    "text_rotor": lettered("DANGER  ROTOR", (124, 94, 42), seed=4, frame=True),
    "text_rack": lettered("DRONE RACK  6", (112, 115, 117), seed=5),
    "text_drone": lettered("SV-4  SURVEY", (112, 115, 117), seed=6, background=(72, 75, 78)),
    "text_hazard": lettered("STAND CLEAR", (124, 94, 42), seed=7, frame=True),
    "text_carrier": lettered("HL-9   HEAVY LIFT", (112, 115, 117), seed=8, background=(60, 64, 68)),
}
for n in range(1, 7):
    RECIPES[f"bay_{n}"] = bay_number(n)

LAMP_COLOURS = {
    "lamp_amber": (255, 150, 38),
    "lamp_red": (240, 30, 22),
    "lamp_green": (40, 235, 110),
    "lamp_white": (236, 242, 255),
    "lamp_cyan": (70, 210, 240),
    "lamp_dim_red": (150, 20, 16),
    "lamp_dim_amber": (170, 96, 22),
    "lamp_blue": (90, 140, 255),
    "lamp_warm": (255, 214, 160),
}


def normals(height, strength):
    gy, gx = np.gradient(height)
    n = np.stack([-gx * strength, gy * strength, np.ones_like(height)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return ((n * 0.5 + 0.5) * 255).round().astype(np.uint8)


def hull():
    side = HULL_SIDE
    unit = side // GRID
    base = np.zeros((side, side, 3), np.uint8)
    normal = np.zeros((side, side, 3), np.uint8)
    normal[...] = (128, 128, 255)
    packed = np.zeros((side, side, 3), np.uint8)
    packed[...] = (255, 150, 0)
    for tag, (x, y, w, h) in HULL.items():
        s = RECIPES[tag](w * unit, h * unit)
        x0, y0 = x * unit, y * unit
        sl = (slice(y0, y0 + h * unit), slice(x0, x0 + w * unit))
        base[sl] = np.clip(s.rgb, 0, 255).round().astype(np.uint8)
        normal[sl] = normals(s.height, 2.5)
        packed[sl] = np.stack([np.clip(s.ao, 0, 1) * 255, np.clip(s.rough, 0.02, 1) * 255, np.clip(s.metal, 0, 1) * 255], -1).round().astype(np.uint8)
    Image.fromarray(base).save(OUT / "hull_base.png", optimize=True)
    Image.fromarray(normal).save(OUT / "hull_normal.png", optimize=True)
    Image.fromarray(packed).save(OUT / "hull_packed.png", optimize=True)


def lamp():
    side = LAMP_SIDE
    unit = side // GRID
    base = np.zeros((side, side, 3), np.float32)
    for tag, (x, y, w, h) in LAMP.items():
        x0, y0, ww, hh = x * unit, y * unit, w * unit, h * unit
        if tag == "lamp_bar":
            # Six segments: lit green bays and one amber, with dark dividers.
            u = (np.arange(ww) + 0.5) / ww
            seg = np.floor(u * 6).astype(int)
            col = np.where((seg == 4)[:, None], np.array(LAMP_COLOURS["lamp_amber"]), np.array(LAMP_COLOURS["lamp_green"])).astype(np.float32)
            gap = (np.abs((u * 6) % 1 - 0.5) > 0.42)[:, None]
            col = np.where(gap, 8, col)
            base[y0:y0 + hh, x0:x0 + ww] = col[None, :, :]
        elif tag == "lamp_screen":
            yy, xx = np.mgrid[0:hh, 0:ww]
            img = np.zeros((hh, ww, 3), np.float32) + (6, 18, 22)
            img[(yy % 8 == 0)] += (10, 40, 44)
            img[(xx > ww * 0.1) & (xx < ww * 0.6) & (np.abs(yy - hh * 0.35) < 2)] = (70, 210, 240)
            img[(xx > ww * 0.1) & (xx < ww * 0.4) & (np.abs(yy - hh * 0.6) < 2)] = (255, 150, 38)
            base[y0:y0 + hh, x0:x0 + ww] = img
        else:
            base[y0:y0 + hh, x0:x0 + ww] = LAMP_COLOURS[tag]
    Image.fromarray(base.clip(0, 255).astype(np.uint8)).save(OUT / "lamp_base.png", optimize=True)
    packed = np.zeros((side, side, 3), np.uint8) + np.array((255, 40, 0), np.uint8)
    Image.fromarray(packed).save(OUT / "lamp_packed.png", optimize=True)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    hull()
    lamp()
    print("painted", OUT)

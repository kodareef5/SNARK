"""Repaint the compact's six staged wear layers. Run python3 -B tex/wear.py.

All distances below are metres on the closed car. Colour is undyed sRGB.
A mark keeps one colour for life, so the lips, core and surrounding debris
of a wound have separate footprints and onset times.
"""
import json
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from scipy.spatial import cKDTree

from paint import HERE, Surface, T, reveal, smoothstep


def sat(a):
    return np.clip(a, 0, 1)


def blend(a, b, t):
    a, b = np.asarray(a, np.float32), np.asarray(b, np.float32)
    return a + (b - a) * sat(t)[..., None]


@lru_cache(maxsize=8)
def lattice(seed):
    return np.random.default_rng(seed).random((53, 53, 53), dtype=np.float32)


def field(p, scale, seed):
    """A repeatable, world-space pigment or erosion field, anisotropic if needed."""
    coords = p / np.asarray(scale, dtype=np.float32)
    return ndimage.map_coordinates(lattice(seed), coords.T, order=1, mode="grid-wrap",
                                   prefilter=False)


class Layers:
    def __init__(self, s, region):
        self.p = s.P[region]
        self.normal = s.N[region]
        self.tag = s.TAG[region]
        self.ao = s.AO[region]
        self.mpt = s.mpt.ravel()[region]
        self.convex = s.convex[region]
        self.hurt, self.decay = s.hurt[region], s.decay[region]
        if s.name == "cabin":
            self.printed = s.printed[region]
        self.x, self.y, self.z = self.p.T
        self.ax = np.abs(self.x)
        self.cloud = field(self.p, 0.24, 101)
        self.flake = field(self.p, 0.059, 102)
        self.grit = field(self.p, 0.015, 103)
        self.tooth = field(self.p, 0.007, 104)
        self.edge = 0.55 * self.flake + 0.30 * self.grit + 0.15 * self.tooth

    def is_tag(self, *tags):
        return np.isin(self.tag, [T[k] for k in tags])

    def mark(self, layer, where, t, colour):
        stamp(layer, where, t, colour)


def stamp(layer, where, t, colour):
    # A union of marks preserves the earliest mark at intersections.
    alpha = reveal(t)
    keep = where & (alpha > layer[:, 3])
    layer[keep, 3] = np.broadcast_to(alpha, (len(layer),))[keep]
    layer[keep, :3] = colour[keep] if np.ndim(colour) == 2 else colour


def fold(b, u, v, allowed, ends, width, kink, start, seed):
    """Draw only the cut, shadow and chipped edges of a buckled panel."""
    u0, v0, u1, v1 = ends
    du, dv = u1 - u0, v1 - v0
    length = np.hypot(du, dv)
    along = ((u - u0) * du + (v - v0) * dv) / length**2
    cross = ((v - v0) * du - (u - u0) * dv) / length
    rng = np.random.default_rng(971 + seed)
    elbow = rng.uniform(.29, .72)
    warp = np.interp(along, [0, elbow - .16, elbow, elbow + .16, 1],
                     [0, .26 * kink, kink, .79 * kink, .19 * kink])
    cross = cross - warp * rng.uniform(.38, .72) - .009 * (b.flake - .5)
    mid = np.abs(along * 2 - 1)
    area = allowed & (mid < 1)
    taper = 1 - np.minimum(mid, 1)**2
    # One 1024 paint texel is about 4.7 mm. The scored ridge and one shaded
    # bank carry the dent. The intact slopes between adjacent ridges are dye.
    half = np.clip(b.mpt * 2.05, .0040, .0068) * (.55 + .55 * taper)
    dark = np.abs(cross) < half
    lip = (cross >= half) & (cross < half + .0054 * taper)
    t = start + 1.52 * mid + .46 * (1 - b.edge)
    shadow = blend((33, 37, 43), (75, 78, 77), .51 * b.flake + .49 * b.grit)
    b.mark(b.hurt, area & dark, t, shadow)
    catch = blend((120, 128, 135), (179, 186, 180), .48 * b.flake + .52 * b.grit)
    b.mark(b.hurt, area & lip & (b.flake + .42 * b.grit > .45), t + .13, catch)

    # Chips cluster at the pinch and along intermittent contact with the
    # crease. Their widths are independent of the length of the dent.
    chip = cross - .017 * taper
    crown = np.abs(chip) / (.006 + .037 * taper * width / .11)
    bite = .42 * b.flake + .36 * b.grit + .22 * b.tooth
    nick = area & (crown < 1.12) & (bite > .46 + .23 * crown + .14 * mid)
    primer = blend((99, 102, 102), (159, 156, 143), .60 * b.grit + .40 * b.flake)
    b.mark(b.hurt, nick, t + .27 + .53 * crown + .48 * (1 - bite), primer)
    # Tiny gouges catch the light inside the larger flakes of grey primer.
    gouge = area & (np.abs(cross - .015 * taper) < .0055 * taper) & (bite > .56)
    b.mark(b.hurt, gouge, t + .20, blend((150, 159, 165), (200, 202, 192), b.grit))
    # Short second-order folds join the main ridge at an acute angle.
    branch = cross + width * .65 * (along - elbow)
    lengthwise = np.abs(along - (elbow - .17))
    b.mark(b.hurt, area & (lengthwise < .18) & (np.abs(branch) < half * .93),
           1.54 + lengthwise * 5.0 + .34 * (1 - b.flake), shadow)
    b.mark(b.hurt, area & (lengthwise < .16) & (branch >= half) & (branch < half + .0043),
           1.83 + lengthwise * 4.0 + .33 * (1 - bite), catch)


# Endpoint pairs are deliberately asymmetric. The hood/boot coordinates
# continue over the return of the bumper, following the bend in the sheet.
NOSE = [
    ((.03, 1.19, .78, 1.99), .116, -.115, .18),
    ((.27, 1.37, .83, 1.80), .073, .065, .64),
    ((-.48, 1.75, .79, 2.06), .095, -.071, .28),
    ((-.77, 1.95, -.19, 1.35), .100, -.089, .32),
    ((-.76, 1.85, -.47, 1.44), .048, .032, .53),
    ((-.78, 2.19, -.01, 2.08), .106, .060, .26),
    ((-.16, 2.26, .74, 2.16), .105, -.072, .21),
    ((.39, 2.35, .87, 2.07), .120, .055, .32),
]
TAIL = [
    ((-.80, 2.04, -.08, 1.48), .138, .089, .12),
    ((-.73, 1.89, -.32, 1.56), .052, -.037, .69),
    ((-.81, 2.19, .09, 2.05), .127, .067, .24),
    ((-.13, 2.12, .77, 1.74), .090, -.063, .40),
    ((.31, 1.54, .79, 1.98), .081, .046, .33),
    ((.06, 2.40, .81, 2.16), .090, -.097, .31),
    ((-.83, 2.30, -.22, 2.41), .124, .055, .20),
]
ROOF = [
    ((-.64, -.81, -.36, .34), .111, .069, .16),
    ((-.54, -.74, -.21, .23), .050, .042, .46),
    ((-.56, -.47, .51, -.06), .085, -.105, .33),
    ((.25, -.94, .62, .22), .110, -.081, .24),
    ((.46, -.68, .68, -.01), .049, -.045, .60),
]
LEFT = [
    ((.73, .61, 1.90, .48), .120, .090, .20),
    ((1.33, .69, 1.95, .39), .098, -.055, .47),
    ((-.61, .41, .71, .55), .094, -.066, .32),
    ((-.42, .62, .48, .52), .047, .048, .55),
    ((-1.92, .52, -1.18, .78), .107, -.067, .27),
    ((-1.88, .77, -1.36, .82), .055, .043, .50),
]
RIGHT = [
    ((-1.94, .66, -.62, .53), .115, .067, .12),
    ((-1.83, .49, -1.23, .71), .097, -.048, .34),
    ((-1.35, .74, .35, .62), .073, -.035, .31),
    ((-.80, .53, .99, .45), .112, -.034, .12),
    ((-.44, .44, .65, .38), .047, .026, .53),
    ((.54, .50, 1.92, .65), .109, .057, .19),
    ((.85, .64, 1.77, .71), .055, .018, .45),
]


def paint_body(b):
    x, y, z, ax = b.x, b.y, b.z, b.ax
    # The top and face meet at the same developed coordinate.
    plane = np.where(z > 0, .72, .94)
    deck = np.abs(z) + np.maximum(plane - y, 0)
    for i, (group, u, v, face) in enumerate([
        (NOSE, x, deck, (z > .80) & ((ax < .81) | (y > .59))),
        (TAIL, x, deck, (z < -1.38) & ((ax < .81) | (y > .68))),
        (LEFT, z, y, x > .65), (RIGHT, z, y, x < -.65),
        (ROOF, x, z, y > 1.34),
    ]):
        for j, (ends, width, kink, start) in enumerate(group):
            fold(b, u, v, face, ends, width, kink, start, 19 * i + j)

    # Road drag on the rails, A/C pillars and mirror caps. The sill of each
    # open side window catches a second hit along the upper edge of the door.
    side = ax > .54
    for i, (ends, width, kink, start) in enumerate([
        ((-.89, .91, .65, .89), .045, -.027, .43),
        ((-.99, .99, -.49, 1.46), .077, .043, .26),
        ((.18, 1.46, .69, .96), .066, -.034, .24),
        ((.48, .92, .60, 1.02), .062, -.01, .09),
        ((-.58, .34, .20, .30), .035, .014, .67),
    ]):
        fold(b, z, y + np.where(x < 0, .01, -.014), side, ends,
             width, kink, start, 90 + i)

    # Additional short folds near the corners close like an accordion. Deep
    # creases arrive late, leaving wedges of original paint between the cuts.
    for i, (nose, ends, width, kink, start) in enumerate([
        (True, (.44, 1.68, .76, 1.88), .075, -.075, 1.25),
        (True, (.41, 1.84, .78, 1.99), .082, .072, 1.52),
        (True, (-.74, 1.83, -.36, 1.69), .065, -.042, 1.24),
        (True, (-.24, 2.07, .29, 2.12), .09, .061, .24),
        (True, (.22, 2.20, .71, 2.24), .085, -.046, 1.31),
        (False, (-.76, 1.88, -.36, 1.77), .080, -.076, 1.23),
        (False, (-.74, 1.99, -.28, 1.90), .091, .048, 1.34),
        (False, (-.52, 2.27, .13, 2.22), .10, .076, .32),
        (False, (-.46, 2.33, -.08, 2.30), .066, -.062, 1.29),
        (False, (.41, 2.17, .77, 2.08), .062, .046, 1.48),
    ]):
        fold(b, x, deck, (z > 1.3) if nose else (z < -1.4), ends, width, kink, start, 130 + i)

    # Satellite chips appear near the point of contact as the corner folds
    # farther. A noise peak exposes primer on a few square centimetres;
    # its irregular perimeter leaves the surrounding paint intact.
    contact = np.full_like(x, 4)
    for cx, cy, cz, rx, ry, rz in [
        (.64, .69, 1.88, .26, .17, .26), (-.64, .66, 1.88, .23, .16, .23),
        (-.56, .82, -1.93, .32, .24, .21), (.64, .80, -1.92, .24, .22, .20),
        (.87, .58, 1.45, .13, .17, .30), (-.85, .56, -1.35, .11, .19, .34),
        (-.84, .49, .02, .14, .13, .56), (.83, .48, -.28, .13, .11, .34),
    ]:
        dist = ((x - cx) / rx)**2 + ((y - cy) / ry)**2 + ((z - cz) / rz)**2
        contact = np.minimum(contact, dist)
    fleck = .74 * field(b.p, (.041, .023, .064), 175) + .26 * b.grit
    chip = (contact < 1.6) & (fleck > .60 + .107 * contact)
    grey = blend((68, 72, 74), (145, 145, 133), smoothstep(.60, .80, fleck))
    b.mark(b.hurt, chip, 1.64 + .70 * contact + .65 * (1 - fleck), grey)

    # The road takes the finish off the upper rail in parallel scores.
    # Their outer tips skip, and only the deepest one exposes steel.
    for i, (rail, tilt, reach) in enumerate([(-.59, .10, .55), (-.552, .105, .34),
                                              (.586, -.063, .49), (.620, -.060, .30)]):
        a = z + (.30 if rail < 0 else .20)
        q = x - rail - tilt * a - .012 * np.sin(4.4 * z) - .003 * (b.flake - .5)
        footprint = (y > 1.36) & (np.abs(a) < reach) & (np.abs(q) < .009) & (b.edge > .34)
        tint = blend((108, 114, 119), (180, 186, 178), b.edge + .22 * (np.abs(q) < .003))
        b.mark(b.hurt, footprint, .32 + .14 * i + 1.62 * np.abs(a) / reach + .37 * (1 - b.grit), tint)

    # Roadside contact skips at the wheel openings and picks up again on
    # the door. Unequal centre lines keep each pass at its own height.
    thread = field(b.p, (.084, .013, .32), 176)
    for h, slope, shift, lift, amount in [
        (.476, .029, -.31, .032, .10), (.502, .032, .12, .027, .38),
        (.449, .030, -.66, .024, .77), (.318, -.010, .81, .016, .52),
        (.337, -.008, .59, .013, .88),
    ]:
        c = h + slope * z + lift * np.sin(z * 1.92 + shift)
        d = np.abs(y - c - .005 * (b.flake - .5))
        contact = .006 + .009 * b.cloud + .004 * np.cos(z * 3 + shift)
        band = d / contact
        side = (x < -.67) | ((x > .67) & (np.abs(z - .42) < .68))
        g = .57 * thread + .27 * b.cloud + .16 * b.grit
        colour = blend((107, 112, 114), (168, 164, 148), g)
        colour = blend(colour, (189, 194, 184), (band < .24) * smoothstep(.51, .73, g))
        b.mark(b.hurt, side & (band < 1) & (g > .38 + .13 * band),
               amount + .47 * band + 1.48 * (1 - g) + .42 * (x > 0), colour)

    # Distance from real moisture traps, rather than a global rust field.
    arch = np.abs(np.hypot(np.abs(z) - 1.25, y - .30) - .357)
    side = ax > .69
    door = np.minimum(np.abs(z + .80), np.abs(z - .648))
    sill = np.where(np.abs(z) < 1.63, .268, np.where(z > 0, .254, .427))
    top = b.normal[:, 1] > .72
    deck_seam = np.minimum(np.abs(ax - np.where(z > 0, .70, .63)),
                           np.abs(z - np.where(z > 0, .80, -1.42)))
    dist = np.minimum.reduce([
        np.where(side & (y > .255), arch, 1.),
        np.where(side & (y < .94), door, 1.),
        np.where(side | (np.abs(z) > 1.82), np.abs(y - sill), 1.),
        np.where(top & ((z > .77) | (z < -1.41)), deck_seam, 1.),
        np.where((y > 1.38), np.abs(ax - .654), 1.),
        np.where((np.abs(z) > 1.92), np.abs(y - np.where(z > 0, .664, .841)), 1.),
    ])
    grain = .53 * b.flake + .28 * b.grit + .19 * b.tooth
    reach = .012 + .080 * smoothstep(.36, .83, b.cloud)**1.45
    rust = 1.04 + 1.91 * dist / reach + 2.47 * (.51 - grain)
    b.mark(b.decay, (dist < reach * 1.22) & (grain > .27 + .20 * dist / reach),
           rust, rust_colour(b))
    rimmed = b.is_tag("jamb") & (b.ao < .77)
    b.mark(b.decay, rimmed, 3.65 - 2.67 * grain + .56 * b.ao, rust_colour(b))

    # Intermittent runoff below the window and pillars. Only sediment
    # in the narrowest channels is opaque enough to replace the dye.
    run = field(b.p, (.05, .80, .031), 122)
    oily = .65 * run + .35 * field(b.p, (.023, .54, .015), 123)
    sill_run = (.944 - y) / (.13 + .55 * b.cloud)
    b.mark(b.decay, side & (sill_run > 0) & (sill_run < 1) & (np.abs(z) < 1.15) & (oily > .70),
           2.64 + .71 * sill_run - 3.61 * (oily - .64),
           blend((83, 76, 63), (126, 117, 96), .65 * b.grit + .35 * b.flake))
    # A few broken islands of dead clearcoat on horizontal panels. Their
    # footprint leaves the underlying dye to take the game's overall fading.
    island = .61 * b.cloud + .27 * b.flake + .12 * b.grit
    sky = top & ((z > .81) | (z < -1.42) | (y > 1.44))
    chalk = blend((117, 122, 119), (161, 160, 144), .40 * b.flake + .60 * b.grit)
    b.mark(b.decay, sky & (island > .683), 3.02 - 5.24 * (island - .64), chalk)


def rust_colour(b):
    grain = .46 * b.flake + .32 * b.grit + .22 * b.tooth
    oxide = blend((79, 48, 36), (159, 76, 37), smoothstep(.20, .60, grain))
    return blend(oxide, (202, 127, 63), smoothstep(.53, .80, grain))


def grow_rust(s):
    # A sparse 1 cm world-space grid lets corrosion cross a UV seam and wrap
    # around a battered panel edge without jumping to adjacent atlas islands.
    offset = np.array((1., .05, 2.08), np.float32)
    step = .01
    occupied = np.ones((205, 165, 417), bool)
    pts = np.rint((s.P + offset) / step).astype(np.int32)
    wounded = (s.hurt[:, 3] > 0) & s.covered.ravel()
    occupied[tuple(pts[wounded].T)] = False
    dist = ndimage.distance_transform_edt(occupied).astype(np.float32) * step
    for region in slices(s.n):
        b = Layers(s, region)
        d = dist[tuple(pts[region].T)]
        grain = .49 * b.cloud + .34 * b.flake + .17 * b.grit
        reach = .009 + .045 * smoothstep(.37, .82, b.cloud)
        t = 1.35 + 1.82 * d / reach + 3.06 * (.53 - grain)
        b.mark(b.decay, (d < reach) & (b.grit + .72 * b.flake > .75), t, rust_colour(b))


def segment(u, v, a, b):
    dx, dy = b - a
    t = sat(((u - a[0]) * dx + (v - a[1]) * dy) / (dx * dx + dy * dy))
    return np.hypot(u - (a[0] + t * dx), v - (a[1] + t * dy))


def star(u, v, spokes, radii, seed, rings, forks=False):
    """A radial fracture graph. Arcs join the same vertices as the spokes.
    Adjacent bent segments form facets; a few run uninterrupted to the seal.
    """
    rng = np.random.default_rng(seed)
    angle = (np.arange(spokes) + rng.uniform(-.28, .28, spokes)) * (2 * np.pi / spokes)
    rad = np.asarray(radii)[:, None] * rng.uniform(.80, 1.18, (len(radii), spokes))
    ang = angle + rng.uniform(-.105, .105, rad.shape)
    vertices = np.stack([np.cos(ang) * rad, np.sin(ang) * rad], axis=-1)
    d = np.full(len(u), 5., np.float32)
    delay = np.zeros_like(d)
    for k, row in enumerate(vertices):
        for i, tip in enumerate(row):
            if k < len(radii) - 1 or i % 4 != 1:
                root = vertices[k-1, i] if k else np.zeros(2)
                ds = segment(u, v, root, tip)
                soon = .10 + (i % 3) * .13
                delay = np.where(ds < d, soon, delay)
                d = np.minimum(d, ds)
            if forks and k in (2, 3, 4) and (i + k) % 3 == 0:
                # Short fissures fork off an existing spoke. Only a handful
                # reach the seal; the rest taper out within the laminate.
                turn = ang[k, i] + rng.choice((-1, 1)) * rng.uniform(.24, .58)
                reach = rng.uniform(.071, .22)
                branch = tip + reach * np.array([np.cos(turn), np.sin(turn)])
                ds = segment(u, v, tip, branch)
                delay = np.where(ds < d, .34 + .10 * k, delay)
                d = np.minimum(d, ds)
            if k in rings and rng.random() < (.86 if k < 2 else .59):
                ds = segment(u, v, tip, row[(i+1) % spokes])
                delay = np.where(ds < d, .48 + k * .09, delay)
                d = np.minimum(d, ds)
    return d, delay


@lru_cache(maxsize=8)
def shard_seeds(pitch, seed):
    rng = np.random.default_rng(seed)
    nx, ny = int(np.ceil(1.22 / pitch)) + 2, int(np.ceil(.95 / pitch)) + 2
    rows, cols = np.mgrid[-ny:ny+1, -nx:nx+1]
    grid = np.stack([cols.ravel(), rows.ravel()], axis=1)
    centres = pitch * (grid + rng.uniform(-.41, .41, grid.shape))
    return cKDTree(centres), rng.random(len(grid))


def shards(u, v, pitch, seed):
    """Distance to the shared bisector and a fixed tone per fragment."""
    tree, tone = shard_seeds(pitch, seed)
    d, i = tree.query(np.column_stack([u, v]), k=2)
    centre = tree.data[i[:, 0]]
    delta = tree.data[i[:, 1]] - centre
    spacing = np.linalg.norm(delta, axis=1)
    glint = sat(.5 + (.25 * delta[:, 0] + .42 * delta[:, 1]) / spacing)
    return (d[:, 1]**2 - d[:, 0]**2) / (2 * spacing), tone[i[:, 0]], centre, glint


def printed_glass(s):
    """Intersect baked glass, the surviving L0 UV faces and the printed frit.

    open-glass.py cuts by the original polygon's centre. The bakes store its
    triangulation, which can have different centres. Read the retained UVs
    from the actual pack to preserve that distinction, including at corners.
    """
    data = (Path(HERE).parent / "compact.snpk").read_bytes()
    header_end = 12 + int.from_bytes(data[8:12], "little")
    header = json.loads(data[12:header_end])
    mesh = next(m for m in header["meshes"] if m["id"] == "core:compact")
    material = next(i for i, m in enumerate(header["materials"]) if m["id"] == "core:compact/cabin")
    lod = mesh["lods"][0]
    blob = memoryview(data)[header_end:]
    # shared/pack/pack.ts and tools/pack/surface.ts. Each surface vertex
    # starts with two unsigned 16-bit UVs and occupies twelve bytes.
    uv = np.ndarray((lod["vertexCount"], 2), "<u2", buffer=blob,
                    offset=lod["surfaceOffset"], strides=(12, 2)).astype(np.float64)
    rect = mesh.get("uv", (0, 0, 1, 1))
    uv = (rect[:2] + uv / 65535 * rect[2:]) * s.size
    indices = np.frombuffer(blob, dtype=f"<u{lod['indexBytes']}", count=lod["indexCount"],
                            offset=lod["indexOffset"])
    live = Image.new("L", (s.size, s.size))
    draw = ImageDraw.Draw(live)
    for mat, start, count in np.asarray(lod["sections"]).reshape(-1, 3):
        if mat == material:
            for triangle in indices[start:start + count].reshape(-1, 3):
                draw.polygon([tuple(vertex) for vertex in uv[triangle]], fill=255)
    alpha = np.asarray(Image.open(Path(HERE) / "cabin_base.png").getchannel("A"))
    glass = s.where("glass").reshape(s.size, s.size)
    printed = s.covered & glass & (np.asarray(live) > 0) & (alpha >= 128)
    # Carry pigment a little beyond each printed pixel for the 512 mip.
    return ndimage.maximum_filter(printed, size=7).ravel()


def paint_glass(b, front):
    mask = b.printed & b.is_tag("glass") & ((b.z > 0) if front else (b.z < 0))
    if not mask.any():
        return
    p = b.p[mask]
    x, y, z = p.T
    ax = np.abs(x)
    f, grit = b.flake[mask], b.grit[mask]
    hurt, decay = b.hurt[mask], b.decay[mask]
    # Distances up the sloping pane from the roof and the cowl/deck.
    from_top = (z - .247) * 1.46 if front else (-.705 - z) * 1.20
    from_base = (.728 - z) * 1.46 if front else (z + 1.365) * 1.20
    lower = from_base < from_top
    width = np.interp(z, [.247, .43, .61, .728], [.551, .553, .575, .603]) if front else .509
    across = np.maximum(0, width - ax)
    side = across < np.minimum(from_top, from_base)
    depth = np.maximum(0, np.minimum.reduce([from_top, from_base, across]))
    along = np.where(side, np.sign(x) * from_base + .67, x)
    jitter = (f - .5) * .005
    # Short, diverging fissures on the opaque portions near the frame.
    # The front roof print and the rear deck corners are most visible. The
    # smaller front cowl hit gives a head-on impact an earlier point to show.
    impacts = ([(.4372, .2535, .07), (.5995, .7100, .05), (-.5979, .7197, .20)] if front else
               [(-.4927, -1.3550, .06), (.1528, -1.3568, .57), (.4900, -.7159, .50)])
    impact_distance = np.full_like(x, 3.)
    for i, (cx, cz, start) in enumerate(impacts):
        u, v = x - cx, (z - cz) * (1.46 if front else 1.20)
        r = np.hypot(u, v)
        impact_distance = np.minimum(impact_distance, r)
        d, delay = star(u + jitter * .55, v, 12 if front else 8,
                        [.022, .052, .103, .184], 524 + i + 9 * front,
                        (0, 1) if front else (), forks=front)
        w = np.clip(.88 * b.mpt[mask], .0036, .0057)
        grey = blend((140, 166, 173), (228, 235, 222), .30 + .53 * grit)
        stamp(hurt, d < w, start + 6.65 * r + .28 * delay + .15 * d / w, grey)
        stamp(hurt, r < .017, start + .25 * r / .017, (216, 227, 215))

    # Serrations across the inner lip of the strip. A few teeth are
    # missing all the way back to the frame. Elsewhere their fractured faces
    # catch alternate amounts of light on either side of each diagonal cut.
    rng = np.random.default_rng(311 if front else 319)
    joins = np.r_[-1.5, -1.5 + np.cumsum(rng.uniform(.035, .104, 110))]
    tooth = np.searchsorted(joins, along + .48 * depth + jitter) - 1
    fraction = (along + .48 * depth + jitter - joins[tooth]) / (joins[tooth + 1] - joins[tooth])
    tips = rng.uniform(.24, .78, len(joins))[tooth]
    slope = np.where(fraction < tips, fraction / tips, (1 - fraction) / (1 - tips))
    jag = .004 + (.016 + .044 * rng.random(len(joins))[tooth]) * slope
    missing = rng.random(len(joins))[tooth] < .18
    gap = (missing | (depth > jag)) & (impact_distance > .038)
    # Leave narrow pockets in the two lower corners for sediment and leaves.
    corner = (from_base < .065) & (across < .113)
    pocket = corner & (np.abs(np.sin(92 * x + 43 * from_base)) < .73) & (impact_distance > .022)

    # The head end of the passenger-side rail shares the rear-impact grid
    # cell. Keep its first fractures toward the cowl, where the frontal
    # stories can reveal them while the car is alive.
    active = ~pocket
    if front:
        active &= (x >= -.459) | lower
    phase = np.clip(.95 + .39 * np.minimum(impact_distance / .43, 1) + .16 * f, 0, 1.60)
    if front:
        phase += .43 * (~lower) * smoothstep(-.21, -.37, x)
    fault, tone, _, facing = shards(along, depth + jitter, .036 if front else .022, 701 + int(front))
    craze = (fault < .0036 + .0015 * facing) | (np.abs(fraction - tips) < .11)
    chilled = blend((170, 188, 193), (242, 246, 236), .13 + .50 * facing + .30 * tone)
    stamp(hurt, active & ~gap & craze, phase + .15 * (1 - facing), chilled)
    # A dimmer reflected face between bright fracture edges makes the
    # whitening readable even where the outer frit is one game texel deep.
    stamp(hurt, active & ~gap & (tone > .54), phase + .19 + .17 * (1 - tone),
          blend((112, 142, 151), (191, 209, 203), tone))
    stamp(hurt, active & ~gap & (depth < jag), 2.08 + .46 * (1 - slope),
          blend((129, 155, 163), (238, 246, 235), .55 * slope + .45 * tone))
    stamp(hurt, active & gap, 1.98 + .53 * tone,
          blend((14, 22, 28), (40, 48, 48), .64 * f + .36 * grit))
    edge = (~missing) & (np.abs(depth - jag) < .005) & (impact_distance > .04)
    stamp(hurt, active & edge, 1.87 + .21 * tone, (201, 219, 214))

    if front:
        # At the upper passenger corner the spatial rear-hit delay goes
        # from three stages at the centre to zero at x = -.504. Taper the
        # upper-rail cracks out before this shared cell shows a windscreen
        # hit on a car struck behind the passenger.
        # Include a short guard for the shoulder of the filtered 512 mip.
        onset_floor = 3 * sat((-.12 - x) / .24)
        roof_print = ~lower & (x < -.12)
        hurt[roof_print, 3] = np.minimum(hurt[roof_print, 3], reveal(onset_floor[roof_print]))
    else:
        # The driver's roof corner of the backlight is close to the middle
        # grid plane. Delay that secondary hit past a living driver's-nose
        # story, keeping the passenger-side deck strike early.
        far_corner = (~lower) & (x > .28)
        hurt[far_corner, 3] = np.minimum(hurt[far_corner, 3], reveal(2.04))

    # Film adheres to the printed lip. Grit and small curled leaves lodge
    # against the lower corner seals rather than floating in the opening.
    run = field(p, (.033, .41, .29), 508)
    base_dirt = np.exp(-np.maximum(from_base, 0) / .055)
    gather = base_dirt * np.exp(-across / .15)
    sediment = blend((83, 78, 62), (149, 139, 107), .54 * f + .46 * grit)
    stamp(decay, lower, 3.18 - 1.49 * gather - .78 * run - .39 * grit, sediment)
    stamp(decay, run > .55, 3.51 - .87 * run - .54 * base_dirt,
          blend((81, 93, 96), (145, 150, 133), f))
    for i in range(18):
        side_sign = 1 if i % 2 else -1
        cx = side_sign * ((.598 if front else .503) - rng.uniform(.002, .074))
        cy = rng.uniform(.001, .035)
        angle = rng.uniform(-1.15, 1.15)
        dx, dy = x - cx, from_base - cy
        a = (dx * np.cos(angle) + dy * np.sin(angle)) / rng.uniform(.016, .032)
        c = (-dx * np.sin(angle) + dy * np.cos(angle)) / rng.uniform(.006, .014)
        leaf = np.abs(c + .12 * (a * a - 1)) + np.abs(a)**1.35
        ochre = blend((102, 75, 42), (184, 147, 79), .33 * (i % 3) / 2 + .30 * grit + .31 * (c > 0))
        stamp(decay, leaf < 1, .27 + (i % 4) * .35 + .28 * leaf, ochre)
    b.hurt[mask], b.decay[mask] = hurt, decay


def paint_cabin(b):
    paint_glass(b, True)
    paint_glass(b, False)
    leather = b.is_tag("leather")
    x, y, z, ax = b.x, b.y, b.z, b.ax
    dx = ax - .42
    # The back seam rides up the bolster, the cushion slash curves towards
    # the front corner. Offset their placement on the two different seats.
    for u, v, plane, half, girth, lean in [
        (y - np.where(x > 0, .85, .82), dx + np.where(x > 0, -.074, .048),
         z < -.07, .27, .080, .38),
        (z - np.where(x > 0, .12, .04), dx + np.where(x > 0, .06, -.083),
         y < .64, .235, .063, -.45),
        (y - 1.205, dx - .080, y > 1.10, .096, .052, -.65),
        (y - .944, z + .207, (ax > .567) & (z < -.05), .164, .052, .61),
    ]:
        along = u / half
        tear = (v + lean * u + .026 * np.sin(4.0 * along)
                + .020 * (b.flake - .5) + .009 * (b.grit - .5))
        span = np.maximum(.001, girth * (1 - np.minimum(1, np.abs(along))**1.1))
        signed = tear / span
        d = np.abs(signed)
        fray = .7 * b.grit + .3 * b.tooth
        foam = blend((165, 123, 68), (232, 202, 131), fray)
        lining = blend((45, 32, 28), (86, 62, 43), b.grit)
        colour = blend(foam, lining, smoothstep(.47, .70, d + .18 * fray))
        colour = blend(colour, (189, 157, 116), (signed > .84) * (.4 + .53 * b.grit))
        t = .26 + 1.60 * np.abs(along) + 1.08 * d + .48 * (1 - fray)
        b.mark(b.hurt, leather & plane & (d < .97 + .27 * b.tooth) & (np.abs(along) < 1), t, colour)

    # Long pale checks in sun-baked leather, islands of grey-green mould at
    # water traps, and loose dust on the console, door caps and upholstery.
    solid = ~b.is_tag("glass", "glass_in")
    up = sat(b.normal[:, 1])
    damp = .56 * b.cloud + .29 * b.flake + .15 * b.grit
    fabric = b.is_tag("carpet", "headliner", "panel", "leather")
    mold = blend((90, 94, 73), (167, 166, 135), .48 * damp + .52 * b.grit)
    b.mark(b.decay, fabric, 4.64 - 4.07 * damp - .92 * (1 - b.ao), mold)
    stress = np.abs(np.sin(dx * 54 + z * 19 + y * 11 + b.flake * 4))
    b.mark(b.decay, leather & (stress < .29), 3.37 - 2.60 * damp + stress,
           blend((116, 87, 68), (197, 173, 130), b.grit))
    settled = blend((119, 110, 95), (188, 180, 155), .53 * b.cloud + .47 * b.grit)
    b.mark(b.decay, solid, 4.51 - 2.92 * damp - .95 * up - .37 * (1 - b.ao), settled)
    hard = b.is_tag("dash", "panel", "gauge", "grip", "metal")
    split = np.abs(np.sin(z * 9 + ax * 11 + y * 14 + 2.8 * b.cloud + b.flake))
    b.mark(b.hurt, hard & (split < .26) & (b.cloud > .45),
           1.18 + 1.84 * (1 - b.cloud) + .9 * split,
           blend((51, 48, 43), (167, 155, 129), smoothstep(.07, .20, split)))


def slices(n):
    for start in range(0, n, 131072):
        yield slice(start, min(start + 131072, n))


def save(s):
    """Reduce four bake samples to one source texel, preserving the earliest onset."""
    size = s.size // 2
    # Nearest-surface data is useful in the first texel outside the chart.
    # Clear the unused atlas beyond a two-output-texel gutter. Extending it
    # farther projects a single boundary sample across triangular fans.
    gutter = ndimage.maximum_filter(s.covered, size=9).ravel()
    for name, layer in (("hurt", s.hurt), ("decay", s.decay)):
        layer[~gutter] = 0
        blocks = layer.reshape(size, 2, size, 2, 4)
        alpha = blocks[..., 3]
        weight = alpha[..., None]
        total = weight.sum((1, 3))
        colour = (blocks[..., :3] * weight).sum((1, 3)) / np.maximum(total, 1e-9)
        onset = np.rint(255 * alpha.max((1, 3))).astype(np.uint8)
        if name == "hurt":
            wounded = onset > 0
        else:
            onset[wounded] = 0
        pixels = np.empty((size, size, 4), np.uint8)
        pixels[..., :3] = np.rint(np.clip(colour, 0, 255)).astype(np.uint8)
        pixels[onset == 0] = 0
        pixels[..., 3] = onset
        Image.fromarray(pixels).save(Path(HERE) / f"{s.name}_{name}.png", optimize=True)


def generate(name, painter):
    print(f"Reading {name} bake", flush=True)
    s = Surface(name)
    if name == "cabin":
        s.printed = printed_glass(s)
    print(f"Painting {name}", flush=True)
    for region in slices(s.n):
        painter(Layers(s, region))
    if name == "body":
        grow_rust(s)
    save(s)
    print(f"Wrote {name} hurt and decay", flush=True)


def paint_lens(b, tag, side):
    m = b.is_tag(tag) & (b.x * side > 0)
    if not m.any():
        return
    x, y, z = b.p[m].T
    ax, f, grit = np.abs(x), b.flake[m], b.grit[m]
    # x runs along the lens. On the small door mirror it runs across its face.
    if tag == "headlamp":
        centre = (.632, .624) if side > 0 else (.548, .623)
        rx, ry, pitch = .152, .061, .039
        rim, glint = (94, 112, 125), (226, 238, 228)
    elif tag == "taillamp":
        centre = (.650, .762) if side > 0 else (.557, .787)
        rx, ry, pitch = .235, .080, .051
        rim, glint = (130, 57, 54), (237, 167, 143)
    elif tag == "amber":
        centre = (.688 if side > 0 else .655, .316)
        rx, ry, pitch = .063, .031, .025
        rim, glint = (134, 85, 46), (241, 198, 118)
    else:
        centre = (.862 if side > 0 else .839, .952)
        rx, ry, pitch = .060, .055, .028
        rim, glint = (91, 118, 124), (215, 232, 225)
    u, v = ax - centre[0], y - centre[1]
    r = np.hypot(u / rx, v / ry)
    seed = 210 + list(("headlamp", "taillamp", "amber", "mirror")).index(tag) * 2 + int(side > 0)
    edge, facet, _, glint_angle = shards(u, v + (f - .5) * .004, pitch, seed)
    width = np.maximum(.0047, 2.1 * b.mpt[m])
    d, wait = star(u, v, 6, [pitch, pitch * 2.65, pitch * 5.4], seed, (0,))
    hurt = b.hurt[m]
    # The ejected chunk lies beside the seed crack. Reserve its interior
    # when drawing the early fractures so no white lines float in the hole.
    aperture = np.hypot((u - rx * .43) / rx, (v + ry * .09 + u * .12) / ry)
    broken = aperture < .92 + .37 * (facet - .5)
    broken_core = broken & (aperture < .72 + .17 * facet)
    stamp(hurt, (d < width) & ~broken_core, .10 + .92 * r + .62 * wait + .15 * d / width,
          blend(rim, glint, .19 + .34 * glint_angle + .39 * grit))
    inner = blend((13, 17, 21), (44, 41, 40), .68 * facet + .32 * grit)
    tooth = (aperture > .69) & (edge < width * 1.1)
    inner = blend(inner, glint, tooth * (.33 + .46 * grit))
    stamp(hurt, broken, 1.11 + aperture * 1.22 + .29 * facet, inner)
    stamp(hurt, (edge < width) & ~broken, 1.05 + .91 * r + .27 * facet,
          blend(rim, glint, .12 + .48 * glint_angle + .36 * facet))
    b.hurt[m] = hurt


def paint_trim(b):
    for tag in ("headlamp", "taillamp", "amber", "mirror"):
        for side in (-1, 1):
            paint_lens(b, tag, side)
    x, y, z, ax = b.x, b.y, b.z, b.ax
    rim, rubber = b.is_tag("rim"), b.is_tag("tread", "sidewall")
    dz = z - np.where(z > 0, 1.25, -1.25)
    r = np.hypot(dz, y - .30)
    theta = np.arctan2(dz, y - .30)
    # A different clock position for each scuffed wheel. Gouges skip between
    # the rim lip and spoke tips, and cut into the outer shoulder of the tyre.
    centre = np.where(z > 0, np.where(x > 0, 1.10, 2.32), np.where(x > 0, -1.87, -.96))
    arc = np.arccos(np.clip(np.cos(theta - centre), -1, 1))
    rake = np.sin((r - .21) * 545 + arc * 2.1 + b.flake * 3.0)
    band = np.abs(r - (.199 + .013 * np.cos(theta * 3 + centre)))
    t = .05 + .90 * arc + 18.5 * band + .68 * (1 - b.edge) + .20 * (1 - rake)
    alloy = blend((98, 101, 105), (223, 219, 202), .5 + .30 * rake + .29 * (b.grit - .5))
    b.mark(b.hurt, rim & (ax > .847) & (r > .115) & (arc < 2.14) & (rake + b.grit > -.25), t, alloy)
    slash = (r - .253 - .022 * np.sin((theta - centre) * 4.0) - .009 * (b.flake - .5))
    cut = np.abs(slash) / .022
    colour = blend((52, 48, 47), (136, 125, 106), smoothstep(-.51, .64, slash / .017))
    colour = blend(colour, (192, 174, 138), (b.grit > .66) * (cut < .45) * .80)
    b.mark(b.hurt, rubber & (ax > .847) & (arc < 1.60), .22 + 1.08 * arc + .98 * cut, colour)

    # A curb bites into the flange and nicks exposed spoke ends. Shading
    # the cut face dark between two fresh alloy edges makes it legible
    # against the undamaged bright wheel even on the 400-pixel car.
    signed_angle = np.arctan2(np.sin(theta - centre), np.cos(theta - centre))
    ridge = .192 - .023 * np.cos(2.3 * signed_angle) + .009 * (b.flake - .5)
    kerf = (r - ridge) / .025
    flange = rim & (ax > .841) & (arc < 1.6) & (np.abs(kerf) < 1.0)
    gouge = blend((46, 51, 56), (87, 88, 85), .63 * b.flake + .37 * b.grit)
    gouge = blend(gouge, (208, 212, 204), smoothstep(.28, .66, kerf))
    b.mark(b.hurt, flange, .23 + .96 * arc + .58 * np.abs(kerf) + .22 * (1 - b.flake), gouge)
    notch = np.abs(signed_angle + .29 * np.sin(r * 19) - .35)
    b.mark(b.hurt, rim & (ax > .838) & (r > .077) & (notch < .19 + .09 * b.edge),
           .58 + 7.8 * (.215 - r) + 2.75 * notch,
           blend((42, 45, 49), (173, 173, 160), smoothstep(.08, .19, notch)))
    rubber_face = rubber & (ax > .852) & (r > .221)
    shoulder = np.abs(r - (.256 + .015 * np.sin(3.1 * signed_angle)))
    tread_rub = .6 * b.flake + .4 * b.grit
    rasp = blend((77, 78, 76), (154, 146, 121), .53 * tread_rub + .47 * (rake > .41))
    b.mark(b.hurt, rubber_face & (tread_rub > .39 + .95 * shoulder) & (arc < 1.25),
           .46 + .76 * arc + 20 * shoulder + .54 * (1 - tread_rub), rasp)

    # Folded grille mesh and number plates, torn plastic chin and return lips.
    end = np.where(z > 0, .37, .51)
    h = y - end - .06 * np.sin(x * 5.2 + np.where(z > 0, .2, 2.6))
    tooth = np.abs(np.sin(x * 33 + 12 * y + b.flake * 1.9))
    slit = np.abs(h + .025 * (b.grit - .5))
    stress = blend((62, 63, 62), (181, 177, 159), .45 * b.grit + .52 * smoothstep(-.015, .025, h))
    mesh = b.is_tag("mesh")
    ridge = np.abs(y - np.where(y > .5, .616, .312) - .024 * np.sin(x * 12.6 + b.flake * 2))
    bent = np.abs(x - np.where(y > .5, .074, -.214))
    colour = blend((27, 31, 34), (171, 169, 152), (tooth > .73) * (.51 + .38 * b.grit))
    b.mark(b.hurt, mesh, .12 + 3.46 * bent + 21 * ridge + .46 * (1 - b.flake), colour)
    b.mark(b.hurt, b.is_tag("plate"), .48 + 22 * slit + 1.37 * np.abs(x) + .41 * (1 - b.grit), stress)
    plastic = b.is_tag("plastic", "liner", "under", "rubber", "chrome", "exhaust")
    side = np.abs(z) < 1.64
    # Long scratches run along the mouldings, horizontally across bumper ends.
    h = np.where(side, y - .245 - .069 * np.sin(z * 2.4 + np.sign(x)),
                 y - np.where(z > 0, .237, .338) - .045 * np.sin(x * 7 + np.sign(z)))
    h = np.where((ax > .79) & (y > .88), y - .938, h)
    h = np.where(b.is_tag("chrome") & (y > .7), y - .745, h)
    comb = field(b.p, (.15, .014, .21), 171)
    scuff = blend((81, 81, 76), (194, 188, 165), .53 * comb + .47 * b.grit)
    b.mark(b.hurt, plastic & (comb + .42 * b.grit > .58),
           .18 + 14.0 * np.abs(h) + 1.25 * (1 - b.cloud) + .7 * (1 - comb), scuff)
    # A few surviving cubes are caught at the rolled-down windows' belt seals.
    seal = b.is_tag("rubber") & (ax > .69) & (np.abs(y - .943) < .042)
    grain = field(b.p, .027, 172)
    b.mark(b.hurt, seal & (grain > .56), .22 + 1.44 * np.abs(z - np.where(x > 0, .37, -.50)) + 1.55 * (1 - grain),
           blend((100, 141, 145), (209, 226, 212), b.grit))

    patina = .50 * b.cloud + .32 * b.flake + .18 * b.grit
    metal = b.is_tag("chrome", "disc", "exhaust", "plate", "mesh", "under")
    b.mark(b.decay, metal, 4.32 - 3.65 * patina - .56 * (1 - b.ao) - .43 * b.is_tag("exhaust", "disc"), rust_colour(b))
    # Wheels chalk, pit and oxidise. Compressed-looking cords at the contact
    # patch and dried mud on the lower rubber imply loss of air in this mesh.
    salt = blend((106, 112, 106), (194, 194, 175), .63 * b.grit + .37 * b.flake)
    salt = blend(salt, (140, 103, 64), smoothstep(.52, .77, b.flake) * .82)
    b.mark(b.decay, rim, 3.88 - 3.30 * patina - .51 * (1 - b.ao), salt)
    flat = smoothstep(.163, .035, y)
    check = np.abs(np.sin(theta * 23 + r * 139 + b.flake * 3.8))
    tyre = blend((72, 72, 70), (135, 125, 105), .48 * b.flake + .37 * flat + .15 * b.grit)
    tyre = blend(tyre, (48, 44, 42), smoothstep(.53, .12, check) * .81)
    b.mark(b.decay, rubber, 3.95 - 2.95 * patina - 1.25 * flat - .41 * (check < .35), tyre)
    lens = b.is_tag("headlamp", "amber", "taillamp", "mirror")
    stain = blend((143, 126, 67), (214, 196, 128), .48 * b.flake + .52 * b.grit)
    stain = blend(stain, (141, 108, 84), .70 * b.is_tag("taillamp"))
    stain = blend(stain, (155, 163, 155), .88 * b.is_tag("mirror"))
    b.mark(b.decay, lens, 3.98 - 3.17 * patina - .40 * (1 - b.ao), stain)
    faded = blend((87, 88, 84), (151, 147, 131), .45 * b.grit + .55 * patina)
    faded = blend(faded, (61, 60, 56), b.is_tag("rubber") * smoothstep(.30, .10, check) * .80)
    b.mark(b.decay, b.is_tag("plastic", "liner", "rubber"),
           3.99 - 3.12 * patina - .49 * (1 - b.ao) - .30 * sat(b.normal[:, 1]), faded)


if __name__ == "__main__":
    for material, painter in (("body", paint_body), ("trim", paint_trim), ("cabin", paint_cabin)):
        generate(material, painter)

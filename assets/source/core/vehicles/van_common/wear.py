"""Paint the shared van wear atlases. Run python3 -B wear.py.

Coordinates below are source texels. The UV rectangle runs from about 4 to
123 on each axis, with y increasing down a side panel or aft along the roof.
Widths of individual details account for the per-material layer reduction.
"""
from pathlib import Path
from zlib import crc32

import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.spatial import cKDTree

from surfaces import TAGS


OUT = Path(__file__).resolve().parent / "tex"
Y, X = np.mgrid[:128, :128].astype(float)
EDGE = np.maximum(0, np.minimum.reduce([X - 4, 123 - X, Y - 4, 123 - Y]))
PAINT = {"enamel", "pressed", "lower", "hood", "roof", "lip", "rearpress"}
LENSES = {"headlamp", "redlamp", "amber", "reverse"}
CLOTH = {"fabric", "bolster", "carpet", "headliner", "belt"}


def unit(v):
    return np.clip(v, 0, 1)


def mix(a, b, v):
    a, b = np.asarray(a), np.asarray(b)
    return a + (b - a) * unit(v)[..., None]


def field(rng, sigma):
    a = ndimage.gaussian_filter(rng.standard_normal(X.shape), sigma, mode="reflect")
    return unit(.50 + .203 * (a - a.mean()) / max(a.std(), 1.e-8))


def dab(layer, mask, time, color):
    """Alpha encodes arrival. At crossings the older mark owns its pigment."""
    alpha = np.rint(255 * unit(1 - time / 3)).astype(np.uint8)
    take = mask & (alpha > layer[..., 3])
    layer[take, 3] = np.broadcast_to(alpha, X.shape)[take]
    layer[take, :3] = np.broadcast_to(color, (*X.shape, 3))[take].round().clip(0, 255)


class Tile:
    def __init__(self, tag, step):
        self.rng = rng = np.random.default_rng(crc32(tag.encode()) + 1979)
        self.step = step
        self.hurt = np.zeros((128, 128, 4), dtype=np.uint8)
        self.decay = np.zeros_like(self.hurt)
        self.cloud = field(rng, (10, 13))
        self.scale = field(rng, (2.5, 3.5))
        self.grain = field(rng, .65 * step)
        self.sand = field(rng, .42)
        self.run = field(rng, (21, 1.25))
        self.tooth = .49 * self.scale + .34 * self.grain + .17 * self.sand

    def damage(self, mask, time, color):
        dab(self.hurt, mask, time, color)

    def weather(self, mask, time, color):
        dab(self.decay, mask, time, color)


def trace(points):
    """Signed distance and distance travelled along a hand-laid polyline."""
    points = np.array(points, dtype=float)
    best = np.full(X.shape, np.inf)
    travel, side = np.zeros_like(X), np.zeros_like(X)
    walked = 0
    for (x, y), (dx, dy) in zip(points, np.diff(points, axis=0)):
        length = np.hypot(dx, dy)
        tx, ty = X - x, Y - y
        u = unit((tx * dx + ty * dy) / length**2)
        d2 = (tx - u * dx)**2 + (ty - u * dy)**2
        closer = d2 < best
        best = np.minimum(best, d2)
        travel[closer] = walked + u[closer] * length
        side[closer] = np.where(dx * ty >= dy * tx, 1, -1)[closer]
        walked += length
    return side * np.sqrt(best), travel / walked


# One entry is one physical wound. Most begin at a hem or bend and end
# inside the sheet. The inset, outer skin and lower stamping have different
# contact heights so their marks do not form stripes across adjacent doors.
BODY_MARKS = {
    "enamel": [
        ("dent", .10, [(8, -2), (13, 11), (21, 20), (23, 33), (29, 41)]),
        ("score", .96, [(73, 62), (84, 59), (97, 58), (106, 55)]),
        ("dent", 1.87, [(131, 39), (119, 43), (112, 52), (109, 58)]),
        ("score", 2.08, [(31, 98), (40, 100), (48, 100)]),
    ],
    "pressed": [
        ("dent", .13, [(96, 125), (94, 112), (95, 105), (103, 94), (111, 90), (119, 79)]),
        ("score", .99, [(34, 48), (46, 39), (55, 38), (59, 35)]),
        ("dent", 1.86, [(-4, 83), (9, 79), (17, 70), (20, 64)]),
        ("dent", 2.06, [(70, 10), (77, 16), (89, 19)]),
    ],
    "lower": [
        ("score", .08, [(-6, 78), (16, 76), (37, 77), (51, 75)]),
        ("dent", .91, [(83, 129), (78, 115), (71, 106), (56, 100), (49, 92)]),
        ("dent", 1.81, [(92, 55), (102, 59), (108, 70), (110, 79)]),
        ("score", 2.07, [(17, 28), (23, 31), (33, 33)]),
    ],
    "rearpress": [
        ("dent", .07, [(-4, 48), (14, 50), (28, 58), (33, 68), (42, 75)]),
        ("score", .90, [(89, 83), (92, 73), (99, 63)]),
        ("dent", 1.84, [(4, 107), (19, 96), (34, 92), (41, 87)]),
        ("score", 2.05, [(65, 30), (76, 33), (86, 32)]),
    ],
    "hood": [
        ("dent", .03, [(129, 9), (112, 14), (101, 22), (87, 26), (78, 33)]),
        ("dent", .77, [(1, 16), (18, 21), (30, 32), (45, 36), (53, 42)]),
        ("score", 1.62, [(43, 64), (34, 57), (27, 54)]),
        ("dent", 1.90, [(86, 10), (100, 6), (109, -2)]),
        ("score", 2.03, [(96, 83), (104, 72), (108, 63)]),
    ],
    "roof": [
        ("score", .02, [(17, 4), (25, 31), (37, 58), (43, 82), (55, 103)]),
        ("dent", .78, [(127, 69), (109, 77), (98, 88), (91, 104)]),
        ("dent", 1.66, [(56, 117), (66, 107), (75, 105), (83, 98)]),
        ("score", 1.97, [(73, 17), (71, 29), (72, 41)]),
        ("dent", 2.13, [(5, 64), (11, 77), (12, 91)]),
    ],
    "lip": [
        ("score", .13, [(5, 67), (10, 78), (22, 89)]),
        ("dent", .92, [(57, 6), (67, 14), (80, 17), (91, 23)]),
        ("score", 1.82, [(91, 97), (102, 88), (109, 77)]),
        ("dent", 2.05, [(40, 128), (39, 116), (33, 107)]),
    ],
}


def fold(b, points, start, width):
    cross, along = trace(points)
    taper = np.sin(np.pi * along)**.68
    # Pinned sheet stays painted between its ridges. Put the dark bank on
    # the down-light side and catch light only on sections of exposed crest.
    d = cross + .85 * (b.scale - .5)
    core = width * (.20 + .93 * taper)
    shoulder = core + .85 * taper
    time = start + 1.06 * (1 - taper) + .50 * (1 - b.scale)
    shade = mix((43, 49, 51), (104, 107, 102), .54 * b.scale + .46 * b.grain)
    catch = mix((121, 128, 128), (196, 199, 189), .64 * b.grain + .36 * taper)
    b.damage(np.abs(d) < core, time, shade)
    b.damage((d > -shoulder) & (d < -core), time + .13, catch)
    # Ragged primer breaks and a narrower metal scratch beside the fold.
    land = (d - core) / (.8 + 3.6 * width * taper)
    bite = (land > -.06) & (land < 1) & (b.tooth > .44 + .23 * land + .14 * (1 - taper))
    b.damage(bite, time + .17 + .58 * unit(land),
             mix((86, 87, 84), (153, 145, 127), b.tooth))
    b.damage((np.abs(d + shoulder + .9) < .62) & (b.scale > .57) & (taper > .31),
             time + .24, catch)


def drag(b, points, breadth, start, dark, light):
    """Abraded contact patch. Unequal striations skip over intact paint."""
    d, u = trace(points)
    d += 1.6 * (b.scale - .5)
    taper = np.sin(np.pi * u)**.50
    width_noise = .48 + .91 * b.cloud + .16 * b.scale
    across = np.abs(d) / (.4 + breadth * taper * width_noise)
    width = b.step
    fibre = np.cos(d * (2.65 / width) + 1.6 * b.scale + 4.1 * u)
    tooth = .79 * b.tooth + .21 * b.cloud + .11 * fibre
    mask = (across < 1) & (tooth > .29 + .29 * across + .11 * (1 - taper))
    t = start + .62 * across + .96 * (1 - taper) + 1.64 * (.72 - tooth)
    pigment = .23 + .50 * b.grain + .28 * fibre + .12 * b.cloud
    b.damage(mask, t, mix(dark, light, pigment))


def chips(b, count, lower, dark, light):
    # Small sharp chips have a lifted lip on one side. Cluster the chips
    # loosely where grit hit; leave negative space between the clusters.
    rng = b.rng
    for i in range(count):
        if i % 6 == 0:
            cx, cy = rng.uniform(3, 125), rng.uniform(57 if lower else 3, 125)
            start = rng.uniform(.14, 1.87)
        x, y = rng.normal((cx, cy), (9, 6))
        a = rng.uniform(1.1, 3.6) * b.step**.58
        h = rng.uniform(.53, 1.0) * a
        dx = (X - x) / a
        dy = (Y - y + dx * rng.uniform(-1.8, 1.8)) / h
        outline = np.abs(dx) + np.abs(dy) + .92 * (.51 - b.grain)
        color = mix(dark, light, .16 + .38 * b.grain + .45 * (dy > .32))
        b.damage(outline < 1, start + .37 * outline + .15 * (i % 4), color)


def rainfall(b):
    # Pick actual oxide deposits, preferentially those under a wet ledge.
    # A little sediment catches below each one and thins down the panel.
    yy, xx = np.nonzero((b.decay[..., 3] > 70) & (b.run > .48) & (Y < 108) & (EDGE > 0))
    for i in b.rng.choice(len(xx), min(16, len(xx)), replace=False):
        x, y = xx[i], yy[i]
        length = b.rng.uniform(12, 40)
        along = (Y - y) / length
        width = b.rng.uniform(.8, 2.0)
        flow = X - x - b.rng.uniform(-2, 2) * along - 1.4 * (b.scale - .5)
        d = np.abs(flow) / (width * (1.2 - .84 * unit(along)))
        t = .71 + 1.27 * unit(along) + .42 * d + 1.27 * (1 - b.tooth)
        stain = mix((91, 73, 51), (153, 130, 93), b.grain + .14 * d)
        b.weather((along >= 0) & (along <= 1) & (d < 1) & (b.tooth > .23 + .16 * along), t, stain)


def oxidation(b, tag):
    # Creep in from the cut edges and chips. A few long stretches of the
    # hem are dry; the wet pockets grow inward with irregular flaked rims.
    sky = tag in {"hood", "roof"}
    lip = np.maximum(0, 123 - Y)
    near = ndimage.distance_transform_edt(b.hurt[..., 3] == 0)
    basin = .65 * b.cloud + .35 * b.scale
    reach = .8 + 10 * basin**2 + (0 if sky else 15) * np.exp(-lip / 13) * basin
    edge = EDGE / reach
    if tag in {"pressed", "rearpress"}:
        # The original base colour carries a stamped channel at ~10 texels.
        edge = np.minimum(edge, .49 + np.abs(EDGE - 7.6) / (1 + 3 * basin))
    if tag == "lip":
        arch = np.abs(np.hypot((X - 64) * 1.03, Y - 113) - 58.5)
        edge = np.minimum(edge, .48 + arch / (1.1 + 4.8 * basin))
    wound = .61 + near / (.68 + 5.8 * basin**2)
    feed = np.minimum(edge, wound)
    patina = .53 * b.scale + .31 * b.grain + .16 * b.sand
    t = .45 + 1.24 * feed + 2.45 * (.55 - patina) + 1.35 * (1 - basin)
    oxide = mix((65, 47, 40), (168, 88, 46), .22 + .54 * patina + .5 * (b.grain - .5))
    oxide = mix(oxide, (191, 129, 72), unit((patina - .51) * 2.8) * unit(feed))
    wet_pocket = .63 * basin + .37 * patina
    b.weather((feed < 1.8) & (wet_pocket > .38 + .095 * feed) & (patina > .27 + .14 * feed), t, oxide)
    if sky:
        dry = .52 * b.cloud + .33 * b.scale + .15 * b.grain
        # The renderer supplies overall desaturation. Only intermittent
        # failed clearcoat, with a dusty grey interior, needs pigment.
        b.weather(dry > .705, 3.07 - 4.2 * (dry - .68),
                  mix((130, 136, 137), (167, 167, 151), b.tooth))
    else:
        rainfall(b)


def paint_body(b, tag):
    # Paint only a narrow cross-section through the metal. Arrival travels
    # along the wound; pigment is confined to the crease or the scored line.
    for kind, start, points in BODY_MARKS[tag]:
        d, u = trace(points)
        crown = np.sin(np.pi * u)**.64
        d += .43 * (b.scale - .5)
        t = start + .67 * (1 - crown) + .17 * (1 - b.grain)
        if kind == "dent":
            # The deep side is 1–2 texels across. The light on the other
            # bank breaks before the shadow does, especially at the tips.
            half = .22 + .86 * crown
            shade = mix((39, 46, 50), (94, 99, 97), .54 * b.scale + .46 * b.grain)
            b.damage(np.abs(d) < half, t, shade)
            lit = (d < -half) & (d > -half - (.30 + 1.16 * crown))
            b.damage(lit & (b.scale + .22 * crown > .36), t + .08,
                     mix((135, 145, 146), (201, 203, 194), b.tooth))
            # A few chips right on the pinch, within a texel of its bank.
            nick = (d > half) & (d < half + 1.25 * crown) & (b.tooth > .60)
            b.damage(nick, t + .22, mix((99, 98, 90), (151, 147, 132), b.grain))
        else:
            half = .29 + 1.18 * crown
            steel = np.abs(d + .26 * crown) < (.18 + .49 * crown)
            primer = mix((81, 87, 89), (130, 133, 127), b.tooth)
            metal = mix((151, 159, 160), (212, 214, 201), .56 * b.scale + .44 * b.grain)
            color = np.where((steel & (b.tooth > .33))[..., None], metal, primer)
            b.damage(np.abs(d) < half, t, color)
    if not 4 <= len(BODY_MARKS[tag]) <= 6 or np.mean(b.hurt[4:124, 4:124, 3] > 0) > .10:
        raise ValueError(f"{tag} exceeds the painted-panel wear budget")
    oxidation(b, tag)


def facets(b, spacing):
    """Distances to shared crystal faces, plus colour and centre per piece."""
    iy, ix = np.mgrid[-2:np.ceil(128 / spacing) + 2, -2:np.ceil(128 / spacing) + 2]
    grid = np.column_stack((ix.ravel(), iy.ravel()))
    sites = spacing * (grid + b.rng.uniform(-.43, .43, grid.shape))
    tree = cKDTree(sites)
    dist, ids = tree.query(np.stack((X, Y), axis=-1), 2)
    normal = sites[ids[..., 1]] - sites[ids[..., 0]]
    span = np.linalg.norm(normal, axis=-1)
    border = (dist[..., 1]**2 - dist[..., 0]**2) / (2 * span)
    facing = .5 + .48 * (normal[..., 0] * .6 - normal[..., 1] * .8) / span
    return border, facing, b.rng.random(len(sites))[ids[..., 0]], sites[ids[..., 0]]


def star(b, origin, radii, rays, width, speed, start, pigment, keep, near_delay=0):
    # Join facets at shared vertices. A spoke occasionally splits at a bend;
    # some die in a short hook, others run all the way to the bonded seal.
    center = np.array(origin)
    angles = (np.arange(rays) + b.rng.uniform(-.27, .27, rays)) * 2 * np.pi / rays
    last = np.tile(center, (rays, 1))
    radial = np.hypot(X - center[0], Y - center[1])
    # On a pane, delay the outer bullseye before letting its running
    # cracks travel to the seal. Smaller lenses fracture more uniformly.
    onset = start + speed * radial + near_delay * (1 - np.exp(-radial / 10))
    for k, radius in enumerate(radii):
        a = angles + b.rng.uniform(-.12, .12, rays)
        lengths = radius * b.rng.uniform(.79, 1.18, rays)
        row = center + np.column_stack((np.cos(a), np.sin(a))) * lengths[:, None]
        for j, tip in enumerate(row):
            segments = [(last[j], tip, 0)]
            if k < len(radii) - 1 and b.rng.random() < (.77 if k < 2 else .33):
                segments.append((tip, row[(j + 1) % rays], .18))
            if k in (2, 3) and j % 3 == 1:
                turn = a[j] + b.rng.choice([-1, 1]) * .49
                branch = tip + .68 * radius * np.array([np.cos(turn), np.sin(turn)])
                segments.append((tip, branch, .23))
            for p, q, extra in segments:
                d, u = trace([p, q])
                w = width * (.85 + .22 * b.grain - .16 * u)
                body = np.abs(d) < w
                tone = .20 + .30 * b.grain + .22 * (j % 4) / 3 + .20 * (1 - unit(np.abs(d) / w))
                time = onset + .17 * (j % 3) + extra
                b.damage(body & keep, time, mix(*pigment, tone))
        last = row


def glazing(b, tag):
    window = tag == "glass"
    mirror = tag == "mirror"
    edge, glint, tone, centres = facets(b, 11.6 if window else 19)
    cx, cy = centres[..., 0], centres[..., 1]
    palettes = {
        "glass": ((97, 122, 128), (196, 211, 205)),
        "mirror": ((74, 91, 100), (222, 225, 211)),
        "headlamp": ((116, 136, 146), (230, 234, 217)),
        "redlamp": ((131, 46, 42), (243, 165, 148)),
        "amber": ((158, 90, 47), (247, 211, 155)),
        "reverse": ((113, 124, 121), (224, 223, 197)),
    }
    pigment = palettes[tag]
    if window:
        origin = (28, 12)
        # Adjacent fragments fall out as groups. The break along the seal
        # and the long bite below it have different shapes and depths.
        bite = np.minimum.reduce([
            np.hypot((cx - 72 + .40 * (cy - 31)) / 27, (cy - 31) / 20),
            np.hypot((cx - 88) / 23, (cy - 13) / 15),
            np.hypot((cx - 26 - .52 * (cy - 98)) / 18, (cy - 98) / 25),
        ])
        gone = bite < 1.02
        radial = np.hypot(X - origin[0], Y - origin[1])
        star(b, origin, [4, 9, 20, 38, 72, 148], 12, 1.29, .013, .12, pigment, ~gone, near_delay=.48)
        bull = (np.abs(radial - 3.1 - b.grain) < 1.05) | ((radial < 2) & (b.grain > .20))
        b.damage(bull, .04 + .06 * radial, mix(*pigment, .68 + .28 * b.grain))
        # Long running cracks precede the fine dicing. Only the light-facing
        # sides of small pellets flash; undamaged glass shows between them.
        # A second running stress starts at the lower bond, kinks past the
        # lower bite and branches into the main fracture above it.
        for points, start in [([(103, 128), (99, 111), (82, 95), (80, 82), (60, 62), (53, 45)], .62),
                              ([(82, 95), (66, 92), (55, 83), (41, 80)], 1.24)]:
            d, u = trace(points)
            b.damage((np.abs(d) < 1.13) & ~gone, start + .68 * u + .20 * b.scale,
                     mix(*pigment, .38 + .42 * b.tooth))
        onset = 1.25 + .0080 * radial + .51 * tone
        b.damage((edge < .89) & ~gone, onset,
                 mix(*pigment, .13 + .53 * glint + .22 * tone))
        fine, face, _, _ = facets(b, 5.6)
        b.damage((fine < .53) & (face > .55) & ~gone & (b.cloud > .38),
                 2.09 + .43 * (1 - face) + .003 * radial,
                 mix((74, 90, 94), (161, 177, 171), .55 * face + .28 * b.grain))
        b.damage(gone, 2.04 + .43 * bite + .20 * tone,
                 mix((13, 23, 30), (36, 47, 49), .53 * b.cloud + .47 * tone))
    else:
        origin = b.rng.uniform((26, 32), (77, 83))
        dx, dy = cx - origin[0], cy - origin[1]
        # Place the ejected section to one side of the initial pin strike;
        # that strike and its short cracks must survive every later stage.
        towards_mid = 1 if origin[0] < 64 else -1
        bite = np.hypot((dx * towards_mid - 40 + .28 * dy) / 53, (dy - 13) / 49) + .22 * (tone - .5)
        radial = np.hypot(X - origin[0], Y - origin[1])
        gone = (bite < 1.0) & (np.hypot(dx, dy) > 18) if not mirror else np.zeros_like(X, bool)
        star(b, origin, [7, 19, 42, 92], 7 if mirror else 8, 1.48, .017, .06, pigment, ~gone)
        # The reflector well has a dark rim and a few facets of exposed
        # silver backing at the torn plastic edge.
        dark = mix((14, 19, 24), (48, 47, 41), .63 * tone + .37 * b.grain)
        well = mix(dark, pigment[1], (bite > .71) * (edge < 2.0) * (.35 + .50 * glint))
        b.damage(gone, 1.14 + .98 * unit(bite) + .29 * tone, well)
        b.damage((edge < 1.40) & ~gone, 1.08 + .011 * radial + .39 * tone,
                 mix(*pigment, .19 + .46 * glint + .24 * tone))
        if mirror:
            # A sliver of the backing separates at one corner.
            b.damage((cx + .72 * cy > 166) & (tone > .26),
                     2.22 + .42 * tone, mix((43, 51, 55), (84, 91, 89), tone))

    damp = .48 * b.cloud + .30 * b.run + .22 * b.grain
    deposit = .64 * np.exp(-EDGE / 10) + .53 * np.exp(-np.maximum(0, 121 - Y) / 17)
    if window or mirror:
        # Runoff clears vertical channels through a film heavier at the seal.
        t = 4.26 - 2.31 * damp - deposit + .44 * (1 - b.run)
        film = mix((69, 79, 77), (143, 149, 129), .45 * b.scale + .55 * b.grain)
        b.weather((damp + .24 * deposit > .51) & (b.run > .22), t, film)
    else:
        yellow = ((119, 65, 42), (191, 127, 75)) if tag == "redlamp" else ((139, 113, 62), (214, 192, 130))
        b.weather(damp + .2 * deposit > .47, 3.80 - 2.64 * damp - deposit, mix(*yellow, b.tooth))


def wheel(b, tag):
    metal = tag in {"rim", "hub"}
    theta = np.arctan2(Y - 64, X - 64)
    radius = np.hypot(X - 64, Y - 64)
    angle = -.58 if metal else -.43
    arc = np.arccos(np.clip(np.cos(theta - angle), -1, 1))
    lip = 53 if tag != "hub" else 47
    band = radius - (lip - 3.7 * np.cos(2.3 * arc) + 1.6 * (b.scale - .5))
    groove = np.cos(1.75 * band - 1.3 * arc + b.scale * 2.4)
    t = .13 + .82 * arc + .126 * np.abs(band) + .52 * (1 - b.tooth)
    if metal:
        b.damage((arc < 2) & (np.abs(band) < 7.5 + 3 * b.cloud) & (b.tooth + .15 * groove + .18 * (b.cloud - .5) > .38),
                 t, mix((100, 104, 102), (224, 219, 200), .27 + .39 * b.grain + .27 * groove))
        drag(b, [(10, 73), (26, 81), (44, 84), (73, 84)], 6, 1.15, (81, 84, 82), (202, 200, 181))
        near = np.minimum(np.abs(radius - 55), np.abs(radius - 18) + 3)
        salt = .46 * b.cloud + .30 * b.scale + .24 * b.grain
        oxide = mix((78, 78, 70), (173, 174, 151), b.tooth)
        oxide = mix(oxide, (154, 95, 55), unit((b.scale - .48) * 3.2))
        b.weather(salt > .37, 3.72 - 2.92 * salt - .76 * np.exp(-near / 9), oxide)
    else:
        b.damage((arc < 1.65) & (np.abs(band) < 8) & (b.tooth + .16 * groove > .38),
                 t, mix((57, 57, 54), (144, 133, 109), .3 + .4 * b.grain + .25 * groove))
        for pts in [[(86, 9), (91, 18), (90, 23), (84, 32)], [(22, 65), (15, 76), (12, 88)],
                    [(33, 113), (44, 105), (47, 98)]]:
            d, u = trace(pts)
            w = 1.3 + 2.0 * np.sin(np.pi * u)
            b.damage(np.abs(d) < w, .29 + 1.28 * (1 - np.sin(np.pi * u)) + .29 * b.scale,
                     mix((18, 23, 25), (123, 115, 97), .17 * b.tooth + .75 * (d > .38 * w)))
        # Fine transverse splits open at a flexing shoulder. The tread
        # checks in staggered blocks, while the sidewall checks radiate.
        if tag == "rubber":
            fissure = np.abs(np.sin(theta * 29 + .077 * radius + 1.8 * b.scale))
            checking = (fissure < .38) & (np.cos(.32 * radius + 3.1 * b.cloud) > -.35)
        else:
            fissure = np.abs(np.sin(.26 * X + .17 * (Y % 19) + 1.3 * b.scale))
            checking = (fissure < .43) & (np.cos(.25 * Y + 2.1 * b.cloud) > -.34)
        dry = .52 * b.cloud + .29 * b.scale + .19 * b.grain
        b.weather(checking & (dry > .36), 2.80 - 2.45 * dry + .37 * fissure,
                  mix((31, 33, 33), (96, 90, 76), unit(fissure * 1.8) + .27 * b.grain))
        b.weather(dry > .51, 4.08 - 3.01 * dry - .38 * Y / 127,
                  mix((61, 62, 58), (120, 108, 89), b.tooth))


def hard_surface(b, tag):
    # Scraped substrate and its raised edge. The different stock determines
    # whether this is wood, pale stressed plastic, a scored floor or metal.
    pigments = {
        "sill": ((54, 54, 49), (161, 151, 125)), "step": ((60, 61, 58), (182, 180, 160)),
        "rubstrip": ((55, 56, 52), (163, 155, 133)), "seam": ((42, 45, 43), (116, 120, 113)),
        "highlight": ((69, 75, 73), (203, 201, 184)), "wheelhouse": ((51, 48, 40), (133, 123, 102)),
        "under": ((57, 53, 43), (145, 139, 118)), "lining": ((71, 71, 67), (175, 166, 143)),
        "ply": ((74, 51, 32), (208, 173, 115)), "chrome": ((61, 72, 75), (207, 211, 205)),
        "steel": ((61, 64, 62), (178, 175, 155)), "plate": ((56, 63, 64), (162, 159, 137)),
        "badge": ((45, 52, 53), (178, 181, 172)), "grille": ((32, 39, 42), (150, 150, 134)),
        "dash": ((24, 30, 33), (146, 137, 119)), "doorcard": ((46, 46, 43), (166, 151, 124)),
        "floor": ((65, 59, 48), (175, 166, 134)), "brake": ((39, 43, 39), (125, 118, 96)),
        "vent": ((24, 28, 29), (146, 139, 119)), "latch": ((68, 51, 49), (179, 147, 121)),
        "aluminium": ((65, 70, 70), (209, 209, 187)),
    }
    dark, light = pigments[tag]
    road = tag in {"sill", "step", "under", "wheelhouse", "rubstrip"}
    for i in range(3):
        x = b.rng.uniform(-6, 45) if i != 1 else b.rng.uniform(52, 85)
        y = 28 + 33 * i + b.rng.uniform(-11, 11)
        length = b.rng.uniform(37, 80)
        rake = b.rng.uniform(-10, 11)
        points = [(x, y), (x + length * .44, y + rake * .71 + 2), (x + length, y + rake)]
        drag(b, points, (6.3 if road else 4.8) * b.step**.40, .12 + .41 * i, dark, light)
    chips(b, 86 if road else 30, False, dark, light)
    if tag in {"plate", "grille", "lining", "steel"}:
        fold(b, [(5, 27), (25, 42), (50, 50), (67, 51), (90, 69)], .18, 1.15 * b.step)
    if tag in {"dash", "doorcard", "vent", "grille", "ply"}:
        # A pressure split crosses the dash pad; the ply separates along
        # a veneer and the grille loses several short slats around a punch.
        points = ([(8, 72), (29, 68), (45, 58), (68, 57), (82, 44), (109, 34)]
                  if tag != "ply" else [(1, 48), (29, 51), (43, 48), (71, 47), (98, 42)])
        d, u = trace(points)
        w = (.40 + 1.45 * np.sin(np.pi * u)) * b.step
        b.damage(np.abs(d) < w, .07 + 1.42 * (1 - np.sin(np.pi * u)),
                 mix(dark, light, .17 * b.tooth + .66 * (d < -.38 * w)))
        if tag in {"vent", "grille"}:
            punch = np.hypot((X - 50) / 27, (Y - 65 + .5 * (X - 50)) / 25)
            end = (Y // (14 if tag == "vent" else 8) % 3) * .13
            b.damage(punch < .80 + end + .21 * b.scale, 1.0 + .95 * punch + .34 * end,
                     mix((14, 20, 23), (137, 135, 119), .18 * b.scale + .65 * (punch > .71 + end)))

    trap = np.exp(-EDGE / 10)
    wet = .49 * b.cloud + .30 * b.scale + .21 * b.grain
    if road or tag in {"floor", "brake"}:
        base = unit((Y - 38) / 82)
        silt = .68 * wet + .32 * field(b.rng, (2, 12))
        t = 3.47 - 2.48 * silt - .63 * base - .45 * trap
        b.weather(silt > .52 - .10 * base,
                  t, mix((65, 62, 52), (141, 128, 99), .60 * b.tooth + .40 * silt))
    elif tag in {"highlight", "steel", "chrome", "badge", "grille", "plate", "aluminium"}:
        pitting = .42 * wet + .58 * b.grain
        stain = mix((88, 86, 73), (172, 166, 133), pitting)
        stain = mix(stain, (137, 82, 45), trap * (.28 + .65 * b.scale) if tag != "aluminium" else 0.)
        b.weather(pitting > .58 - .19 * trap, 3.65 - 2.55 * pitting - .80 * trap, stain)
    else:
        dusty = mix((87, 80, 65), (166, 155, 128), b.tooth)
        b.weather(wet > .46, 3.96 - 3.04 * wet - .40 * trap, dusty)


def upholstery(b, tag):
    cuts = {
        "fabric": [([(20, 19), (32, 46), (49, 60), (53, 75), (67, 97)], 9),
                   ([(86, 49), (91, 63), (109, 78)], 4.4)],
        "bolster": [([(19, 114), (29, 92), (29, 81), (45, 64), (55, 42)], 9.5),
                    ([(79, 20), (88, 30), (103, 34)], 5)],
        "carpet": [([(8, 89), (29, 81), (45, 80), (63, 72), (86, 78)], 10),
                   ([(61, 44), (72, 42), (99, 48)], 5.5)],
        "headliner": [([(12, 28), (29, 49), (52, 55), (72, 75), (105, 83)], 8.5),
                      ([(22, 95), (36, 100), (45, 110)], 4.3)],
        "belt": [([(2, 49), (20, 56), (42, 53), (66, 66), (79, 64)], 6.3),
                 ([(86, 104), (101, 99), (125, 98)], 3.6)],
    }
    fibre = ((120, 91, 58), (207, 175, 118)) if tag in {"fabric", "bolster", "headliner"} else ((68, 61, 49), (141, 127, 94))
    for j, (points, width) in enumerate(cuts[tag]):
        d, u = trace(points)
        along = np.sin(np.pi * u)
        w = width * along**.65 + .45
        ratio = (d + 2.7 * (b.grain - .5)) / w
        thread = np.cos((X + .32 * Y) * .72 + 1.7 * b.scale)
        exposed = np.abs(ratio) < 1.13 + .19 * thread
        foam = mix(*fibre, .50 * b.scale + .5 * b.grain)
        wound = mix((44, 39, 36), foam, unit(1.07 - np.abs(ratio + .18)) * (.65 + .32 * b.tooth))
        wound = mix(wound, (192, 175, 144), (ratio > .48) * (.52 + .37 * b.grain))
        wound = mix(wound, (169, 156, 131), (thread > .78) * (ratio < -.15) * .77)
        b.damage(exposed, .12 + .73 * j + 1.30 * (1 - along) + .62 * np.abs(ratio), wound)
    # The upholstery eventually pulls free beside the seam. The exposed
    # backing comes through in broad, interrupted strips at the cabin mip.
    if tag in {"fabric", "bolster", "headliner"}:
        d, u = trace([(109, -2), (108, 22), (103, 40), (105, 51), (101, 69)])
        opening = np.sin(np.pi * u) * (4.8 + 3.9 * b.scale)
        b.damage((np.abs(d) < opening) & (b.grain + .15 * np.cos(.48 * Y) > .28),
                 1.72 + .42 * np.abs(d) / np.maximum(.1, opening) + .37 * (1 - b.scale),
                 mix((71, 59, 46), fibre[1], .28 * b.tooth + .54 * (d < 0)))
    # Damp propagates in colonies concentrated at seams; inside a colony
    # the centre goes olive and the younger stippled edges stay pale.
    site = .53 * b.cloud + .28 * b.scale + .19 * b.grain
    seam = np.exp(-np.minimum(np.abs(X - 15), np.abs(X - 112)) / 15)
    level = site + .12 * seam + .06 * Y / 127
    mold = mix((91, 94, 70), (174, 171, 140), .29 + .60 * b.grain + .23 * (1 - level))
    mold = mix(mold, (75, 79, 64), unit((level - .62) * 3.7))
    b.weather(level > .53, 4.10 - 3.77 * level + .26 * (1 - b.grain), mold)


def instruments(b, tag):
    # Constrain the fractures to the original clock glasses and LCDs.
    if tag == "gauges":
        dials = np.minimum(np.hypot((X - 34) / 27, (Y - 61) / 32),
                           np.hypot((X - 94) / 27, (Y - 61) / 32))
        face = dials < 1
        center = (42, 48)
    elif tag == "lamp":
        face = np.ones_like(X, bool)
        center = (74, 35)
    else:
        face = (X >= 18) & (X <= 109) & (Y >= 18) & (Y <= 71)
        center = (78, 34) if tag == "screen" else (27, 56)
    star(b, center, [9, 26, 61, 110], 6, 2.7, .025, .12,
         ((84, 108, 110), (205, 211, 192)), face)
    edge, glint, tone, centers = facets(b, 21)
    cx, cy = centers[..., 0], centers[..., 1]
    loss = np.hypot((cx - center[0] - 8) / 23, (cy - center[1] - 5) / 16)
    b.damage(face & (edge < 2.4), 1.26 + .39 * tone + .006 * np.hypot(X - center[0], Y - center[1]),
             mix((64, 77, 77), (170, 185, 172), glint))
    b.damage(face & (loss < 1), 1.24 + .83 * loss,
             mix((18, 26, 29), (50, 58, 58), tone))
    if tag == "radio":
        drag(b, [(11, 89), (37, 95), (66, 94), (90, 101)], 7.1, .63, (37, 44, 46), (138, 132, 116))
    dust = .51 * b.cloud + .27 * b.grain + .22 * b.run
    b.weather(dust > .48, 3.9 - 2.80 * dust - .50 * np.exp(-EDGE / 12),
              mix((96, 96, 79), (174, 163, 130), b.tooth))


def paint_tile(tag, step):
    b = Tile(tag, step)
    if tag == "invisible":
        return b.hurt, b.decay
    if tag in PAINT:
        paint_body(b, tag)
    elif tag in LENSES | {"glass", "mirror"}:
        glazing(b, tag)
    elif tag in {"rim", "hub", "tread", "rubber"}:
        wheel(b, tag)
    elif tag in CLOTH:
        upholstery(b, tag)
    elif tag in {"gauges", "screen", "lamp", "radio"}:
        instruments(b, tag)
    else:
        hard_surface(b, tag)

    # Each stored texel belongs to one layer. Otherwise the downsample
    # can tint a fresh crack with dust from an adjacent decay-only sample.
    stored = 128 // step
    hit = b.hurt[..., 3].reshape(stored, step, stored, step).any(axis=(1, 3))
    b.decay[hit.repeat(step, 0).repeat(step, 1)] = 0
    # Extend only this tile's pigment into its UV padding. Leave a one-pixel
    # transparent separator so the periodic atlas seam is also empty.
    tiles = []
    for pixels in (b.hurt, b.decay):
        tile = np.pad(pixels[4:124, 4:124], ((4, 4), (4, 4), (0, 0)), mode="edge")
        tile[[0, -1], :] = 0
        tile[:, [0, -1]] = 0
        tiles.append(tile)
    return tiles


def main():
    for material, tags in TAGS.items():
        step = {"coach": 1, "fittings": 2, "cabin": 4}[material]
        atlases = [Image.new("RGBA", (512, 512)) for _ in range(2)]
        for i, tag in enumerate(tags):
            for atlas, tile in zip(atlases, paint_tile(tag, step)):
                atlas.paste(Image.fromarray(tile), (i % 4 * 128, i // 4 * 128))
        for role, atlas in zip(("hurt", "decay"), atlases):
            atlas.paste(atlas.crop((0, 0, 512, 1)), (0, 511))
            atlas.paste(atlas.crop((0, 0, 1, 512)), (511, 0))
            atlas.save(OUT / f"{material}-{role}.png", optimize=True)


if __name__ == "__main__":
    main()

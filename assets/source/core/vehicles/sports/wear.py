"""Paint the shared sports-car wear atlas. Run python3 -B wear.py here.

Distances are source texels. Alpha records onset in game stages, independently
of pigment. The part edges fall inside each chart at the box projection inset.
"""
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.spatial import cKDTree

from finish import SWATCH


TEX = Path(__file__).resolve().parent / "tex"
INSET = .055


def clamp(x):
    return np.clip(x, 0, 1)


def mix(lo, hi, value):
    return np.asarray(lo) + (np.asarray(hi) - lo) * clamp(value)[..., None]


def deposit(layer, mask, onset, pigment):
    """At a crossing, retain the material exposed by the first contact."""
    alpha = np.rint(255 * clamp(1 - np.asarray(onset) / 3)).astype(np.uint8)
    keep = mask & (alpha > layer[..., 3])
    layer[..., 3][keep] = np.broadcast_to(alpha, mask.shape)[keep]
    layer[..., :3][keep] = np.broadcast_to(pigment, layer[..., :3].shape)[keep]


class Swatch:
    def __init__(self, w, h, seed):
        self.w, self.h = w, h
        self.rng = np.random.default_rng(seed)
        self.y, self.x = np.mgrid[:h, :w] + .5
        self.u, self.v = self.x / w, self.y / h
        self.edge = np.minimum(w * (np.minimum(self.u, 1 - self.u) - INSET),
                               h * (np.minimum(self.v, 1 - self.v) - INSET))
        self.hurt = np.zeros((h, w, 4), np.uint8)
        self.decay = np.zeros_like(self.hurt)
        self.cloud = self.noise(25, 24)
        self.flake = self.noise(6, 5)
        self.grit = self.noise(2.2, 2.1)
        self.tooth = self.rng.random((h, w))
        self.grain = .46 * self.flake + .34 * self.grit + .20 * self.tooth

    def noise(self, dx, dy):
        grid = self.rng.random((int(self.h / dy) + 5, int(self.w / dx) + 5))
        return clamp(ndimage.map_coordinates(grid, [1 + self.y / dy, 1 + self.x / dx],
                                             order=3, mode="nearest"))

    def impact(self, mask, onset, pigment):
        deposit(self.hurt, mask, onset, pigment)

    def age(self, mask, onset, pigment):
        deposit(self.decay, mask & (self.hurt[..., 3] == 0), onset, pigment)

    def path(self, points):
        """Signed bank and fractional travel along a bent tool or fracture."""
        points = np.array(points, float)
        vectors = np.diff(points, axis=0)
        lengths = np.linalg.norm(vectors, axis=1)
        best = np.full_like(self.x, np.inf)
        signed, travel = np.zeros_like(self.x), np.zeros_like(self.x)
        walked = 0
        for (x, y), (dx, dy), length in zip(points, vectors, lengths):
            px, py = self.x - x, self.y - y
            s = clamp((px * dx + py * dy) / length**2)
            d = np.hypot(px - s * dx, py - s * dy)
            nearer = d < best
            signed = np.where(nearer, np.copysign(d, py * dx - px * dy), signed)
            travel = np.where(nearer, walked + s * length, travel)
            best = np.minimum(best, d)
            walked += length
        return signed, travel / walked


# The pinch is dark; only the downhill bank catches light. Local patches of
# scoured ground coat extend beyond the cut, with steel confined to its lip.
def fold(s, points, width, onset):
    bank, travel = s.path(points)
    taper = np.sin(np.pi * travel) ** .58
    bank += (s.flake - .5) * 1.45 + (s.grit - .5) * .68
    ridge = .35 + 1.13 * taper
    span = (travel > 0) & (travel < 1)
    start = onset + .66 * (1 - taper) + .32 * (1 - s.flake)
    shade = mix((29, 34, 41), (79, 81, 83), .68 * s.flake + .32 * s.grit)
    s.impact(span & (abs(bank) < ridge), start, shade)
    light = mix((106, 114, 119), (188, 193, 185), s.grain)
    s.impact(span & (bank >= ridge) & (bank < ridge + 1.57 * taper) &
             (s.flake + .32 * taper > .40), start + .08, light)
    patch = abs(bank - ridge - 1.15) / (1 + width * taper)
    # Jagged patches of primer, untinted even on dyed black paint.
    bite = .58 * s.flake + .28 * s.grit + .14 * s.tooth
    s.impact(span & (patch < 1) & (bite > .43 + .32 * patch + .13 * (1 - taper)),
             start + .24 + .65 * patch,
             mix((83, 86, 89), (157, 150, 134), .59 * s.flake + .41 * s.grit))
    s.impact(span & (abs(bank + ridge + .8) < taper) & (bite > .49),
             start + .13, mix((137, 148, 154), (202, 205, 195), s.grit))


def drag(s, points, width, onset, dark=(58, 62, 65), pale=(172, 170, 157)):
    """Abraded contact skips between ridges. Grain runs along the actual drag."""
    bank, travel = s.path(points)
    envelope = np.sin(travel * np.pi) ** .66
    strand = np.cos(2.05 * bank + 1.35 * np.sin(7 * travel) + 1.9 * s.flake)
    across = abs(bank + .9 * (s.grit - .5)) / (.3 + width * envelope)
    contact = .35 * s.flake + .23 * s.grit + .19 * s.cloud + .23 * (.5 + .5 * strand)
    main = (across < 1) & (travel > 0) & (travel < 1)
    t = onset + .69 * across + .68 * (1 - envelope) + .66 * (1 - contact)
    tint = clamp(.15 + .55 * s.flake + .33 * strand + .15 * s.grit)
    s.impact(main & (contact > .28 + .31 * across), t, mix(dark, pale, tint))


def paint_fold(s, points, onset, lit_side, chip_at):
    """Two open banks of a dent. Dye shows through the valley between them."""
    bank, walk = s.path(points)
    span = (walk > 0) & (walk < 1)
    bank = lit_side * bank + .55*(s.flake - .5)
    end = abs(walk - chip_at)
    shade_width = 1.06 + .70*np.sin(np.pi*walk)
    shadow = mix((43, 34, 27), (76, 63, 51), .57*s.flake + .43*s.grit)
    s.impact(span & (abs(bank) < shade_width), onset + 1.10*end + .20*(1-s.flake), shadow)

    # Leave several clear source texels between the crease and its broken
    # lip. They still separate the two lines after the 2:1 mip reduction.
    lip = 4.7 + 1.85*np.sin(np.pi*walk)
    glint = span & (abs(bank - lip) < 1.09) & (end < .46) & (s.flake + .29*s.grit > .37)
    s.impact(glint, onset + .14 + 1.38*end + .18*(1-s.grit),
             mix((136, 128, 112), (186, 181, 165), s.grain))
    # A flake at the hinge exposes ground coat outside the valley. A short
    # steel hairline lies on its broken edge. The rest keeps the panel dye.
    nick = abs(walk - chip_at)/.12 + abs(bank - lip - 1.9)/2.65
    s.impact(span & (nick < .73 + .53*s.grit), onset + .36 + .35*nick,
             mix((96, 91, 82), (146, 140, 126), s.grain))
    s.impact(span & (abs(walk - chip_at) < .065) & (abs(bank-lip-2.9)<.92),
             onset + .25 + end, mix((150, 148, 140), (190, 186, 171), s.grit))


def paint_score(s, points, onset, contact):
    """A narrow skip in clearcoat and primer along a sliding contact."""
    bank, walk = s.path(points)
    span = (walk > 0) & (walk < 1)
    end = abs(walk - contact)
    bank += .4*(s.grit - .5)
    width = 1.17 + .59*np.exp(-((walk-contact)/.17)**2)
    tooth = .66*s.flake + .34*s.grit
    keeps = span & (abs(bank) < width) & (tooth > .14 + .22*end)
    s.impact(keeps, onset + 1.28*end + .31*(1-tooth),
             mix((72, 65, 54), (177, 171, 154), .14 + .55*tooth + .24*(bank>0)))
    # Only the short interval that cut through the primer catches as steel.
    s.impact(span & (end < .17) & (abs(bank-.45) < 1.0) & (s.flake > .30),
             onset + .04 + end, mix((153, 151, 139), (190, 186, 171), s.grit))
    chatter = span & (end < .24) & (abs(bank - 4.5 - 1.4*walk) < 1.01) & (tooth > .41)
    s.impact(chatter, onset + .57 + 1.8*end,
             mix((102, 91, 75), (160, 155, 138), s.grain))


def paint(s):
    # Seven sites on the entire reusable swatch. V runs along a door and U
    # along a deck. Unequal lengths and arrival times make a few read first.
    paint_fold(s, [(12,71),(29,62),(44,43),(65,35)], .12, 1, .60)
    paint_fold(s, [(141,103),(163,111),(178,111),(189,118),(201,137)], .74, -1, .53)
    paint_fold(s, [(98,242),(120,227),(126,211),(144,197)], 1.88, 1, .55)
    paint_score(s, [(78,33),(80,70),(76,94),(71,121),(69,151)], .17, .39)
    paint_score(s, [(198,155),(204,177),(205,202),(210,230)], 1.59, .68)
    paint_score(s, [(115,59),(151,54),(174,54),(201,47),(221,46)], .53, .72)

    # One stone strike with a small lifted lip and an irregular primer core.
    bank = s.x - 39 + .50*(s.y-181)
    chip = abs(bank)/4.2 + abs(s.y-181)/2.7 + .32*(s.flake-.5)
    s.impact(chip < 1.12, .32 + .73*chip,
             mix((92, 85, 73), (152, 145, 126), s.grain))
    s.impact((chip < .64) & (bank > -.3), .25 + .45*chip, (169, 165, 151))

    # Water enters at the projected panel boundary. Only the most exposed
    # lengths of the lower return build up thick rust. On the top and side
    # hems the seam peeks through separate, much thinner patches.
    lower = clamp((s.v - .79) / .14)
    wet = .54*s.cloud + .31*s.flake + .15*s.grit
    reach = 1.4 + (5.8 + 9.0*lower)*s.cloud**1.25 + 3.0*s.flake
    depth = np.maximum(s.edge, 0) / reach
    oxide = mix((76, 45, 29), (172, 89, 42), .18 + .74*s.grain)
    oxide = mix(oxide, (203, 127, 57), clamp(3*(s.grain-.56)))
    s.age((depth < 1.04) & (wet > .33 + .22*depth - .05*lower),
          .13 + 1.60*depth + 1.37*(1-wet), oxide)

    # Dilute residue runs down from three breaks in the upper seam. Separate
    # streaks taper at different heights. No rust grows in the panel field.
    for x, length, width, lean in [(44,56,2.8,-1.7), (131,31,2.0,1.2), (211,72,3.4,2.1)]:
        down = (s.y - INSET*s.h) / length
        drift = lean*down + .76*np.sin(4.8*down + x)
        brush = abs(s.x - x - drift + .32*(s.flake-.5)) / (.8 + width*(1-clamp(down)))
        stream = (down >= 0) & (down < 1) & (brush < 1) & (s.grain > .18 + .18*brush)
        stain = mix((81, 67, 48), (145, 116, 78), s.grain)
        s.age(stream, .82 + .98*down + .71*brush + .40*(1-wet), stain)

    top = s.y - INSET*s.h
    chalk = .63*s.cloud + .25*s.flake + .12*s.grit
    s.age((top >= 0) & (top < 8) & (chalk > .66 + .017*top),
          2.63 - 1.79*(chalk-.65), mix((123, 122, 111), (162, 157, 136), s.grain))


def cells(s, pitch):
    """Boundary distance, centre and facing of each irregular glass fragment."""
    yy, xx = np.mgrid[-2:int(s.h/pitch)+3, -2:int(s.w/pitch)+3]
    centres = pitch * (np.stack([xx, yy], -1).reshape(-1, 2)
                       + s.rng.uniform(-.43, .43, (xx.size, 2)))
    xy = np.stack([s.x + .55 * (s.flake - .5), s.y + .4 * (s.grit - .5)], -1)
    d, i = cKDTree(centres).query(xy, k=2)
    centre = centres[i[..., 0]]
    normal = centres[i[..., 1]] - centre
    spacing = np.linalg.norm(normal, axis=-1)
    edge = (d[..., 1]**2 - d[..., 0]**2) / (2 * spacing)
    facing = .5 + (.32 * normal[..., 0] - .35 * normal[..., 1]) / spacing
    return edge, centre[..., 0], centre[..., 1], facing


def star(s, cx, cy, reach, count, start, allowed, low, high):
    """Open, intersecting fracture rings grow out of a small impact pit."""
    theta = np.arange(count) * (2 * np.pi / count) + s.rng.uniform(-.15, .15, count)
    previous = np.tile((cx, cy), (count, 1))
    r = np.hypot(s.x - cx, s.y - cy)
    for n, fraction in enumerate((.13, .32, .61, 1)):
        a = theta + s.rng.uniform(-.14, .14, count)
        length = fraction * reach * s.rng.uniform(.78, 1.19, count)
        ring = np.column_stack((cx + np.cos(a) * length, cy + np.sin(a) * length))
        for j, end in enumerate(ring):
            for k, base in enumerate((previous[j], ring[j-1])):
                if k and s.rng.random() > (.67 if n < 2 else .29):
                    continue
                line, _ = s.path([base, end])
                tint = mix(low, high, .13 + .30 * (line > 0) + .47 * s.grit)
                s.impact(allowed & (abs(line) < (1.05 if not k else .82)),
                         start + .84 * r / reach + .19 * k + .16 * (j % 3), tint)
        previous = ring
    s.impact(allowed & (abs(r - 2.7 + .58 * (s.grit - .5)) < .92),
             start + .03, mix(low, high, .27 + .62 * s.grit))


def glazing(s, tag, base_alpha):
    edge, cx, cy, facing = cells(s, 6.3 if tag == "glass" else 8.2)
    low, high = (69, 88, 98), (174, 191, 188)
    opaque = base_alpha > 0
    if tag == "glass":
        # Only the sampled frit, upper sun band, and bottom seal get shards.
        # The sparse glints painted across the open centre are left alone.
        rim = (base_alpha == 255) | (base_alpha == 220)
        bite = np.minimum.reduce([
            np.hypot((cx - 39)/14, (cy - 17)/8),
            np.hypot((cx - 104)/16, (cy - 13)/7),
            np.hypot((cx - 9)/7, (cy - 65)/18),
            np.hypot((cx - 118)/7, (cy - 92)/15),
            np.hypot((cx - 74)/14, (cy - 118)/6),
        ])
        gone = bite < 1
        for x, y, length, spokes, t in [(24,13,34,9,.06),(114,38,30,7,.42),
                                        (59,117,29,8,.31),(5,84,24,8,.59)]:
            star(s, x, y, length, spokes, t, rim & ~gone, low, high)
        s.impact(rim & ~gone & (edge < 1.04) & (s.cloud + .35 * facing > .43),
                 1.04 + .84 * (1 - s.cloud) + .43 * (1 - facing),
                 mix(low, high, .55 * facing + .36 * s.grit))
        teeth = ndimage.distance_transform_edt(~gone)
        s.impact(rim & ~gone & (teeth < 2.15) & (facing + .52*s.grit > .61),
                 .50 + .64*(1-facing) + .32*s.flake,
                 mix((100, 123, 129), (194, 206, 199), .47*facing + .45*s.grain))
    else:
        rim = opaque
        if tag in ("screen", "navigation"):
            sx, sy = (.27, .31) if tag == "screen" else (.71, .61)
            # Liquid crystal pools under the cover, with a fringe of failed
            # rows; the maps and figures survive between the splinters.
            dx, dy = s.u - sx, s.v - sy
            ink = np.hypot(dx / .23, (dy - dx * .62) / .28)
            bite = ink + .62 * (s.cloud - .5) + .22 * (s.flake - .5)
            gone = bite < .89
            fringe = (bite < 1.22) & ~gone & (np.floor(s.y) % 5 < 2)
            s.impact(fringe, 1.25 + .83 * bite, mix((45, 56, 68), (102, 116, 113), s.grain))
        else:
            sx, sy = s.rng.uniform(.2, .38), s.rng.uniform(.37, .70)
            # Select whole irregular facets for the missing section. A few
            # tilted teeth survive along the boundary of the dark housing.
            hx, hy, rx, ry, tilt = {
                "lamp": (.55, .52, .34, .25, -.49),
                "white": (.70, .43, .44, .23, .37),
                "red": (.39, .62, .36, .29, -.61),
                "amber": (.46, .39, .26, .39, .46),
                "mirror": (.72, .65, .19, .13, -.57),
            }[tag]
            dx, dy = cx/s.w - hx, cy/s.h - hy
            bite = np.minimum(np.hypot(dx/rx, (dy-tilt*dx)/ry),
                              np.hypot((dx+.69*rx)/(.72*rx), (dy-.65*ry)/(.80*ry)))
            gone = bite < 1
        star(s, sx*s.w, sy*s.h, .78 * max(s.w,s.h), 8, .10, ~gone, low, high)
        s.impact((edge < 1.02) & ~gone & (bite < 1.98),
                 1.10 + .48 * bite + .39 * (1 - facing),
                 mix(low, high, .6 * facing + .31 * s.grain))
    dark = mix((11, 16, 22), (37, 43, 45), .28 * s.grit + .52 * s.cloud + .2 * facing)
    # Make broken-out lights legible on narrow LED ribbons by hurt two.
    s.impact(rim & gone, .69 + 1.34 * np.minimum(bite, 1) + .29 * s.flake, dark)
    salt = .53 * s.cloud + .29 * s.flake + .18 * s.grit
    border = np.exp(-np.maximum(s.edge, 0) / 7)
    if tag in ("lamp", "white", "red", "amber"):
        lo, hi = ((107, 67, 50), (181, 121, 77)) if tag == "red" else ((116, 106, 77), (196, 177, 109))
    else:
        lo, hi = (65, 74, 76), (146, 149, 128)
    s.age(rim & (salt > .60 - .19 * border), 3.05 - 2.02 * (salt - .30) - .88 * border,
          mix(lo, hi, s.grain))


def round_metal(s, tag):
    dx = (s.u - .5) / .445
    dy = (s.v - .5) / .445
    radius = np.hypot(dx, dy)
    angle = np.arctan2(dy, dx)
    sector = (1 + np.cos(angle - .82 + .32 * s.cloud)) / 2
    track = .93 if tag == "alloy" else .72
    rake = abs(radius - track - .035 * (s.flake - .5))
    groove = np.cos(radius * s.w * .97 + 1.17 * np.sin(2 * angle) + 2 * s.flake)
    s.impact((rake < .09 + .10 * s.flake) & (sector + .36 * s.flake > .57) &
             (groove + s.grit > -.31), .10 + 1.80 * (1-sector) + 6 * rake + .44 * (1-s.grit),
             mix((76, 83, 88), (202, 201, 183), .44 + .31 * groove + .24 * s.grain))
    bloom = .46 * s.cloud + .31 * s.flake + .23 * s.grit
    if tag == "disc":
        score = abs(radius - .86 - .007 * s.flake)
        s.impact((score < .021) & (sector + .3*s.cloud > .52), 1.0 + sector + 9*score,
                 mix((63, 61, 61), (166, 167, 157), s.grain))
        s.age(bloom + .12 * (radius < .52) > .35, 2.87 - 2.52*bloom + .27*groove,
              mix((71, 47, 37), (170, 101, 54), s.grain))
    else:
        for path in [[(.13,.68),(.24,.57),(.30,.52)], [(.50,.81),(.64,.76),(.72,.70)],
                     [(.66,.28),(.76,.20),(.84,.17)]]:
            drag(s, np.array(path) * [s.w,s.h], 3.9, .45)
        s.age(bloom > .48 - .09 * (rake < .14), 3.08 - 2.35*bloom - .24*(rake < .14),
              mix((84, 89, 89), (175, 174, 154), s.grain))


def rubber(s, tag):
    for path, width, t in [
            ([(.06,.24),(.21,.31),(.30,.44),(.41,.49)], 4.1, .12),
            ([(.40,.76),(.55,.66),(.72,.64),(.87,.54)], 5.2, .27),
            ([(.75,.22),(.81,.15),(.92,.10)], 3, .87)]:
        bank, walk = s.path(np.array(path) * [s.w, s.h])
        taper = np.sin(np.pi * walk)**.60
        bank += s.flake - .5
        slit = width * taper
        s.impact(abs(bank) < slit, t + .8 * (1-taper) + .18*s.grit,
                 mix((12, 16, 21), (92, 87, 78), clamp(.38 + .52 * bank / width + .15 * s.grit)))
        cords = (bank > slit - .5) & (bank < slit + 2.2 * taper) & (s.flake > .39)
        s.impact(cords, t + .48 + .40 * (1-taper), mix((79, 75, 69), (144, 135, 115), s.grain))
    if tag == "rubber":
        radius = np.hypot(s.u - .5, s.v - .5)
        run = np.cos(1.30 * radius * s.w + 1.9*s.flake)
        shoulder = abs(radius - .41) / .07
        drag_side = (s.u < .41) & (s.v > .35)
        s.impact(drag_side & (shoulder < 1) & (run + s.grain > .12 + .39*shoulder),
                 .62 + .81*shoulder + .67*(1-s.cloud),
                 mix((54, 54, 52), (123, 115, 97), .20 + .3*run + .49*s.grain))
    else:
        rib = (s.x + s.y * .69) % 19
        chipped = abs(s.u - .78 + .13*s.flake) < .17
        s.impact(chipped & (rib < 2.5 + 3*s.flake) & (s.grain > .40),
                 .68 + 1.36*s.v + .34*s.flake, mix((36, 36, 35), (107, 98, 82), s.grain))
    edge, _, _, _ = cells(s, 9 if tag == "rubber" else 7)
    dry = .6*s.cloud + .4*s.flake
    s.age((edge < 1.14) & (dry > .38), 2.62 - 1.9 * (dry-.25),
          mix((28, 30, 30), (76, 70, 62), s.grain))
    s.age(dry + .15*s.grit > .73, 3.06 - 2.13*(dry-.29),
          mix((61, 61, 60), (113, 109, 94), s.grain))


def panels(s, tag):
    # The backing differs from the exposed face: tow under carbon weave,
    # oxidised metal under plated trim, pale stressed edges around polymer.
    tones = {
        "carbon": ((41, 43, 44), (151, 148, 128)),
        "grille": ((28, 31, 35), (137, 138, 124)),
        "silver": ((74, 79, 82), (190, 191, 178)),
        "brush": ((65, 70, 74), (182, 181, 167)),
        "caliper": ((72, 67, 61), (159, 153, 133)),
        "seam": ((20, 23, 26), (88, 82, 71)),
        "dash": ((34, 35, 36), (139, 132, 115)),
        "liner": ((29, 27, 26), (125, 117, 99)),
        "plate": ((45, 49, 52), (155, 157, 146)),
    }
    lo, hi = tones[tag]
    # Small chipped returns and a longer sliding contact on each component.
    # Directions on the recessed channels, seatbacks and brightwork differ.
    for t in (.14, .68, 1.55):
        centre = s.rng.uniform(.16, .84, 2)
        angle = s.rng.uniform(-1.2, 2.8)
        along = np.array([np.cos(angle), np.sin(angle)])
        across = np.array([-along[1], along[0]])
        run = s.rng.uniform(.12, .24)
        path = [centre - run*along, centre, centre + .8*run*along + .04*across]
        drag(s, np.array(path) * [s.w,s.h], s.rng.uniform(2.4, 4.5), t, lo, hi)
    if tag == "carbon":
        # A sheared flake of resin uncovers the fine diagonal bundles, with a
        # narrow dark split on one edge where the laminate has lifted.
        for path, width, t in [([(5,96),(23,83),(40,80),(56,69)], 6, .32),
                               ([(78,39),(92,35),(110,22),(123,21)], 4, .91)]:
            bank, walk = s.path(path)
            span = width * np.sin(np.pi * walk)**.7
            tow = np.sin(1.36*s.y - .92*s.x + .95*s.flake)
            s.impact((abs(bank) < span + s.grit) & (tow + .77*s.flake > -.19),
                     t + .91*abs(bank)/(1+span) + .31*(1-s.flake),
                     mix((47, 50, 50), (143, 145, 131), .43 + .3*tow + .2*s.grain))
            s.impact((bank > span) & (bank < span+1.7) & (span > 1.1),
                     .53 + t, (26, 29, 33))
    elif tag == "grille":
        # In a rolled recess the torn wire curls back from a pinched opening.
        dx, dy = s.u-.43, s.v-.56
        bent = np.hypot(dx/.33, (dy+.44*dx)/.17) + .42*(s.flake-.5)
        mesh = ((s.x + 4*np.floor(s.y/6) + 9*dx) % 9 < 2) | ((s.y - 15*dx**2) % 6 < 2)
        s.impact(bent < 1.13, .30 + 1.64 * bent + .32 * s.grit,
                 mix((15, 19, 23), (127, 127, 114), mesh * (bent > .62) * (.5 + .49*s.grit)))
    elif tag == "plate":
        fold(s, [(4,34),(29,36),(51,47),(72,42),(94,45)], 4, .21)
    elif tag in ("caliper", "silver", "brush"):
        lip = np.exp(-np.maximum(s.edge, 0)/3.9)
        chipped = .46*s.flake + .32*s.grit + .22*s.cloud
        s.impact((chipped + .33*lip > .84) & (lip > .13),
                 .35 + 1.05*(1-lip) + 1.13*(1-chipped), mix(lo, hi, s.grit))
    elif tag == "dash":
        bank, walk = s.path([(8,21),(22,28),(29,39),(43,45),(52,56)])
        s.impact((abs(bank) < 1.28 + .6*s.flake) & (walk > 0) & (walk < 1),
                 .29 + 1.66*walk, mix((22, 26, 31), (113, 107, 94), .53*(bank>0) + .36*s.grain))
    elif tag == "liner":
        scuff = np.hypot((s.u-.63)/.28, (s.v-.68+.25*s.u)/.15)
        s.impact(scuff + .84*(1-s.grain) < 1.21, .63 + 1.62*scuff,
                 mix((43, 41, 39), (115, 107, 91), s.grain))
    dirt = .54*s.cloud + .29*s.flake + .17*s.grit
    edge = np.exp(-np.maximum(s.edge,0)/5)
    if tag in ("plate", "grille", "caliper"):
        aged = mix((67, 47, 37), (158, 95, 55), s.grain)
    elif tag in ("silver", "brush"):
        aged = mix((75, 78, 76), (165, 160, 138), s.grain)
    else:
        aged = mix((61, 61, 55), (134, 128, 108), s.grain)
    s.age(dirt > .63 - .19*edge, 3.33 - 2.72*(dirt-.15) - .64*edge, aged)


def upholstery(s, tag):
    leather = tag == "leather"
    tears = [
            ([(.12,.17),(.18,.31),(.32,.40),(.34,.53)], .048, .08),
            ([(.46,.82),(.58,.73),(.73,.70),(.87,.58)], .064, .35),
            ([(.67,.20),(.76,.24),(.86,.22)], .031, 1.07)]
    if not leather:
        tears = [([(.26,.26),(.35,.43),(.31,.57),(.39,.66)], .049, .34)]
        heel = np.hypot((s.u-.60)/.32, (s.v-.68+.21*s.u)/.21)
        nap = .43*s.flake + .37*s.grit + .20*s.tooth
        s.impact(heel + .87*(1-nap) < 1.28, .48 + 1.26*heel + .55*(1-nap),
                 mix((51, 46, 40), (132, 119, 94), nap))
    for path, breadth, t in tears:
        bank, walk = s.path(np.array(path)*[s.w,s.h])
        taper = np.sin(np.pi*walk)**.72
        span = .30 + breadth*s.h*taper
        cut = (bank + 2.6*(s.flake-.5)) / span
        fibre = np.sin(1.9*s.x + 1.1*s.y + 3*s.flake)
        stitch = (fibre > .86) & (s.flake > .58)
        backing = mix((80, 57, 39), (181, 153, 104), s.grain) if leather else mix((48, 43, 39), (105, 96, 79), s.grain)
        slit = mix(backing, (35, 31, 29), clamp((abs(cut)-.35)*2))
        slit = mix(slit, (170, 151, 118), .77*stitch)
        s.impact((abs(cut)<1) & (taper>0), t + .94*(1-taper) + .57*abs(cut), slit)
        s.impact((cut>1) & (cut<1+1.7/span) & (taper>.18), t + .57 + .54*(1-taper),
                 mix((90, 76, 65), (166, 145, 118), s.grain))
    if leather:
        flex = np.cos(s.y*.52 + s.x*.29 + 5.1*s.cloud + 1.42*s.flake)
        bolster = np.hypot((s.u-.22)/.25, (s.v-.57)/.30)
        s.age((flex > .60 + .15*bolster) & (bolster < 1) & (s.flake > .31),
              .87 + .91*bolster + .61*(1-s.grit), mix((88, 72, 60), (161, 137, 109), s.grain))
    dust = .52*s.cloud + .30*s.flake + .18*s.grit
    s.age(dust > .62, 3.16 - 2.39*(dust-.23),
          mix((86, 82, 70), (153, 145, 121), s.grain))
    moist = .62*s.cloud + .22*s.grit + .16*s.tooth + .11*s.v
    s.age(moist > .69, 3.08 - 2.36*(moist-.23),
          mix((72, 78, 62), (155, 157, 128), .4*s.flake+.6*s.grit))


def generate():
    base = np.asarray(Image.open(TEX / "base.png").convert("RGBA"))
    hurt, decay = np.zeros_like(base), np.zeros_like(base)
    for tag, (col, row, cols, rows) in SWATCH.items():
        if tag == "inside":
            continue
        w, h = 64 * cols, 64 * rows
        area = np.s_[64*row:64*row+h, 64*col:64*col+w]
        s = Swatch(w, h, 4563 + 8*row + col)
        if tag == "paint":
            paint(s)
        elif tag in ("glass", "lamp", "white", "red", "amber", "mirror", "navigation", "screen"):
            glazing(s, tag, base[area][...,3])
        elif tag in ("rubber", "tread"):
            rubber(s, tag)
        elif tag in ("alloy", "disc"):
            round_metal(s, tag)
        elif tag in ("leather", "carpet"):
            upholstery(s, tag)
        else:
            panels(s, tag)
        hurt[area], decay[area] = s.hurt, s.decay
    assert not np.any((hurt[...,3] > 0) & (decay[...,3] > 0))
    for name, pixels in (("hurt", hurt), ("decay", decay)):
        Image.fromarray(pixels).save(TEX / (name + ".png"), optimize=True)


if __name__ == "__main__":
    generate()

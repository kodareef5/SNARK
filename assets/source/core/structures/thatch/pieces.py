# The thatch pieces as geometry, in plain Python: the wall, doorframe, ceiling, door and foundation at four levels.
#
# Axes are the engine's: x along a piece, y up, z out of its front, in metres. Walls and doors are worked out with y
# as height above their foot and lifted to stand about their middle by model.py. The front of a wall faces out.
#
# Level 0 has at most three materials, each named for its pictures under tex/. A piece's own picture covers it whole
# and is laid on in metres on the building grid, so it runs on from piece to piece: "thatch" for walls (its tips cut
# out, and its skirts also make the eaves), "roof" for ceilings, "door", and "floor" and "earth" for foundations.
# "wood" is a trim sheet in bands that every pole wears, with the cord. Levels 1 to 3 have no texture coordinates and
# are drawn in flat colours, a material each, varied bundle by bundle and pole by pole.

import math
import random

from kit import Mesh, Noise1, add, cross, dot, interp, length, lerp, mul, smooth, sub, tube, unit

SPAN = 3.0
H = SPAN / 2
WALL_H = 3.0
FOUND_T = 0.375
FLOOR_T = 0.25
DOOR_W = 1.4
DOOR_H = 2.3125

# Metres a picture spans, by picture.
TILE = {"thatch": 3.0, "roof": 3.0, "door": 3.0, "floor": 3.0, "earth": 1.5, "wood": 1.5}
# Cut out and seen from both sides. A body of thatch is laid on the wall picture only where it is solid, so the tips
# painted on the same picture never hole what lies behind a skirt or under a ceiling.
CUTOUT = {"thatch", "door"}

# Flat colours, each an entry of the palette (shared/pack/palette.ts), so the nearest entry is the colour itself.
GOLD = (196, 156, 88)
GOLD_DEEP = (194, 149, 51)
AMBER = (170, 124, 48)
STRAW = (192, 148, 97)
STRAW_TAN = (176, 130, 81)
STRAW_DARK = (159, 113, 67)
STRAW_DEEP = (120, 83, 50)
TIP = (236, 214, 150)
TIP_PALE = (221, 198, 156)
TIP_WARM = (226, 184, 129)
EARTH = (139, 97, 58)
BARK = (116, 72, 42)

# How each level 0 material looks in Blender without its pictures. The game reads the pictures instead.
FLAT = {"thatch": GOLD, "roof": GOLD, "door": GOLD, "floor": STRAW, "earth": EARTH, "wood": BARK}


def flat(rgb):
    """The material of a flat level drawn in this colour."""
    return "f%02x%02x%02x" % rgb


# The wood trim sheet's bands, as rows of 2048 from the top (tex/wood/BRIEF.md).
WOOD_BANDS = {"bark": (0, 614), "peeled": (614, 1126), "stick": (1126, 1434), "cord": (1434, 1782), "ends": (1782, 2048)}

# Flat colours for the coarser levels: straw from bleached tips to deep hollows, wood from bark to weathered grey.
STRAW_BODY = [GOLD, GOLD, STRAW, AMBER, GOLD_DEEP, STRAW_TAN]
STRAW_TIP = [TIP, TIP_WARM, TIP_PALE]
WOOD = [BARK, (122, 78, 52), (150, 98, 66), (104, 66, 38), STRAW_DEEP, EARTH]
CORD = [(209, 165, 113), (204, 179, 139), STRAW]


def band_v(name):
    """The texture v of a wood band's top and bottom; v grows up the picture."""
    top, bottom = WOOD_BANDS[name]
    return 1 - top / 2048, 1 - bottom / 2048


def hash01(*k):
    """A number in [0, 1) that depends only on its arguments, so a piece built twice comes out the same."""
    return random.Random(repr(k)).random()


# Poles ---------------------------------------------------------------------------------------------------------------


def pole(m, lod, rng, a, b, r0, r1, band="peeled", bow=0.0, bow_dir=(0, 0, 1), caps=("axe", "axe"), segments=None, sides=None, color=None):
    """A hand-cut pole from a to b, radius r0 at a and r1 at b, bowed sideways by `bow` at its middle."""
    n = segments or (5 if lod == 0 else 3 if lod == 1 else 2)
    if length(sub(b, a)) < 0.6 or lod >= 2:
        n = min(n, 2 if lod >= 2 or abs(bow) < 1e-6 else 3)
    sides = sides or (8 if lod == 0 else 5 if lod == 1 else 4)
    path, radii = [], []
    for i in range(n):
        t = i / (n - 1)
        path.append(add(lerp(a, b, t), mul(unit(bow_dir), math.sin(math.pi * t) * bow)))
        radii.append(r0 + (r1 - r0) * t)
    uv = None
    if m.textured:
        v_top, v_bottom = band_v(band)
        uv = (TILE["wood"], v_bottom, v_top - v_bottom)
    mat = "wood" if m.textured else flat(color if color is not None else rng.choice(WOOD))
    first = len(m.faces)
    tube(m, path, radii, sides, mat, rng=rng, rough=0.07 if lod == 0 else 0.0, twist=rng.uniform(0, 6.28), caps=caps if lod < 2 else ("flat", "flat"), uv=uv)
    if m.textured:
        # The cut ends wear one of the six end grain discs, centred 336 pixels apart from (184, 1915), 125 across.
        disc = rng.randrange(6)
        cu, cv, rad = (184 + 336 * disc) / 2048, 1 - 1915 / 2048, 118 / 2048
        axis = unit(sub(b, a))
        e1 = unit(cross(axis, (0, 1, 0) if abs(axis[1]) < 0.9 else (1, 0, 0)))
        e2 = cross(axis, e1)
        for f in range(first, len(m.faces)):
            idx, fm, uvs, sm = m.faces[f]
            if len(idx) != sides:
                continue
            c = [sum(m.points[k][j] for k in idx) / len(idx) for j in range(3)]
            rmax = max(length(sub(m.points[k], c)) for k in idx) or 1
            m.faces[f] = (idx, fm, [(cu + rad * dot(sub(m.points[k], c), e1) / rmax, cv + rad * dot(sub(m.points[k], c), e2) / rmax) for k in idx], sm)
    return path


def lashing(m, lod, rng, centre, axis, radius, width):
    """Turns of cord round a pole: a short fat band. The cord band shows its turns unrolled, each running down the
    band, so u along the pole crosses the turns."""
    if lod >= 2:
        return
    a = unit(axis)
    p0 = add(centre, mul(a, -width / 2))
    p1 = add(centre, mul(a, width / 2))
    uv = None
    if m.textured:
        v_top, v_bottom = band_v("cord")
        uv = (TILE["wood"], v_bottom, v_top - v_bottom)
    mat = "wood" if m.textured else flat(rng.choice(CORD))
    tube(m, [p0, centre, p1], [radius * 0.96, radius * 1.03, radius * 0.96], 7 if lod == 0 else 5, mat, rng=rng, rough=0.05 if lod == 0 else 0.0, twist=rng.uniform(0, 6.28), uv=uv)


# Thatch: a tier of long stems ----------------------------------------------------------------------------------------


class Clumps:
    """Bundles of stems across a run that repeats every SPAN: where each starts, how full it is, how much longer or
    shorter it hangs, and its flat colours."""

    def __init__(self, seed, lo=0.11, hi=0.26, period=SPAN, start=-H, drop=(-0.08, 0.05)):
        rng = random.Random(seed)
        widths = []
        while sum(widths) < period:
            widths.append(rng.uniform(lo, hi))
        k = period / sum(widths)
        widths = [w * k for w in widths]
        offset = rng.uniform(0, widths[0])
        self.period = period
        self.edges = [start + offset]
        for w in widths[:-1]:
            self.edges.append(self.edges[-1] + w)
        self.n = len(widths)
        self.full = [rng.uniform(0.5, 1.0) for _ in widths]
        self.drop = [rng.uniform(*drop) for _ in widths]
        # How deep the V between this bundle and the next opens, as a share of the tier's.
        self.split = [rng.uniform(0.55, 1.35) for _ in widths]
        self.body = [rng.choice(STRAW_BODY) for _ in widths]
        self.tip = [rng.choice(STRAW_TIP) for _ in widths]
        self.seed = seed

    def at(self, x):
        """Which bundle x is in, and how far across it, 0 to 1."""
        x0 = self.edges[0]
        u = (x - x0) % self.period + x0
        for i in range(self.n):
            a = self.edges[i]
            b = self.edges[i + 1] if i + 1 < self.n else x0 + self.period
            if a <= u < b + 1e-9:
                return i, min((u - a) / (b - a), 1.0)
        return self.n - 1, 1.0

    def columns(self, x0, x1, per, stride=1):
        """Points across [x0, x1]: `per` to a bundle with its edges among them, and x0 and x1 themselves. With a
        stride, only every so many bundles' edges."""
        xs = {round(x0, 6), round(x1, 6)}
        for i in range(0, self.n, stride):
            a = self.edges[i]
            b = self.edges[i + 1] if i + 1 < self.n else self.edges[0] + self.period
            for shift in (-self.period, 0.0, self.period):
                for k in range(per):
                    x = a + shift + (b - a) * k / per
                    if x0 + 0.025 < x < x1 - 0.025:
                        xs.add(round(x, 6))
        return sorted(xs)

    def jitter(self, x):
        """How much a point of the foot is out of line, in [-1, 1], the same wherever x recurs."""
        return 2 * hash01(self.seed, round(x % self.period, 4)) - 1


def bump(t):
    return math.sin(math.pi * min(max(t, 0.0), 1.0)) ** 0.6


def foot_y(clumps, x, foot, tuft, jitter, scale=1.0):
    """Where the stems at x end: each bundle hangs to `foot` plus its drop, longest at its middle so the gaps between
    bundles open into a V, and each point a little out of line. `scale` shortens all but `foot`."""
    i, t = clumps.at(x)
    # The V at each edge is as deep as the split of the bundle on that side.
    j = (i + 1) % clumps.n if t > 0.5 else (i - 1) % clumps.n
    split = clumps.split[i] if t > 0.5 else clumps.split[j]
    return foot + scale * (clumps.drop[i] + jitter * clumps.jitter(x) + tuft * split * (1 - bump(t) ** 1.5))


def tier(m, lod, clumps, x0, x1, rows, back_rows, foot, mats, uv, pinch=None, flare=0.035, tuft=0.11, jitter=0.03, back_gap=0.045, uv_back=None, per=None, stride=1, uv_foot=None, scale=1.0, back_floor=None, lean=None):
    """A tier of thatch from x0 to x1: a closed slab whose front swells bundle by bundle and whose foot is ragged.

    `rows` are (y, z, swell) from the top down to where the tips begin; the front at a point is z, plus swell times the
    bundle's fullness and its rounding across. `back_rows` are (y, z) or (y, z, swell), the back swelling the other
    way. Below the last row the stems run on to `foot` plus the bundle's drop, longest at each bundle's middle so the
    gaps between open into a V, flaring out. `mats` are (body, tips) on level 0. `uv` maps a point to its texture
    coordinate. `pinch(x)` scales the front's depth where the thatch is pressed against a post. `per` points to a
    bundle across, and a `stride` over bundles, set how finely it is cut."""
    per = per or (4 if lod == 0 else 2 if lod == 1 else 1)
    xs = clumps.columns(x0, x1, per, stride)
    ncol = len(xs)
    pinch = pinch or (lambda x: 1.0)

    def swell_at(x, s):
        i, t = clumps.at(x)
        return s * clumps.full[i] * bump(t)

    front = []
    for (y, z, swell) in rows:
        front.append([(x, y, (z + swell_at(x, swell)) * pinch(x)) for x in xs])
    last_y, last_z, last_sw = rows[-1]
    tips = []
    for x in xs:
        i, t = clumps.at(x)
        fy = foot_y(clumps, x, foot, tuft, 0.0 if lod >= 2 else jitter, scale)
        tips.append((x, fy, (last_z + flare + last_sw * clumps.full[i] * bump(t) * 0.9) * pinch(x)))
    front.append(tips)
    back = [[(x, r[0], r[1] - (swell_at(x, r[2]) if len(r) > 2 and lod < 2 else 0.0)) for x in xs] for r in back_rows]
    # The back's last row follows the foot, or with `back_floor` (y, z) runs straight along the floor.
    back.append([(p[0], p[1], p[2] - back_gap) if back_floor is None else (p[0], *back_floor) for p in tips])
    nrow, nb = len(front), len(back)
    first = len(m.points)
    fi = [[m.point(p) for p in row] for row in front]
    bi = [[m.point(p) for p in row] for row in back]

    def mat(c, tip):
        if m.textured:
            return mats[1] if tip else mats[0]
        i = clumps.at((xs[c] + xs[c + 1]) / 2)[0]
        return flat(clumps.tip[i] if tip else clumps.body[i])

    def uvs(q, f=uv):
        return [f(m.points[k]) for k in q]

    for r in range(nrow - 1):
        for c in range(ncol - 1):
            q = (fi[r][c], fi[r + 1][c], fi[r + 1][c + 1], fi[r][c + 1])
            m.face(q, mat(c, r == nrow - 2), uvs(q))
    for r in range(nb - 1):
        for c in range(ncol - 1):
            q = (bi[r][c], bi[r][c + 1], bi[r + 1][c + 1], bi[r + 1][c])
            m.face(q, mat(c, r == nb - 2), uvs(q, uv_back or uv))
    for c in range(ncol - 1):
        q = (fi[0][c], fi[0][c + 1], bi[0][c + 1], bi[0][c])
        m.face(q, mat(c, False), uvs(q))
        # The thin underside of the tips lies edge-on in the picture, so it wears a part with nothing drawn: the tips
        # alone make the foot, and it casts no hard shadow.
        q = (fi[nrow - 1][c], bi[nb - 1][c], bi[nb - 1][c + 1], fi[nrow - 1][c + 1])
        m.face(q, mat(c, True), uvs(q, uv_foot or uv))
    for c, flip in ((0, True), (ncol - 1, False)):
        ring = [fi[r][c] for r in range(nrow)] + [bi[r][c] for r in reversed(range(nb))]
        if flip:
            ring = ring[::-1]
        end = mats[0] if m.textured else flat(STRAW_DEEP)
        # A cut end is solid reed all the way down, so it wears the body's picture above where the tips begin.
        m.face(ring, end, [uv((p[0], max(p[1], last_y + 0.03), p[2])) for p in (m.points[k] for k in ring)], False)
    if lean:
        # Below its tie each bundle leans, the more the further down, and the tier's ends stay put so it meets the
        # next. Texture coordinates were laid on before, so the picture leans with the bundles.
        tie, slope = lean
        for k in range(first, len(m.points)):
            x, y, z = m.points[k]
            w = smooth((x - x0) / 0.4) * smooth((x1 - x) / 0.4)
            m.points[k] = (x + slope * max(0.0, tie - y) * w, y, z)
    return xs, front, back


# The wall ------------------------------------------------------------------------------------------------------------

# Heights in metres above the foot of the wall.
UPPER_ROD = 2.62
LOWER_ROD = 1.20
UPPER_FOOT = 1.40
LOWER_FOOT = -0.04
RAILS = (0.16, LOWER_ROD, UPPER_ROD, 2.84)
POST_R = (0.08, 0.068)
# The post at a wall's left end stands proud of the thatch and a little past the end, so at a corner it fills the
# notch the two walls leave.
POST_X = -H - 0.035
POST_Z = 0.10
ROD_R = 0.024
ROD_Z = 0.08
RAIL_R = 0.042
RAIL_Z = -0.064
INNER_Z = -0.082

# How far the bundles of the upper and lower tiers lean, metres across for each metre down from their tie.
LEAN = (0.09, 0.07)
UPPER = Clumps("upper", lo=0.15, hi=0.32)
LOWER = Clumps("lower", lo=0.16, hi=0.34, drop=(-0.06, 0.05))


def upper_rows(lod):
    """The upper tier's rows: tied flat under the rod, then each bundle bellies out to its tips."""
    rows = [(2.985, 0.030, 0.006), (2.80, 0.036, 0.018), (UPPER_ROD, 0.042, 0.006), (2.40, 0.050, 0.05), (2.05, 0.058, 0.08), (1.80, 0.064, 0.088), (1.66, 0.066, 0.085)]
    # Inside, the backs of the bundles belly too, and the upper ones lap over the lower tier's heads.
    back = [(2.985, -0.022), (2.50, -0.026, 0.02), (2.10, -0.030, 0.045), (1.86, -0.026, 0.035), (1.72, 0.030), (1.66, 0.044)]
    if lod == 1:
        rows = [rows[0], rows[2], rows[4], rows[6]]
        back = [back[0], back[2], back[5]]
    if lod >= 2:
        rows = [rows[0], rows[2], rows[6]]
        back = [back[0], back[5]]
    return rows, back


def lower_rows(lod):
    top, rod, tips = (1.82, 0.024, 0.004), (LOWER_ROD, 0.040, 0.006), (0.24, 0.062, 0.085)
    # A row where the picture stops being drawn out, on the line between its neighbours.
    k = (top[0] - LOWER_TOP) / (top[0] - rod[0])
    cut = (LOWER_TOP, top[1] + k * (rod[1] - top[1]), top[2] + k * (rod[2] - top[2]))
    rows = [top, cut, rod, (0.98, 0.046, 0.05), (0.62, 0.054, 0.08), (0.36, 0.060, 0.088), tips]
    back = [(1.82, -0.022), (1.55, -0.03, 0.03), (0.80, -0.030, 0.045), (0.35, -0.026, 0.035), (0.24, -0.022)]
    if lod == 1:
        rows = [top, rod, rows[4], tips]
        back = [back[0], back[2], back[4]]
    if lod >= 2:
        rows = [top, rod, tips]
        back = [back[0], back[4]]
    return rows, back


# The wall picture covers a wall from WALL_V0 below its foot, so the lower tier's tips, which hang a little below the
# floor, fall inside it. The top of the wall, under the ceiling, wraps round to the bottom of the picture.
WALL_V0 = -0.15


def wall_v(y):
    return (y - WALL_V0) / TILE["thatch"]


def wall_uv(shift=0.0, top=WALL_V0 + TILE["thatch"] - 0.005):
    """The wall picture laid on in metres: u across, v up, one picture a 3 m wall. `shift` moves a short tier's
    picture down so its foot wears the picture of the upper tier's foot. Above `top` the picture's row there is drawn
    out: the cut top of the wall under the ceiling does not wrap round to the tips at the bottom, and the lower tier
    behind the upper skirt does not wear the skirt's tips."""
    t = TILE["thatch"]
    return lambda p: ((p[0] + H) / t, wall_v(min(p[1] - shift, top)))


# Below the lowest the upper skirt's tips reach, the picture is the lower tier's alone.
LOWER_TOP = 1.28


def wall_bare(p):
    """A part of the wall picture where nothing is drawn: below the lower tier's tips."""
    return ((p[0] + H) / TILE["thatch"], wall_v(WALL_V0 + 0.005))


def post_pinch(x):
    d = min(abs(x + H), abs(x - H))
    return 0.5 + 0.5 * smooth(d / 0.18)


def wall_tiers(m, lod, spans):
    ur, ub = upper_rows(lod)
    lr, lb = lower_rows(lod)
    mats = ("thatch", "thatch")
    lower_uv = wall_uv(top=LOWER_TOP)
    # Inside, the lower tier's back is solid down to the floor, so no light shows under the wall, and it wears the
    # lower tier's body squeezed to fit, clear of the tips at either end.
    inner_uv = lambda p: lower_uv((p[0], 0.40 + (min(max(p[1], -0.03), 1.82) + 0.03) * 0.85 / 1.85, p[2]))  # noqa: E731
    for x0, x1, pinch in spans:
        tier(m, lod, LOWER, x0, x1, lr, lb, LOWER_FOOT, mats, lower_uv, pinch=pinch, flare=0.05, tuft=0.10, uv_foot=wall_bare,
             uv_back=inner_uv, back_floor=(-0.03, -0.022), lean=(LOWER_ROD, LEAN[1]))
        tier(m, lod, UPPER, x0, x1, ur, ub, UPPER_FOOT, mats, wall_uv(), pinch=pinch, flare=0.06, tuft=0.13, uv_foot=wall_bare,
             lean=(UPPER_ROD, LEAN[0]))


def rods(m, lod, rng, x0, x1, heights):
    for y in heights:
        sag = rng.uniform(0.008, 0.016)
        pole(m, lod, rng, (x0, y, ROD_Z), (x1, y + rng.uniform(-0.012, 0.012), ROD_Z + 0.004), ROD_R, ROD_R * 0.82, band="stick", bow=sag, bow_dir=(0, -1, 0.15), segments=5)
        n = max(1, int(round((x1 - x0) / 1.0)))
        for k in range(n):
            x = x0 + (x1 - x0) * (k + 0.5) / n + rng.uniform(-0.08, 0.08)
            lashing(m, lod, rng, (x, y - sag * 0.9, ROD_Z), (1, 0.02, 0), ROD_R + 0.009, 0.045)


def rails(m, lod, rng, x0, x1, heights):
    if lod >= 2:
        return
    for y in heights:
        pole(m, lod, rng, (x0, y, RAIL_Z), (x1, y + rng.uniform(-0.008, 0.008), RAIL_Z), RAIL_R, RAIL_R * 0.9, band="peeled", bow=rng.uniform(0.004, 0.01), bow_dir=(0, 0, -1), caps=("flat", "flat"), segments=4)
        if y in (LOWER_ROD, UPPER_ROD):
            # Where the rod outside is tied through the thatch to the rail inside.
            n = max(1, int(round((x1 - x0) / 0.75)))
            for k in range(n):
                x = x0 + (x1 - x0) * (k + 0.5) / n + rng.uniform(-0.06, 0.06)
                lashing(m, lod, rng, (x, y, RAIL_Z), (1, 0.03, 0), RAIL_R + 0.008, 0.04)


def corner_post(m, lod, rng):
    """The post at the wall's left end, proud of the thatch outside, and a lighter one inside that the rails meet."""
    pole(m, lod, rng, (POST_X, -0.02, POST_Z), (POST_X + 0.008, 2.94, POST_Z - 0.006), POST_R[0], POST_R[1], band="bark", bow=0.014, bow_dir=(0.3, 0, 1), caps=("flat", "axe"), segments=6)
    for y in (UPPER_ROD, LOWER_ROD):
        lashing(m, lod, rng, (POST_X + 0.004, y + 0.012, POST_Z), (0.06, 1, 0), POST_R[1] + 0.012, 0.09)
    if lod < 2:
        pole(m, lod, rng, (-H + 0.03, -0.01, INNER_Z), (-H + 0.036, 2.95, INNER_Z), 0.058, 0.05, band="bark", bow=0.01, bow_dir=(1, 0, -0.4), caps=("flat", "axe"), segments=5)
        for y in (LOWER_ROD, UPPER_ROD):
            lashing(m, lod, rng, (-H + 0.033, y, INNER_Z), (0.002, 1, 0), 0.064, 0.08)


def wall(lod):
    rng = random.Random("wall%d" % lod)
    m = Mesh(lod == 0)
    if lod == 3:
        box(m, (-H, LOWER_FOOT, -0.1), (H, WALL_H, 0.13), flat(GOLD))
        box(m, (POST_X - 0.07, 0, POST_Z - 0.07), (POST_X + 0.07, WALL_H - 0.01, POST_Z + 0.07), flat(BARK))
        return m
    wall_tiers(m, lod, [(-H, H, post_pinch)])
    corner_post(m, lod, rng)
    rods(m, lod, rng, -H, H, (UPPER_ROD, LOWER_ROD))
    rails(m, lod, rng, -H, H, RAILS)
    return m


# The doorframe -------------------------------------------------------------------------------------------------------

JAMB_R = 0.075
JAMB_X = DOOR_W / 2 + JAMB_R + 0.002
JAMB_Z = 0.03
LINTEL_R = 0.07
LINTEL_Y = DOOR_H + LINTEL_R + 0.004
LINTEL_Z = 0.05
OVER_FOOT = DOOR_H + 0.09


def doorframe(lod):
    rng = random.Random("doorframe%d" % lod)
    m = Mesh(lod == 0)
    if lod == 3:
        box(m, (-H, LOWER_FOOT, -0.1), (-DOOR_W / 2, WALL_H, 0.13), flat(GOLD))
        box(m, (DOOR_W / 2, LOWER_FOOT, -0.1), (H, WALL_H, 0.13), flat(GOLD))
        box(m, (-DOOR_W / 2, DOOR_H, -0.1), (DOOR_W / 2, WALL_H, 0.13), flat(GOLD))
        return m
    edge = JAMB_X - 0.03

    def side_pinch(x):
        d = min(abs(x + H), abs(x - H), abs(abs(x) - JAMB_X))
        return 0.5 + 0.5 * smooth(d / 0.16)

    wall_tiers(m, lod, [(-H, -edge, side_pinch), (edge, H, side_pinch)])
    # Over the doorway: the upper tier alone, cut short, its foot hanging just over the lintel. Its picture is moved
    # down so that its foot wears the upper tier's foot.
    ur, ub = upper_rows(lod)
    shift = OVER_FOOT - UPPER_FOOT
    rows = [(y, z, sw) for (y, z, sw) in ur if y > OVER_FOOT + 0.3] + [(OVER_FOOT + 0.26, ur[-1][1], ur[-1][2])]
    back = [(ub[0][0], ub[0][1]), (OVER_FOOT + 0.26, 0.044)]
    tier(m, lod, UPPER, -edge - 0.04, edge + 0.04, rows, back, OVER_FOOT, ("thatch", "thatch"), wall_uv(shift), pinch=side_pinch, flare=0.05, tuft=0.13, uv_foot=wall_bare, lean=(UPPER_ROD, LEAN[0]))
    corner_post(m, lod, rng)
    for s in (-1, 1):
        x = s * JAMB_X
        pole(m, lod, rng, (x, -0.01, JAMB_Z), (x + s * 0.006, 2.94, JAMB_Z), JAMB_R, JAMB_R * 0.9, band="bark", bow=0.008, bow_dir=(s, 0, 0.5), caps=("flat", "axe"), segments=5)
        # A second, thinner pole beside each jamb, as the doorway is built doubled.
        x2 = s * (JAMB_X + JAMB_R + 0.04)
        pole(m, lod, rng, (x2, -0.01, JAMB_Z + 0.03), (x2 - s * 0.01, 2.6, JAMB_Z + 0.03), 0.042, 0.036, band="stick", bow=0.01, bow_dir=(s, 0, 1), caps=("flat", "axe"), segments=4)
        lashing(m, lod, rng, (x + s * 0.004, LINTEL_Y, JAMB_Z), (0.02 * s, 1, 0), JAMB_R * 0.95 + 0.01, 0.16)
        inner = JAMB_X + 0.07
        rods(m, lod, rng, *((-H, -inner) if s < 0 else (inner, H)), (UPPER_ROD, LOWER_ROD))
        rails(m, lod, rng, *((-H, -JAMB_X) if s < 0 else (JAMB_X, H)), RAILS[:3])
    pole(m, lod, rng, (-JAMB_X - 0.22, LINTEL_Y + 0.01, LINTEL_Z), (JAMB_X + 0.2, LINTEL_Y - 0.008, LINTEL_Z), LINTEL_R, LINTEL_R * 0.88, band="bark", bow=0.012, bow_dir=(0, 1, 0), segments=5)
    rails(m, lod, rng, -H, H, RAILS[3:])
    return m


# The door ------------------------------------------------------------------------------------------------------------

D_STILE = DOOR_W / 2 - 0.045
D_FRAME_Z = 0.022
D_FRAME_R = 0.028


def door_uv(front):
    """The door picture holds the outside face on its left half and the inside face on its right."""
    t = TILE["door"]
    if front:
        return lambda p: ((p[0] + DOOR_W / 2 + 0.05) / t, (p[1] + 0.3) / t)
    return lambda p: ((DOOR_W / 2 - p[0] + 1.55) / t, (p[1] + 0.3) / t)


DOOR_REEDS = Clumps("door", lo=0.07, hi=0.13, period=DOOR_W, start=-DOOR_W / 2, drop=(0.0, 0.02))


def door(lod, opened=False):
    rng = random.Random("door%d" % lod)
    m = Mesh(lod == 0)
    if lod == 3:
        box(m, (-DOOR_W / 2, 0.01, -0.035), (DOOR_W / 2, DOOR_H - 0.01, 0.045), flat(GOLD))
    else:
        # The reed infill: a mat of vertical reeds, short ragged ends top and bottom.
        x0, x1 = -DOOR_W / 2 + 0.02, DOOR_W / 2 - 0.02
        rows = [(DOOR_H - 0.03, 0.006, 0.004), (DOOR_H - 0.12, 0.008, 0.008), (1.2, 0.010, 0.010), (0.12, 0.010, 0.010)]
        if lod >= 1:
            rows = [rows[0], rows[1], rows[3]]
        back = [(DOOR_H - 0.03, -0.03), (0.12, -0.03)]
        tier(m, lod, DOOR_REEDS, x0, x1, rows, back, 0.03, ("door", "door"), door_uv(True), flare=0.006, tuft=0.025, jitter=0.01, back_gap=0.03, uv_back=door_uv(False), uv_foot=lambda p: (0.5, 0.02))
        # The frame on the outside face: two stiles, three rails, and a brace from the hinge side's foot up.
        for s in (-1, 1):
            pole(m, lod, rng, (s * D_STILE, 0.02, D_FRAME_Z), (s * D_STILE, DOOR_H - 0.02, D_FRAME_Z), D_FRAME_R, D_FRAME_R * 0.9, band="stick", caps=("axe", "axe"), segments=4)
        for y in (0.11, 1.18, DOOR_H - 0.11):
            pole(m, lod, rng, (-DOOR_W / 2 + 0.01, y, D_FRAME_Z + 0.008), (DOOR_W / 2 - 0.01, y + rng.uniform(-0.01, 0.01), D_FRAME_Z + 0.008), D_FRAME_R * 0.92, D_FRAME_R * 0.85, band="stick", segments=4)
        pole(m, lod, rng, (-D_STILE + 0.04, 0.16, D_FRAME_Z + 0.004), (D_STILE - 0.05, DOOR_H - 0.17, D_FRAME_Z + 0.004), 0.024, 0.022, band="stick", segments=3)
        for x in (-D_STILE, D_STILE):
            for y in (0.11, 1.18, DOOR_H - 0.11):
                lashing(m, lod, rng, (x - 0.045 * (1 if x > 0 else -1), y, D_FRAME_Z + 0.008), (1, 0, 0), D_FRAME_R + 0.006, 0.04)
        # Cord loops on the hinge side, and a loop of cord to pull it by.
        for y in (0.42, DOOR_H - 0.42):
            lashing(m, lod, rng, (-D_STILE, y, D_FRAME_Z), (0, 1, 0), D_FRAME_R + 0.012, 0.06)
        lashing(m, lod, rng, (D_STILE, 1.05, D_FRAME_Z), (0, 1, 0), D_FRAME_R + 0.01, 0.09)
        # Inside, two battens across the reeds where the picture has them twined, tied through to the frame.
        for y in (0.48, 1.67):
            pole(m, lod, rng, (-D_STILE + 0.03, y, -0.046), (D_STILE - 0.03, y + rng.uniform(-0.01, 0.01), -0.046), 0.018, 0.016, band="stick", segments=3)
            for x in (-D_STILE + 0.08, 0.0, D_STILE - 0.08):
                lashing(m, lod, rng, (x + rng.uniform(-0.03, 0.03), y, -0.046), (1, 0, 0), 0.026, 0.03)
    if opened:
        m.points = [(-DOOR_W / 2 - p[2], p[1], p[0] + DOOR_W / 2) for p in m.points]
    return m


def door_open(lod):
    return door(lod, True)


# The ceiling ---------------------------------------------------------------------------------------------------------

C_TOP = FLOOR_T / 2
JOIST_R = 0.05
JOIST_Y = -C_TOP + JOIST_R
JOISTS = (-1.25, -0.75, -0.25, 0.25, 0.75, 1.25)
MAT_Y = -C_TOP + 2 * JOIST_R - 0.005
EAVE = 0.29
ROOF = Clumps("roof", lo=0.12, hi=0.24)


def roof_uv(p):
    t = TILE["roof"]
    return ((p[0] + H) / t, (p[2] + H) / t)


def eave(m, lod, side):
    """The thatch along one edge of a ceiling: the wall's upper skirt turned to reach out over the edge and droop,
    wearing the wall picture's skirt, so eaves and walls are one thatch. `side` is 0 to 3 for +z, +x, -z, -x.

    It is worked out as a tier hanging down its own y, with reach past the edge as -y and height as z, then turned:
    a tier's (x, y, z) is the ceiling's (x, z, ROOT - y) for the +z edge."""
    turn = side * math.pi / 2
    c, s = math.cos(turn), math.sin(turn)
    root = H - 0.06
    # A solid body of reed out to BODY, then the skirt's tips shortened to fit the rest of the reach. The eave stays
    # under the top, which is a floor; where two ceilings meet it lies inside the other but for its tips, which hang a
    # few centimetres below the other's mat.
    body, tips_top = 0.14, 1.66
    k = (EAVE - body) / (tips_top - UPPER_FOOT)
    rows = [(0.0, C_TOP - 0.012, 0.004), (-0.07, C_TOP - 0.04, 0.016), (-body, C_TOP - 0.10, 0.026)]
    back = [(0.0, MAT_Y + 0.02), (-body, MAT_Y - 0.03)]
    if lod >= 1:
        rows = [rows[0], rows[2]]

    def uv(q):
        r = q[1]
        y = tips_top + (r + body) if r >= -body else tips_top + (r + body) / k
        return ((q[0] + H) / TILE["thatch"], wall_v(y))

    local = Mesh(m.textured)
    tier(local, lod, UPPER, -H - 0.75 * EAVE, H + 0.75 * EAVE, rows, back, -EAVE, ("thatch", "thatch"), uv, flare=-0.14, tuft=0.13,
         back_gap=0.04, per=3 if lod == 0 else 1, stride=1 if lod < 2 else 2, uv_foot=wall_bare, scale=k)
    # How far the eave's top has dropped at each reach past the edge, out to its tips.
    reach = [0.0, 0.07, body, EAVE]
    drop = [0.0, 0.028, 0.088, 0.21]
    base = len(m.points)
    for (x, y, z) in local.points:
        # Past the panel's corners the eave reaches less far, so where two meet the corner is rounded, and it bends
        # down as the eave it runs into does, so its end does not stand above that one.
        past = max(0.0, abs(x) - H)
        y *= 1.0 - 0.95 * smooth(past / (0.75 * EAVE))
        z -= interp(past, reach, drop)
        zz = root - y
        m.points.append((x * c + zz * s, z, -x * s + zz * c))
    for idx, mat, uvs, sm in local.faces:
        m.face([base + k for k in idx], mat, uvs, sm)


def ceiling(lod):
    rng = random.Random("ceiling%d" % lod)
    m = Mesh(lod == 0)
    if lod == 3:
        box(m, (-H, -C_TOP, -H), (H, C_TOP, H), flat(GOLD))
        return m
    # The body: the thatch between the mat over the joists and the top. The top is laid in courses half a metre
    # wide, each a centimetre thicker at its butts than where the next covers it, so from above it shows its rows.
    # The tile's edges fall mid-course, so ceilings side by side meet level.
    zs, heights = [], []
    for k in range(6):
        b = -1.25 + 0.5 * k
        steps = [(0.0, 0.0), (0.06, 0.004), (0.47, 0.013)] if lod == 0 else [(0.0, 0.0), (0.47, 0.012)] if lod == 1 else [(0.0, 0.006)]
        for d, drop in steps:
            zs.append(b + d)
            heights.append(C_TOP - 0.002 - drop)
    # The tile's own edges, mid-course.
    zs = [-H] + zs + [H]
    heights = [C_TOP - 0.008] + heights + [C_TOP - 0.008]
    pairs = sorted((z, h) for z, h in zip(zs, heights) if -H <= z <= H)
    zs = [z for z, _ in pairs]
    heights = [h for _, h in pairs]
    nx = 7 if lod == 0 else 4 if lod == 1 else 2
    xs = [-H + SPAN * j / (nx - 1) for j in range(nx)]
    wave = Noise1(random.Random("roof wave"), 0.5, SPAN)
    top = [[(x, h - (0.004 * (1 + wave(x + 3 * z)) if lod == 0 else 0.0), z) for x in xs] for z, h in zip(zs, heights)]
    under = [[(x, MAT_Y, z) for x in xs] for z in zs]
    n = len(zs)
    ti = [[m.point(p) for p in r] for r in top]
    ui = [[m.point(p) for p in r] for r in under]
    tm = "roof" if m.textured else flat(GOLD)
    um = "roof" if m.textured else flat(STRAW_DARK)
    for i in range(n - 1):
        for j in range(nx - 1):
            q = (ti[i][j], ti[i + 1][j], ti[i + 1][j + 1], ti[i][j + 1])
            # On flat levels the short step where a course ends reads as a binding line.
            step = zs[i + 1] - zs[i] < 0.05
            m.face(q, tm if m.textured else flat(STRAW_DARK if step else GOLD), [roof_uv(m.points[k]) for k in q])
            q = (ui[i][j], ui[i][j + 1], ui[i + 1][j + 1], ui[i + 1][j])
            m.face(q, um, [roof_uv(m.points[k]) for k in q])
    for j in range(nx - 1):
        for q in ((ti[0][j], ti[0][j + 1], ui[0][j + 1], ui[0][j]), (ti[n - 1][j + 1], ti[n - 1][j], ui[n - 1][j], ui[n - 1][j + 1])):
            m.face(q, tm, [roof_uv(m.points[k]) for k in q])
    for i in range(n - 1):
        for q in ((ti[i + 1][0], ti[i][0], ui[i][0], ui[i + 1][0]), (ti[i][nx - 1], ti[i + 1][nx - 1], ui[i + 1][nx - 1], ui[i][nx - 1])):
            m.face(q, tm, [roof_uv(m.points[k]) for k in q])
    for side in range(4):
        eave(m, lod, side)
    # The joists under the mat, their ends showing past two edges, and the edge beams along the other two.
    sides = 6 if lod == 0 else 4
    for z in JOISTS if lod < 2 else (-1.0, 0.0, 1.0):
        pole(m, lod, rng, (-H - 0.12, JOIST_Y + rng.uniform(-0.004, 0.004), z + rng.uniform(-0.02, 0.02)), (H + 0.12, JOIST_Y, z), JOIST_R, JOIST_R * 0.88, band="bark", bow=0.01, bow_dir=(0, 1, 0), caps=("axe", "axe"), segments=5 if lod == 0 else 3, sides=sides)
    for s in (-1, 1) if lod < 2 else ():
        pole(m, lod, rng, (-H + 0.06, JOIST_Y - 0.002, s * (H - 0.06)), (H - 0.06, JOIST_Y, s * (H - 0.06)), 0.055, 0.05, band="bark", caps=("flat", "flat"), segments=4 if lod == 0 else 2, sides=sides)
    return m


# The foundation ------------------------------------------------------------------------------------------------------

F_TOP = FOUND_T / 2
LOG_R = 0.075
LOG_IN = H - LOG_R - 0.005
TOP_LOG_Y = F_TOP - LOG_R - 0.012
LOW_LOG_Y = -F_TOP + LOG_R


def floor_uv(p):
    t = TILE["floor"]
    return ((p[0] + H) / t, (p[2] + H) / t)


def earth_uv(p):
    t = TILE["earth"]
    side = abs(p[0]) > abs(p[2])
    return (((p[2] if side else p[0]) + H) / t, (p[1] + F_TOP) / t)


def foundation(lod):
    rng = random.Random("foundation%d" % lod)
    m = Mesh(lod == 0)
    if lod == 3:
        box(m, (-H, -F_TOP, -H), (H, F_TOP, H), flat(EARTH))
        return m
    # The floor and the packed earth under it: one closed block, its sides set in behind the logs.
    inset = H - 0.025
    lo_y, hi_y = -F_TOP + 0.01, F_TOP
    corners = [(-inset, -inset), (inset, -inset), (inset, inset), (-inset, inset)]
    top_r = [m.point((x, hi_y, z)) for x, z in [(-H, -H), (H, -H), (H, H), (-H, H)]]
    mid_r = [m.point((x, TOP_LOG_Y, z)) for x, z in corners]
    low_r = [m.point((x, lo_y, z)) for x, z in corners]
    fm = "floor" if m.textured else flat(STRAW)
    em = "earth" if m.textured else flat(EARTH)
    q = (top_r[0], top_r[3], top_r[2], top_r[1])
    m.face(q, fm, [floor_uv(m.points[k]) for k in q], False)
    q = (low_r[0], low_r[1], low_r[2], low_r[3])
    m.face(q, em, [earth_uv(m.points[k]) for k in q], False)
    for k in range(4):
        a, b = k, (k + 1) % 4
        q = (top_r[a], top_r[b], mid_r[b], mid_r[a])
        m.face(q, fm, [floor_uv(m.points[k2]) for k2 in q], False)
        q = (mid_r[a], mid_r[b], low_r[b], low_r[a])
        m.face(q, em, [earth_uv(m.points[k2]) for k2 in q], False)
    # Two logs a side, crossing at the corners like a crib, the top ones running past their ends.
    for layer, y in enumerate((LOW_LOG_Y, TOP_LOG_Y)):
        for axis in (0, 1):
            reach = H + (0.11 if (layer + axis) % 2 == 0 else -0.02)
            for s in (-1, 1):
                c = s * LOG_IN
                r0 = LOG_R + rng.uniform(-0.006, 0.004)
                r1 = LOG_R + rng.uniform(-0.012, 0.0)
                a, b = ((-reach, y, c), (reach, y, c)) if axis == 0 else ((c, y, -reach), (c, y, reach))
                pole(m, lod, rng, a, b, r0, r1, band="bark", bow=0.012 if lod == 0 else 0.0, bow_dir=(0, -1, 0), caps=("axe", "axe"), segments=5)
    # Stakes driven in outside the logs and lashed to both: a stout one at the corner each side starts from, going
    # round, and two lighter ones along it.
    for side in range(4):
        a = math.pi / 2 * side
        start = (-H * math.cos(a) + H * math.sin(a), -H * math.cos(a) - H * math.sin(a))
        along = (math.cos(a), math.sin(a))
        out = (along[1], -along[0])
        for d, r in ((0.05, 0.056), (1.0 + rng.uniform(-0.08, 0.08), 0.044), (2.0 + rng.uniform(-0.08, 0.08), 0.044)):
            x = start[0] + along[0] * d + out[0] * (r - 0.012)
            z = start[1] + along[1] * d + out[1] * (r - 0.012)
            top = F_TOP - 0.05 if r > 0.05 else TOP_LOG_Y + LOG_R * 0.7
            pole(m, lod, rng, (x, -F_TOP - 0.02, z), (x + rng.uniform(-0.01, 0.01), top, z), r, r * 0.9, band="bark", caps=("flat", "axe"), segments=2, sides=7 if lod == 0 else None)
            for y in (TOP_LOG_Y, LOW_LOG_Y):
                lashing(m, lod, rng, (x, y, z), (0, 1, 0), r + 0.012, 0.07)
    return m


def box(m, lo, hi, mat):
    pts = [(x, y, z) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
    idx = [m.point(p) for p in pts]
    # Corner index is x*4 + y*2 + z; each face wound to face out.
    for f in [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]:
        m.face([idx[k] for k in f], mat, None, False)


PIECES = [
    # Blender object, builder, how far its foot sits below its middle.
    ("foundation", foundation, 0.0),
    ("wall", wall, WALL_H / 2),
    ("doorframe", doorframe, WALL_H / 2),
    ("ceiling", ceiling, 0.0),
    ("door", door, DOOR_H / 2),
    ("door_open", door_open, DOOR_H / 2),
]

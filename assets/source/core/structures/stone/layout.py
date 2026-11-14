# The two laid patterns of the stone tier, in metres on the building grid. The
# Blender script cuts its stones from them and the textures are painted to
# them, so a joint in the geometry is a joint in the picture.
#
# Both tile every 3 m, one building span. u runs right across a face as it is
# seen and v runs down from its top edge: a picture's first row is v = 0.

import math
import random
import zlib

TILE = 3.0

# Masonry, the face of a wall. Eight courses between these bed joints, top
# first. The door's head, the window's head and the window's sill each fall on
# one, so the openings cut the pattern along joints that are already there.
BEDS = (0.0, 0.35, 0.6875, 1.1, 1.45, 1.8, 2.2, 2.6, 3.0)

# The head joints of each course, top course first, metres from the face's left
# edge. A pair is a joint that leans: where it meets the bed above, and below.
# A course wraps: its last stone runs on past 3 m into the next span.
HEADS = (
    (0.154, (0.571, 0.588), (1.466, 1.449), 2.15, 2.444),
    (0.40, (1.236, 1.252), (1.975, 1.958), 2.60),
    (0.53, 2.46),
    (0.40, (1.012, 1.028), (2.03, 2.015), 2.59),
    (0.55, 1.593, 2.47),
    (0.25, (0.792, 0.778), 1.33, (1.868, 1.884), 2.70),
    (0.50, (1.082, 1.097), 1.50, 2.124, 2.52),
    (0.30, (0.90, 0.884), (1.716, 1.731), 2.75),
)

# Stones laid two to a course: (course, the head joint the stone starts at, v of
# the bed between the two). Some halves are thin pinnings.
STACKED = ((0, 2.15, 0.17), (6, 1.50, 2.39), (1, 0.40, 0.47), (3, 2.03, 1.25), (4, 0.55, 1.62), (7, 0.90, 2.86), (5, 0.25, 1.95))

# Stones that stand two courses tall: (course, the head joint it starts at). The
# course below is cut back round it.
JUMPERS = ((5, 1.33),)

# Between two of its head joints one course is laid as two thin courses, each
# with head joints of its own: (course, from, to, v of the bed between, the
# upper's head joints, the lower's). Over a window the lower one is the lintel.
SPLIT = (2, 0.53, 2.46, 0.85, (1.443,), (1.266, 1.859))

# Where a door or a window cuts the courses. The jambs' outer joints are head
# joints above, so jamb stones and lintels are whole stones of the pattern.
# "open" is the opening's left and right edge; each jamb or lintel is (course,
# left joint, right joint); "sill" is the v the window's sill stands on.
DOOR = {"open": (0.8, 2.2), "jambs": tuple((k, HEADS[k][0], HEADS[k][-1]) for k in range(2, 8)), "lintel": (1, 0.40, 2.60)}
WINDOW = {"open": (0.9, 2.1), "jambs": ((3, 0.40, 2.59), (4, 0.55, 2.47)), "lintel": (2, 0.53, 2.46), "sill": 1.8}

# How a stone sits in its cell. Each corner is drawn in from the joint lines by
# its own amount, so joints run 12 to 44 mm wide and no bed is ruler-straight,
# then broken off, and one corner in a few is broken back hard. The mortar lies
# this deep behind the wall's face. A stone's sides rise steeply from it by
# RISE over BEVEL, and its face swells from there to a crown CROWN higher, off
# its middle, so each stone is a lump of rock and not a slab.
GAP = (0.006, 0.022)
CHIP = (0.012, 0.05)
BREAK = (0.05, 0.09)
MORTAR_DEPTH = 0.04
RISE = (0.02, 0.04)
BEVEL = (0.014, 0.03)
CROWN = (0.016, 0.034)

# Flagstones, the top of a foundation or a ceiling. u runs along x and v along
# z. Joints run along all four edges, so a floor turned any way against its
# neighbour still meets it at a joint.
FLAG_ROWS = (0.0, 0.75, 1.35, 2.2, 3.0)
FLAG_JOINTS = ((0.539, 1.154, 1.894), (0.872, 1.457, 2.193), (1.061, 1.934), (0.696, 1.636, 2.268))
FLAG_GAP = (0.004, 0.012)
FLAG_CHIP = (0.008, 0.03)
FLAG_DEPTH = 0.008
FLAG_BEVEL = (0.008, 0.016)


def _rng(*key):
    return random.Random(zlib.crc32("/".join(str(k) for k in key).encode()))


def _top(j):
    return j[0] if isinstance(j, tuple) else j


def _bottom(j):
    return j[1] if isinstance(j, tuple) else j


def _band(quad, va, vb):
    """The part of a quad between two heights."""
    (ua, v0), (ub, _), (ud, v1), (uc, _) = quad

    def at(top, bottom, v):
        return top + (bottom - top) * (v - v0) / (v1 - v0)

    return [(at(ua, uc, va), va), (at(ub, ud, va), va), (at(ub, ud, vb), vb), (at(ua, uc, vb), vb)]


def masonry():
    """The stones of one span of wall face. Each is a dict: its course, a name, and its corners (u, v) in the order
    top left, top right, bottom right, bottom left. A stone that wraps runs past u = 3."""
    stones = []
    for k, heads in enumerate(HEADS):
        v0, v1 = BEDS[k], BEDS[k + 1]
        n = len(heads)
        for i in range(n):
            a, b = heads[i], heads[(i + 1) % n]
            shift = TILE if i == n - 1 else 0.0
            quad = [(_top(a), v0), (_top(b) + shift, v0), (_bottom(b) + shift, v1), (_bottom(a), v1)]
            name = f"k{k}s{i}"
            if k == SPLIT[0] and abs(_top(a) - SPLIT[1]) < 1e-9 and abs(_top(b) - SPLIT[2]) < 1e-9:
                vm = SPLIT[3]
                for band, va, vb, inner in (("u", v0, vm, SPLIT[4]), ("l", vm, v1, SPLIT[5])):
                    edges = (SPLIT[1], *inner, SPLIT[2])
                    for j in range(len(edges) - 1):
                        q = [(edges[j], va), (edges[j + 1], va), (edges[j + 1], vb), (edges[j], vb)]
                        stones.append({"course": k, "band": band, "name": f"{name}{band}{j}", "quad": q})
                continue
            stack = [s[2] for s in STACKED if s[0] == k and abs(s[1] - _top(a)) < 1e-9]
            if stack:
                stones.append({"course": k, "name": name + "a", "quad": _band(quad, v0, stack[0])})
                stones.append({"course": k, "name": name + "b", "quad": _band(quad, stack[0], v1)})
                continue
            stones.append({"course": k, "name": name, "quad": quad})
    for k, start in JUMPERS:
        jumper = next(s for s in stones if s["course"] == k and abs(s["quad"][0][0] - start) < 1e-9)
        (tl, tr, br, bl) = jumper["quad"]
        v2 = BEDS[k + 2]

        def side(top, bottom, v):
            return top[0] + (bottom[0] - top[0]) * (v - top[1]) / (bottom[1] - top[1])

        left = lambda v, tl=tl, bl=bl: side(tl, bl, v)  # noqa: E731
        right = lambda v, tr=tr, br=br: side(tr, br, v)  # noqa: E731
        jumper["quad"] = [tl, tr, (right(v2), v2), (left(v2), v2)]
        jumper["name"] += "j"
        kept = []
        for s in stones:
            q = s["quad"]
            if s["course"] != k + 1:
                kept.append(s)
                continue
            x0, x1 = min(p[0] for p in q), max(p[0] for p in q)
            a, b = left(q[0][1]), right(q[0][1])
            if x1 <= a + 1e-6 or x0 >= b - 1e-6:
                kept.append(s)
            elif x0 < a:
                kept.append({**s, "quad": [q[0], (left(q[1][1]), q[1][1]), (left(q[2][1]), q[2][1]), q[3]]})
            elif x1 > b:
                kept.append({**s, "quad": [(right(q[0][1]), q[0][1]), q[1], q[2], (right(q[3][1]), q[3][1])]})
        stones = kept
    return stones


def flags():
    """The flagstones of one floor, each a dict with a name and its corners as masonry() gives them."""
    out = []
    for r in range(len(FLAG_ROWS) - 1):
        v0, v1 = FLAG_ROWS[r], FLAG_ROWS[r + 1]
        edges = (0.0, *FLAG_JOINTS[r], TILE)
        for i in range(len(edges) - 1):
            out.append({"row": r, "name": f"r{r}f{i}", "quad": [(edges[i], v0), (edges[i + 1], v0), (edges[i + 1], v1), (edges[i], v1)]})
    return out


def _along(a, b, d):
    length = math.hypot(b[0] - a[0], b[1] - a[1])
    return (a[0] + (b[0] - a[0]) * d / length, a[1] + (b[1] - a[1]) * d / length)


def broken(quad, chips):
    """A quad with each corner cut off: chips[i] is (along the top or bottom edge, along the side) at corner i. The
    eight corners run top edge first, as the quad's do."""
    tl, tr, br, bl = quad
    (a0, b0), (a1, b1), (a2, b2), (a3, b3) = chips
    return [_along(tl, tr, a0), _along(tr, tl, a1), _along(tr, br, b1), _along(br, tr, b2), _along(br, bl, a2), _along(bl, br, a3), _along(bl, tl, b3), _along(tl, bl, b0)]


def drawn_in(quad, gaps):
    """A quad with each corner moved in from its joints: gaps[i] is (across the side joint, across the bed) at corner i."""
    tl, tr, br, bl = quad
    (g0, h0), (g1, h1), (g2, h2), (g3, h3) = gaps
    return [(tl[0] + g0, tl[1] + h0), (tr[0] - g1, tr[1] + h1), (br[0] - g2, br[1] - h2), (bl[0] + g3, bl[1] - h3)]


def shaped(stone, gap=GAP, chip=CHIP, hard=BREAK, broken_share=0.3):
    """A stone of a pattern given its own shape, the same on every machine: `footprint` is the quad it is drawn into,
    `outline` that quad broken at its corners, eight points, and `chips` the breaks."""
    r = _rng("shape", stone["name"])
    gaps = [(r.uniform(*gap), r.uniform(*gap)) for _ in range(4)]
    chips = [(r.uniform(*chip), r.uniform(*chip)) for _ in range(4)]
    if r.random() < broken_share:
        k = r.randrange(4)
        chips[k] = (r.uniform(*hard), r.uniform(*hard))
    foot = drawn_in(stone["quad"], gaps)
    # No break may reach past half of its edge.
    width = min(foot[1][0] - foot[0][0], foot[2][0] - foot[3][0])
    height = min(foot[3][1] - foot[0][1], foot[2][1] - foot[1][1])
    chips = [(min(a, width * 0.35), min(b, height * 0.35)) for a, b in chips]
    return {**stone, "footprint": foot, "chips": chips, "outline": broken(foot, chips)}


def face(stone):
    """How the stone's face stands, the same on every machine: its rise from the mortar at each corner, its bevel on
    each edge (top, right, bottom, left), its crown and where the crown is, as shares of the stone across and down."""
    r = _rng("face", stone["name"])
    rise = r.uniform(*RISE)
    corners = [rise - r.uniform(0.0, 0.01) for _ in range(4)]
    bevels = [r.uniform(*BEVEL) for _ in range(4)]
    return {"rise": corners, "bevel": bevels, "crown": r.uniform(*CROWN), "at": (r.uniform(0.32, 0.68), r.uniform(0.3, 0.62))}


def masonry_stones():
    """masonry() with every stone shaped."""
    return [shaped(s) for s in masonry()]


def flag_stones():
    """flags() with every flag shaped."""
    return [shaped(s, FLAG_GAP, FLAG_CHIP, (0.03, 0.05), 0.2) for s in flags()]


def inset(poly, insets):
    """The polygon with each edge moved inward by its inset. The outline goes top left, top right, bottom right, bottom
    left as the face is seen (v down), which is anticlockwise in (u, v), so inward is to the left of each edge."""
    n = len(poly)
    lines = []
    for i in range(n):
        (x0, y0), (x1, y1) = poly[i], poly[(i + 1) % n]
        dx, dy = x1 - x0, y1 - y0
        length = math.hypot(dx, dy)
        dx, dy = dx / length, dy / length
        lines.append(((x0 - dy * insets[i], y0 + dx * insets[i]), (dx, dy)))
    out = []
    for i in range(n):
        (p, d), (q, e) = lines[i - 1], lines[i]
        den = d[0] * e[1] - d[1] * e[0]
        if abs(den) < 1e-9:
            out.append(q)
            continue
        a = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den
        out.append((p[0] + a * d[0], p[1] + a * d[1]))
    return out


def face_ring(foot, chips, bevels):
    """A stone's face: its footprint moved in by the bevel on each edge, and broken at the corners a little less than
    the footprint is."""
    top = inset(foot, bevels)
    if chips is None:
        return top
    tw = min(top[1][0] - top[0][0], top[2][0] - top[3][0])
    th = min(top[3][1] - top[0][1], top[2][1] - top[1][1])
    return broken(top, [(min(a * 0.6, tw * 0.3), min(b * 0.6, th * 0.3)) for a, b in chips])

# The stone tier's pieces: rough-cut limestone laid in lime mortar on oak
# lintels and sills, with dressed jamb stones, a plinth of big blocks under
# flagstone floors, and an iron-bound oak door. Every stone of a wall is a
# solid of its own, cut from the pattern in layout.py that the textures are
# painted to: drawn in from its joints, broken at its corners, bevelled up to
# a face that stands proud or sits back and is crowned in the middle. Each
# piece fills its content box (content/building.ts) to within the few
# centimetres its stones stand proud, and its levels run from that down to a
# plain box.

import math

import layout as L
from parts import TILE, Frame, Mesh, area, block, clip_solid, dot, loft, material, octagon, rng, scale, shrink, stone, straight

H = TILE / 2
T = 0.1  # half a wall's thickness
MD = L.MORTAR_DEPTH
CORE = T - MD
# A wall's top stands this far below its box, so a ceiling laid on it shows its own floor and not the wall's.
# Its core reaches as far below, so a wall stood on another closes the joint.
GAP = 0.004

# The palette colours (shared/pack/palette.ts) the converter draws each material in flat, being the nearest to the mean
# of its base colour. The converter reads them off the pictures; they are here so a render of the flat model shows them.
COLOURS = {"masonry": (157, 153, 147), "flags": (128, 128, 128), "dressed": (203, 201, 175), "timber": (125, 87, 69), "iron": (46, 43, 36)}
MATS = {name: material(name, rgb) for name, rgb in COLOURS.items()}

FRONT = Frame((-H, H, CORE), (1, 0, 0), (0, -1, 0), (0, 0, 1))
BACK = Frame((H, H, -CORE), (-1, 0, 0), (0, -1, 0), (0, 0, -1))


def on(frame):
    """A mapping for the faces of a part laid on a frame: through the frame where they face out with it, else along
    their own axis."""
    return lambda n: frame.uv if dot(n, frame.n) > 0.3 else straight(n)


def through_uv(grain=None):
    return lambda n: FRONT.uv if n[2] > 0.3 else BACK.uv if n[2] < -0.3 else straight(n, grain)


def keep_below(frame, u):
    """The half-space where a frame's u is no more than `u`."""
    return (frame.at(u, 0.0), frame.u)


def keep_above(frame, u):
    return (frame.at(u, 0.0), scale(frame.u, -1))


def keep_lower(frame, v):
    """The half-space where a frame's v is at least `v`: below that line as the face is seen."""
    return (frame.at(0.0, v), scale(frame.v, -1))


def plain(look, extra=0.0):
    """A stone's face as a coarser level draws it: level at its mean height, crown included, and not broken."""
    mean = sum(look["rise"]) / 4 + look["crown"] * 0.4 + extra
    return {"rise": [mean] * 4, "bevel": look["bevel"], "crown": 0.0, "at": look["at"]}


def lay(m, frame, s, look, mat, level=0, keep=(), uv_of=None):
    """A shaped stone on a frame, in both halves where it runs past the span's edge, cut to the half-spaces in `keep`."""
    wraps = max(p[0] for p in s["footprint"]) > TILE + 1e-9
    for shift in (0.0, -TILE) if wraps else (0.0,):
        # The next level keeps each stone's rise and crown and loses its broken corners.
        faces = stone(frame, s["footprint"], s["chips"] if level == 0 else None, look, shift)
        planes = list(keep)
        if wraps:
            planes.append(keep_below(frame, TILE) if shift == 0.0 else keep_above(frame, 0.0))
        for p0, n in planes:
            faces = clip_solid(faces, p0, n)
        if len(faces) >= 4:
            m.convex(faces, mat, uv_of or on(frame))


def cell(u0, u1, v0, v1):
    return [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]


_ATLAS = []


def atlas():
    """The walling stones that lie wholly inside the masonry picture, each as its footprint's box (u0, u1, v0, v1)."""
    if not _ATLAS:
        for s in L.masonry_stones():
            us = [p[0] for p in s["outline"]]
            vs = [p[1] for p in s["outline"]]
            if min(us) > 0.02 and max(us) < TILE - 0.02:
                _ATLAS.append((min(us), max(us), min(vs), max(vs)))
    return _ATLAS


def onto_stone(origin, u_axis, v_axis, box, key):
    """A mapping that lays one walling stone of the masonry picture over a block's face, so a block that is not part
    of a wall's pattern still wears a whole rock-faced stone of it: `box` is the face's extent (a0, a1, b0, b1) along
    u_axis and v_axis from origin, in metres."""
    a0, a1, b0, b1 = box
    w, h = a1 - a0, b1 - b0

    def unlike(t):
        tw, th = t[1] - t[0], t[3] - t[2]
        return abs(math.log((tw / th) / (w / h))) + 0.6 * abs(math.log(tw / w)) + 0.6 * abs(math.log(th / h))

    near = sorted(atlas(), key=unlike)
    t = near[rng("atlas", *key).randrange(min(3, len(near)))]

    def uv(p):
        d = (p[0] - origin[0], p[1] - origin[1], p[2] - origin[2])
        a = (d[0] * u_axis[0] + d[1] * u_axis[1] + d[2] * u_axis[2] - a0) / w
        b = (d[0] * v_axis[0] + d[1] * v_axis[1] + d[2] * v_axis[2] - b0) / h
        return ((t[0] + a * (t[1] - t[0])) / TILE, (t[2] + b * (t[3] - t[2])) / TILE)

    return uv


def stone_faced(origin, axes, boxes, key):
    """A mapping for a block with a stone of the masonry picture on each of its faces that look along an axis in
    `axes` (outward normal to its (u axis, v axis) and box); other faces along their own axis."""
    maps = {n: onto_stone(origin, ua, va, boxes[n], (*key, n)) for n, (ua, va) in axes.items()}

    def uv_of(normal):
        for n, f in maps.items():
            if normal[0] * n[0] + normal[1] * n[1] + normal[2] * n[2] > 0.7:
                return f
        return straight(normal)

    return uv_of


def within(s, course, left, right, band=None):
    us = [p[0] for p in s["quad"]]
    return s["course"] == course and min(us) >= left - 1e-6 and max(us) <= right + 1e-6 and (band is None or s.get("band") == band)


def walling(m, frame, side, stones, level, keep=()):
    for s in stones:
        lay(m, frame, s, L.face(s), "masonry", level, keep)


def bands(m, frame, rise=0.034):
    """The courses of a face without their head joints: a coarser level of walling."""
    for k in range(len(L.BEDS) - 1):
        v0 = (GAP if k == 0 else L.BEDS[k]) + 0.01
        look = {"rise": [rise] * 4, "bevel": [0.028, 0.0, 0.028, 0.0], "crown": 0.0, "at": (0.5, 0.5)}
        m.convex(stone(frame, cell(0.0, TILE, v0, L.BEDS[k + 1] - 0.01), None, look, crowned=False), "masonry", on(frame))


# Walls


def wall(level):
    m = Mesh()
    if level == 3:
        m.box((-H, -H, -T), (H, H, T), "masonry")
        return m
    m.box((-H, -H - GAP, -CORE), (H, H - GAP, CORE), "masonry")
    for frame, side in ((FRONT, "front"), (BACK, "back")):
        if level == 2:
            bands(m, frame)
        else:
            walling(m, frame, side, L.masonry_stones(), level)
    return m


def opening(kind, level):
    """A doorframe or a windowframe. The pattern's own joints bound the jamb stones and the lintel."""
    spec = L.DOOR if kind == "door" else L.WINDOW
    ou0, ou1 = spec["open"]
    ox0, ox1 = ou0 - H, ou1 - H
    lk, ll, lr = spec["lintel"]
    lintel_v = (L.BEDS[lk], L.BEDS[lk + 1]) if kind == "door" else (L.SPLIT[3], L.BEDS[lk + 1])
    lin_top, lin_bottom = H - lintel_v[0], H - lintel_v[1]
    open_top = lin_bottom
    open_bottom = -H if kind == "door" else H - spec["sill"]
    m = Mesh()

    def reveal(inner_x):
        return lambda n: "dressed" if abs(n[0]) > 0.5 and n[0] * inner_x > 0 else "masonry"

    if level == 2:
        # The content's boxes, with the lintel, the jambs and the sill or threshold on them.
        m.box((-H, -H, -T), (ox0, H, T), reveal(1))
        m.box((ox1, -H, -T), (H, H, T), reveal(-1))
        m.box((ox0, lin_top, -T), (ox1, H, T), "masonry")
        if kind == "window":
            m.box((ox0, -H, -T), (ox1, open_bottom - 0.01, T), "masonry")
        m.box((ll - H, lin_bottom, -T - 0.008), (lr - H, lin_top, T + 0.008), "timber", grain="x")
        for sign, x_open in ((-1, ox0), (1, ox1)):
            lo, hi = sorted((x_open, x_open + sign * 0.4))
            m.box((lo, open_bottom, -T - 0.004), (hi, open_top, T + 0.004), "dressed")
        sill_or_threshold(m, kind, ox0, ox1, open_bottom)
        return m

    # The core: two posts the height of the wall, standing a centimetre back from the jamb stones, and what is above
    # and below the opening.
    m.box((-H, -H - GAP, -CORE), (ox0 - 0.01, H - GAP, CORE), "masonry")
    m.box((ox1 + 0.01, -H - GAP, -CORE), (H, H - GAP, CORE), "masonry")
    m.box((ox0 - 0.02, lin_top - 0.015, -CORE), (ox1 + 0.02, H - GAP, CORE), "masonry")
    if kind == "window":
        m.box((ox0 - 0.02, -H - GAP, -CORE), (ox1 + 0.02, open_bottom - 0.01, CORE), "masonry")

    keep = []
    for s in L.masonry_stones():
        if any(within(s, k, l, r) for k, l, r in spec["jambs"]):
            continue
        if kind == "door" and within(s, lk, ll, lr):
            continue
        if kind == "window" and within(s, lk, ll, lr, band="l"):
            continue
        keep.append(s)
    for frame, side in ((FRONT, "front"), (BACK, "back")):
        walling(m, frame, side, keep, level)

    # Jamb stones, dressed, through the wall: their outer ends are the pattern's head joints on each face.
    for k, l, r in spec["jambs"]:
        yt, yb = H - L.BEDS[k], H - L.BEDS[k + 1]
        for side in (-1, 1):
            g = rng(kind, "jamb", k, side)
            gf, gk = g.uniform(0.005, 0.011), g.uniform(0.005, 0.011)
            # Jamb stones sit on one another with no mortar between, so nothing can be seen through the reveal.
            top, bottom = yt, yb
            if side < 0:
                xf, xb = l - H + gf, H - r + gk
                front = [(xf, bottom), (ox0, bottom), (ox0, top), (xf, top)]
                back = [(xb, bottom), (ox0, bottom), (ox0, top), (xb, top)]
            else:
                xf, xb = r - H - gf, H - l - gk
                front = [(ox1, bottom), (xf, bottom), (xf, top), (ox1, top)]
                back = [(ox1, bottom), (xb, bottom), (xb, top), (ox1, top)]
            # Prouder than any walling stone, so the jambs read as the stones that carry the opening.
            rise = [MD + 0.026 + g.uniform(0.0, 0.008) for _ in range(4)]
            bevel = 0.018 if level == 0 else 0.022
            m.convex(block(front, back, CORE, CORE, bevel, rise, rise[::-1]), "dressed", through_uv())

    # The lintel, hewn oak through the wall, a little proud, its faces in three facets along it.
    g = rng(kind, "lintel")
    gl, gr, gt = g.uniform(0.006, 0.012), g.uniform(0.006, 0.012), g.uniform(0.006, 0.012)
    top = lin_top - gt
    mid = (ll + lr) / 2 - H + g.uniform(-0.15, 0.15)

    def lintel_outline(x0, x1):
        if level > 0:
            return [(x0, open_top), (x1, open_top), (x1, top), (x0, top)]
        return [(x0, open_top), (mid, open_top), (x1, open_top), (x1, top), (mid, top + g.uniform(-0.006, 0.004)), (x0, top)]

    front = lintel_outline(ll - H + gl, lr - H - gr)
    back = lintel_outline(H - lr + gr, H - ll + gl)
    if level == 0:
        rise = [MD + 0.022 + d for d in (0.004, -0.005, 0.006, 0.0, 0.008, -0.003)]
    else:
        rise = MD + 0.024
    m.convex(block(front, back, CORE, CORE, 0.016, rise, rise), "timber", through_uv("x"))
    sill_or_threshold(m, kind, ox0, ox1, open_bottom)
    return m


def sill_or_threshold(m, kind, ox0, ox1, open_bottom):
    if kind == "door":
        # A worn threshold stone between the jambs.
        m.prism([(-T, -H - GAP), (T, -H - GAP), (T, -H + 0.008), (T - 0.012, -H + 0.02), (-T + 0.012, -H + 0.02), (-T, -H + 0.008)], "x", ox0, ox1, "dressed")
    else:
        # The sill, oak, weathered to a slope at the front.
        sb = open_bottom - 0.09
        m.prism([(-T - 0.006, sb), (T + 0.05, sb), (T + 0.05, open_bottom - 0.035), (T + 0.02, open_bottom), (-T - 0.006, open_bottom)], "x", ox0 - 0.18, ox1 + 0.18, "timber", grain="x")


# Floors


def TOP(y):
    return Frame((-H, y, -H), (1, 0, 0), (0, 0, 1), (0, 1, 0))


def flagstones(m, bed, level):
    frame = TOP(bed)
    for s in L.flag_stones():
        r = rng("flag rise", s["name"])
        rise = r.uniform(0.009, 0.012)
        look = {"rise": [rise - r.uniform(0.0, 0.0015) for _ in range(4)], "bevel": [r.uniform(*L.FLAG_BEVEL) for _ in range(4)], "crown": 0.0, "at": (0.5, 0.5)}
        chips = s["chips"] if level == 0 else None
        m.convex(stone(frame, s["footprint"], chips, look if level == 0 else plain(look), crowned=False), "flags", on(frame))


# Plinth joints along each side of a foundation between its corner blocks, as shares of the run between them.
PLINTH = {"+z": (0.37, 0.71), "-z": (0.29, 0.55, 0.81), "+x": (0.42, 0.78), "-x": (0.33, 0.64)}


def foundation(level):
    top, bottom = 0.1875, -0.1875
    m = Mesh()
    if level == 2:
        m.box((-H, bottom, -H), (H, top, H), lambda n: "flags" if n[1] > 0.5 else "masonry")
        return m
    PD = 0.035
    bed = top - 0.012
    m.box((-H + PD, bottom, -H + PD), (H - PD, bed, H - PD), lambda n: "flags" if n[1] > 0.5 else "masonry")
    flagstones(m, bed, level)
    # A big block at each corner, standing a little proud of both faces.
    reach = {}
    for sx in (-1, 1):
        for sz in (-1, 1):
            g = rng("corner", sx, sz)
            a, b, p = g.uniform(0.44, 0.62), g.uniform(0.44, 0.62), g.uniform(0.004, 0.014)
            reach[(sx, sz)] = (a, b)
            cut = g.uniform(0.015, 0.03) if level == 0 else 0.0
            ch = 0.014 if level == 0 else 0.0
            y0, y1 = bottom, bed - g.uniform(0.003, 0.008)

            def ring(out):
                # Battered as the plinth stones are: further out at the foot.
                x0, x1 = sorted((sx * (H - a), sx * (H + out)))
                z0, z1 = sorted((sz * (H - b), sz * (H + out)))
                return octagon((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, cut)

            foot, head = ring(p + 0.014), ring(p - 0.004)
            if ch:
                stations = [(y0, shrink(foot, ch)), (y0 + ch, foot), (y1 - ch, head), (y1, shrink(head, ch))]
            else:
                stations = [(y0, foot), (y1, head)]
            # Each outer face wears a walling stone: (u axis, v axis) as the face is seen, v down.
            axes = {(sx, 0, 0): ((0.0, 0.0, -sx), (0.0, -1.0, 0.0)), (0, 0, sz): ((sz, 0.0, 0.0), (0.0, -1.0, 0.0))}
            corner = (sx * H, y1, sz * H)
            boxes = {}
            for n, (ua, va) in axes.items():
                pts = [p for ring in (foot, head) for p in ring]
                proj = [((px - corner[0]) * ua[0] + (pz - corner[2]) * ua[2]) for px, pz in pts]
                boxes[n] = (min(proj), max(proj), 0.0, y1 - y0)
            m.convex(loft("y", stations), "masonry", stone_faced(corner, axes, boxes, ("corner", sx, sz)))
    # Between them, plinth stones on each side.
    sides = {
        "+z": (Frame((-H, bed, H - PD), (1, 0, 0), (0, -1, 0), (0, 0, 1), shift=(0.0, 0.1)), reach[(-1, 1)][0], reach[(1, 1)][0]),
        "-z": (Frame((H, bed, -H + PD), (-1, 0, 0), (0, -1, 0), (0, 0, -1), shift=(0.0, 0.3)), reach[(1, -1)][0], reach[(-1, -1)][0]),
        "+x": (Frame((H - PD, bed, H), (0, 0, -1), (0, -1, 0), (1, 0, 0), shift=(0.0, 0.5)), reach[(1, 1)][1], reach[(1, -1)][1]),
        "-x": (Frame((-H + PD, bed, -H), (0, 0, 1), (0, -1, 0), (-1, 0, 0), shift=(0.0, 0.7)), reach[(-1, -1)][1], reach[(-1, 1)][1]),
    }
    depth = bed - bottom
    for name, (frame, start, end) in sides.items():
        cuts = [start] + [start + (TILE - start - end) * f for f in PLINTH[name]] + [TILE - end]
        for i in range(len(cuts) - 1):
            s = L.shaped({"name": f"plinth{name}{i}", "quad": cell(cuts[i], cuts[i + 1], 0.0, depth)}, (0.004, 0.012), (0.012, 0.045), (0.04, 0.07), 0.25)
            r = rng("plinth face", name, i)
            # Battered: the foot of each stone stands further out than its head, as a wall that holds ground back does.
            out = PD + r.uniform(-0.004, 0.008)
            look = {"rise": [out - 0.006, out - 0.006 + r.uniform(-0.003, 0.003), out + 0.014, out + 0.014 + r.uniform(-0.003, 0.003)], "bevel": [r.uniform(0.016, 0.03) for _ in range(4)], "crown": r.uniform(0.004, 0.01), "at": (r.uniform(0.4, 0.6), r.uniform(0.4, 0.6))}
            us = [p[0] for p in s["outline"]]
            vs = [p[1] for p in s["outline"]]
            box = (min(us), max(us), min(vs), max(vs))
            faced = onto_stone(frame.o, frame.u, frame.v, box, ("plinth", name, i))
            lay(m, frame, s, look, "masonry", level, uv_of=lambda n, f=faced, fr=frame: f if dot(n, fr.n) > 0.3 else straight(n))
    return m


def beam(m, axis, centre, half, run, bottom, top, key, level, keep=""):
    """A hewn oak beam: its section a little out of true and not quite the same at both ends. `keep` names a side,
    "lo" or "hi", cut by the piece's edge, which stays flat and square."""
    g = rng("beam", key)

    def section(jit):
        lo, hi = centre - half, centre + half
        if "lo" not in keep:
            lo += jit()
        if "hi" not in keep:
            hi += jit()
        b = bottom + jit()
        c1, c2 = (g.uniform(0.012, 0.028), g.uniform(0.012, 0.028)) if level == 0 else (0.015, 0.015)
        pts = [(lo, top)]
        pts += [(lo, b)] if "lo" in keep else [(lo, b + c1), (lo + c1, b)]
        pts += [(hi, b)] if "hi" in keep else [(hi - c2, b), (hi, b + c2)]
        pts.append((hi, top))
        return pts

    jit = (lambda: g.uniform(-0.006, 0.006)) if level == 0 else (lambda: 0.0)
    a, b = section(jit), section(jit)
    if len(a) != len(b):
        b = a
    m.convex(loft(axis, [(run[0], a), (run[1], b)]), "timber", lambda n: straight(n, axis))


def ceiling(level):
    top, bottom = 0.125, -0.125
    soffit = -0.005
    m = Mesh()
    if level == 2:
        # As deep as the slab and half the beams, which is nearer the finest than the whole depth would be.
        m.box((-H, -0.065, -H), (H, top, H), lambda n: "flags" if n[1] > 0.5 else "masonry")
        return m
    bed = top - 0.012
    m.box((-H, soffit, -H), (H, bed, H), lambda n: "flags" if n[1] > 0.5 else "masonry")
    flagstones(m, bed, level)
    # Between the beams the underside of the flags is rough stone, a walling stone of the masonry picture to each bay.
    bays = ((-H + 0.04, -0.58), (-0.42, 0.42), (0.58, H - 0.04))
    if level == 0:
        for i, (x0, x1) in enumerate(bays):
            for j, (z0, z1) in enumerate(bays):
                drop = rng("bay", i, j).uniform(0.006, 0.014)
                box = (x0, x1, z0, z1)
                faced = onto_stone((0.0, soffit - drop, 0.0), (1.0, 0.0, 0.0), (0.0, 0.0, -1.0), (box[0], box[1], -box[3], -box[2]), ("bay", i, j))
                m.box((x0, soffit - drop, z0), (x1, soffit + 0.003, z1), "masonry", grain=None)
                # The box maps its faces along their own axes; give its underside the stone.
                pts, mat, uvs, smooth = m.faces[-6:][0]
                for k in range(6):
                    fpts, fmat, fuvs, fsmooth = m.faces[-6 + k]
                    if all(abs(p[1] - (soffit - drop)) < 1e-9 for p in fpts):
                        m.faces[-6 + k] = (fpts, fmat, [faced(p) for p in fpts], fsmooth)
    # Oak beams in a grid a metre square: two across the slab each way, and half a beam along each edge, which meets
    # its neighbour's half under the joint, or stands in the wall the ceiling is laid on. The beams one way run whole;
    # the others are cut between them.
    runs = [(-0.5, 0.08, ""), (0.5, 0.08, ""), (H - 0.04, 0.04, "hi"), (-H + 0.04, 0.04, "lo")]
    for centre, half, keep in runs:
        beam(m, "x", centre, half, (-H, H), bottom, 0.0, ("x", centre), level, keep)
    spans = ((-H + 0.04, -0.58), (-0.42, 0.42), (0.58, H - 0.04))
    for centre, half, keep in runs:
        for z0, z1 in spans:
            beam(m, "z", centre, half, (z0, z1), bottom + 0.02, 0.0, ("z", centre, z0), level, keep)
    return m


# Pillars


# The top block stops short of the pillar's box: a ceiling laid on a pillar has its top level with the pillar's, and
# its flags stand only 12 mm over its core.
PILLAR_BLOCKS = (0.52, 0.47, 0.55, 0.44, 0.50, 0.505)


def pillar(level):
    w = 0.25
    m = Mesh()
    if level == 2:
        m.box((-w, -H, -w), (w, H, w), "masonry")
        return m
    y = -H
    for i, height in enumerate(PILLAR_BLOCKS):
        g = rng("pillar", i)
        y0, y1 = y, y + height
        y = y1
        if level == 1:
            m.box((-w, y0, -w), (w, y1, w), "masonry", shift=(g.uniform(-0.3, 0.3), g.uniform(-0.3, 0.3)))
            continue
        turn = math.radians(g.uniform(-1.2, 1.2))
        dx, dz = g.uniform(-0.004, 0.004), g.uniform(-0.004, 0.004)
        hx, hz = w + g.uniform(-0.012, 0.01), w + g.uniform(-0.012, 0.01)
        cut, ch = g.uniform(0.012, 0.03), g.uniform(0.012, 0.022)
        c, s = math.cos(turn), math.sin(turn)

        def turned(profile):
            return [(c * x + s * z + dx, -s * x + c * z + dz) for x, z in profile]

        full = octagon(0.0, 0.0, hx, hz, cut)
        inner = shrink(full, ch)
        lo, hi = turned(full), turned(full)
        faces = loft("y", [(y0, turned(inner)), (y0 + ch, lo), (y1 - ch, hi), (y1, turned(inner))])
        # Each of the four broad sides is pitched out to a crown, so the block reads as a rough-hewn stone.
        middle = [f for f in faces[2 + 8 : 2 + 16]]
        faces = faces[:10] + faces[18:]
        for k, quad in enumerate(middle):
            if k % 2 == 1:
                faces.append(quad)
                continue
            mx = sum(p[0] for p in quad) / 4
            my = sum(p[1] for p in quad) / 4 + g.uniform(-0.06, 0.06)
            mz = sum(p[2] for p in quad) / 4
            out = math.hypot(mx, mz) or 1.0
            crown = g.uniform(0.008, 0.02)
            apex = (mx + mx / out * crown, my, mz + mz / out * crown)
            faces += [([quad[i], quad[(i + 1) % 4], apex], True) for i in range(4)]
        axes = {(0, 0, 1): ((1.0, 0.0, 0.0), (0.0, -1.0, 0.0)), (1, 0, 0): ((0.0, 0.0, -1.0), (0.0, -1.0, 0.0)), (0, 0, -1): ((-1.0, 0.0, 0.0), (0.0, -1.0, 0.0)), (-1, 0, 0): ((0.0, 0.0, 1.0), (0.0, -1.0, 0.0))}
        corner = (0.0, y1, 0.0)
        boxes = {n: (-max(hx, hz) - 0.02, max(hx, hz) + 0.02, 0.0, y1 - y0) for n in axes}
        m.convex(faces, "masonry", stone_faced(corner, axes, boxes, ("pillar", i)))
    return m


# Stairs


STEPS = 10
RISE = TILE / STEPS


def stairs(level):
    m = Mesh()
    if level == 3:
        # A ramp the size of the flight.
        m.prism([(-H, -H), (H, -H), (H, H), (H - RISE, H)], "x", -H, H, "dressed")
        return m
    inset_x = MD if level == 0 else MD / 2
    back = H - inset_x
    # The mass under the treads, stepped to carry each, walled with the pattern's stones on its sides and back.
    profile = [(-H + RISE, -H), (back, -H)]
    for i in range(STEPS - 1, 0, -1):
        z = -H + (i + 1) * RISE
        yy = -H + i * RISE
        profile += [(min(z, back), yy), (z - RISE, yy)]
    mass(m, profile, -H + inset_x, H - inset_x)
    for i in range(STEPS):
        z0, z1 = -H + i * RISE, -H + (i + 1) * RISE
        y0, y1 = -H + i * RISE, -H + (i + 1) * RISE
        g = rng("step", i)
        if level == 2:
            m.prism([(z0, y0), (z1, y0), (z1, y1), (z0 + 0.025, y1), (z0, y1 - 0.025)], "x", -H, H, "dressed")
            continue
        split = g.uniform(-0.75, 0.75)
        for k, (x0, x1) in enumerate(((-H, split - 0.002), (split + 0.002, H))):
            dy = g.uniform(-0.004, 0.002) if level == 0 else 0.0
            nose = g.uniform(0.02, 0.04) if level == 0 else 0.03
            prof = [(z0, y0), (z1, y0), (z1, y1 + dy), (z0 + nose, y1 + dy), (z0, y1 + dy - nose)]
            c = 0.01 if level == 0 else 0.0
            if c:
                inner = shrink(prof, c)
                stations = [(x0, inner), (x0 + c, prof), (x1 - c, prof), (x1, inner)]
            else:
                stations = [(x0, prof), (x1, prof)]
            shift = (g.uniform(-0.3, 0.3), g.uniform(-0.3, 0.3))
            m.convex(loft("x", stations), "dressed", lambda n, shift=shift: straight(n, None, shift))
    if level == 0:
        stones = L.masonry_stones()
        for sign in (1, -1):
            if sign > 0:
                frame = Frame((H - MD, H, H), (0, 0, -1), (0, -1, 0), (1, 0, 0))
            else:
                frame = Frame((-H + MD, H, -H), (0, 0, 1), (0, -1, 0), (-1, 0, 0))
            # The cheek walls rise with the flight, their top on the line through the nosings' feet, and stop short
            # of the back, whose walling holds the corners.
            cheek = [((0.0, 0.0, 0.0), (0.0, 0.7071067811865476, -0.7071067811865476)), keep_above(frame, MD) if sign > 0 else keep_below(frame, TILE - MD)]
            for s in stones:
                # The stairs' walling keeps its stones' lumps but not their broken corners, which on this much
                # walling cost more than they show.
                lay(m, frame, s, L.face(s), "masonry", 1, cheek)
        rear = Frame((-H, H, H - MD), (1, 0, 0), (0, -1, 0), (0, 0, 1))
        for s in stones:
            if max(p[1] for p in s["footprint"]) < RISE:
                continue
            lay(m, rear, s, L.face(s), "masonry", 1, [keep_lower(rear, RISE)])
    return m


def mass(m, profile, x0, x1):
    """A solid of a stepped (z, y) profile, run along x from x0 to x1."""
    from parts import newell

    if area(profile) < 0:
        profile = profile[::-1]
    n = len(profile)
    # Anticlockwise in (z, y), so looking along -x; the face at x1 looks along +x and lists its corners the other way.
    m.face([(x1, y, z) for z, y in profile[::-1]], "masonry", straight((1, 0, 0)))
    m.face([(x0, y, z) for z, y in profile], "masonry", straight((-1, 0, 0)))
    for i in range(n):
        (za, ya), (zb, yb) = profile[i], profile[(i + 1) % n]
        # Outward is to the right of each edge of an anticlockwise outline.
        out = (0.0, -(zb - za), (yb - ya))
        quad = [(x0, ya, za), (x0, yb, zb), (x1, yb, zb), (x1, ya, za)]
        nrm = newell(quad)
        if nrm[1] * out[1] + nrm[2] * out[2] < 0:
            quad = quad[::-1]
        m.face(quad, "masonry", straight(newell(quad)))


# The door


DW, DH, DT = 0.7, 2.3125 / 2, 0.04
DOOR_FOOT = 0.02  # it clears the threshold


def door(level):
    m = Mesh()
    y0, y1 = -DH + DOOR_FOOT, DH
    face_z, back_z = 0.034, -0.016
    if level == 2:
        m.box((-DW, y0, -DT), (DW, y1, DT), "timber", grain="y")
        return m
    if level == 1:
        m.box((-DW, y0, back_z), (DW, y1, face_z), "timber", grain="y")
    else:
        # Five oak planks of their own widths and thicknesses, their arrises taken off and their ends not quite level,
        # so each reads as its own board.
        widths = (0.30, 0.26, 0.29, 0.27, 0.28)
        x = -DW
        for k, w in enumerate(widths):
            g = rng("plank", k)
            a, b = x, x + w
            fz = face_z - g.uniform(0.0, 0.004)
            cp = g.uniform(0.005, 0.009)
            prof = [(a + cp, back_z), (b - cp, back_z), (b, back_z + cp), (b, fz - cp), (b - cp, fz), (a + cp, fz), (a, fz - cp), (a, back_z + cp)]
            lo, hi = y0 + g.uniform(0.0, 0.008), y1 - g.uniform(0.0, 0.006)
            m.convex(loft("y", [(lo, prof), (hi, prof)]), "timber", lambda n, k=k: straight(n, "y", ((k * 0.31) % 0.5 - 0.25, (k * 0.17) % 0.4 - 0.2)))
            x = b
    straps = (-0.82, 0.0, 0.82)
    for yc in straps:
        if level == 0:
            strap(m, yc, face_z)
        else:
            m.box((-DW + 0.01, yc - 0.035, face_z), (DW - 0.01, yc + 0.035, DT), "iron", grain="x")
    # Ledges across the back, and braces between them rising from the hinge side.
    for yc in straps:
        if level == 0:
            prof = [(back_z, yc - 0.07), (back_z, yc + 0.07), (-DT + 0.006, yc + 0.07), (-DT, yc + 0.064), (-DT, yc - 0.064), (-DT + 0.006, yc - 0.07)]
            m.prism(prof, "x", -DW + 0.08, DW - 0.08, "timber", grain="x")
        else:
            m.box((-DW + 0.08, yc - 0.07, -DT), (DW - 0.08, yc + 0.07, back_z), "timber", grain="x")
    if level == 1:
        return m
    for ya, yb in ((straps[0], straps[1]), (straps[1], straps[2])):
        brace(m, (-DW + 0.2, ya), (DW - 0.2, yb), 0.055, -DT + 0.002, back_z)
    # Rivet heads along the straps.
    for yc in straps:
        for xc in (-0.56, -0.19, 0.19, 0.56):
            stud(m, xc, yc, DT, 0.011, 0.007)
    # The knuckles the straps are forged round, which turn on pins in the jamb: hidden in it when the door is shut,
    # seen at its edge when it stands open.
    for yc in straps:
        knuckle = [(-DW + 0.012 * math.cos(a), 0.03 + 0.012 * math.sin(a)) for a in (k * math.pi / 4 for k in range(8))]
        m.convex(loft("y", [(yc - 0.05, knuckle), (yc + 0.05, knuckle)]), "iron", lambda n: straight(n))
    # A ring to pull it by, on a plate above the middle strap.
    m.box((0.41, 0.075, face_z), (0.49, 0.155, DT), "iron")
    ring(m, (0.45, 0.07, DT + 0.009), 0.05, 0.008)
    return m


def strap(m, yc, face_z):
    """An iron strap hinge across the door: square at the hinge, narrowing to a spear point near the far edge."""
    half = 0.035
    x0, x1, x2 = -DW + 0.004, DW - 0.16, DW - 0.06
    stations = [(x0, [(face_z, yc - half), (DT, yc - half), (DT, yc + half), (face_z, yc + half)]), (x1, [(face_z, yc - half), (DT, yc - half), (DT, yc + half), (face_z, yc + half)]), (x2, [(face_z, yc - 0.004), (DT, yc - 0.004), (DT, yc + 0.004), (face_z, yc + 0.004)])]
    # Profiles across x are (z, y).
    m.convex(loft("x", stations), "iron", lambda n: straight(n, "x"))


def brace(m, a, b, half, z0, z1):
    (xa, ya), (xb, yb) = a, b
    d = (xb - xa, yb - ya)
    length = math.hypot(*d)
    d = (d[0] / length, d[1] / length)
    p = (-d[1], d[0])
    corners = [(xa + p[0] * s, ya + p[1] * s) for s in (-half, half)] + [(xb + p[0] * s, yb + p[1] * s) for s in (half, -half)]
    faces = [[(x, y, z0) for x, y in corners], [(x, y, z1) for x, y in corners]]
    for k in range(4):
        (xa_, ya_), (xb_, yb_) = corners[k], corners[(k + 1) % 4]
        faces.append([(xa_, ya_, z0), (xb_, yb_, z0), (xb_, yb_, z1), (xa_, ya_, z1)])

    def uv_of(n):
        if abs(n[2]) > 0.5:
            # The grain runs along the brace.
            return lambda q: ((q[0] * d[0] + q[1] * d[1]) / TILE + 0.5, (q[0] * p[0] + q[1] * p[1]) / TILE + 0.3)
        return straight(n)

    m.convex(faces, "timber", uv_of)


def stud(m, x, y, z, half, height):
    base = [(x - half, y - half, z), (x + half, y - half, z), (x + half, y + half, z), (x - half, y + half, z)]
    apex = (x, y, z + height)
    faces = [base] + [[base[k], base[(k + 1) % 4], apex] for k in range(4)]
    m.convex(faces, "iron", lambda n: straight(n))


def ring(m, centre, radius, tube, around=8, across=4):
    """A ring lying flat against the door, its faces turned out from the tube."""
    from parts import newell, sub

    cx, cy, cz = centre

    def at(i, j):
        a = 2 * math.pi * i / around
        b = 2 * math.pi * j / across
        r = radius + tube * math.cos(b)
        return (cx + r * math.cos(a), cy + r * math.sin(a), cz + tube * math.sin(b))

    for i in range(around):
        for j in range(across):
            quad = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]
            a = 2 * math.pi * (i + 0.5) / around
            core = (cx + radius * math.cos(a), cy + radius * math.sin(a), cz)
            mid = scale((sum(q[0] for q in quad), sum(q[1] for q in quad), sum(q[2] for q in quad)), 0.25)
            if dot(newell(quad), sub(mid, core)) < 0:
                quad = quad[::-1]
            m.face(quad, "iron", straight(newell(quad)))


# An open door stands at a right angle on its hinge at the doorway's left, swung toward the front.
PIVOT = (-0.68, 0.02)


def swung(p):
    x, y, z = p
    return (PIVOT[0] - (z - PIVOT[1]), y, PIVOT[1] + (x - PIVOT[0]))


PIECES = {
    "foundation": (foundation, 3),
    "wall": (wall, 4),
    "doorframe": (lambda level: opening("door", level), 3),
    "windowframe": (lambda level: opening("window", level), 3),
    "ceiling": (ceiling, 3),
    "pillar": (pillar, 3),
    "stairs": (stairs, 4),
    "door": (door, 3),
}

if __name__ == "__main__":
    for name, (make, levels) in PIECES.items():
        for level in range(levels):
            suffix = "" if level == 0 else f"_LOD{level}"
            # The coarsest level of each is a plain shape drawn in palette colours alone.
            uvs = level < levels - 1
            mesh = make(level)
            mesh.build(name + suffix, MATS, uvs=uvs)
            if name == "door":
                mesh.transformed(swung).build("door_open" + suffix, MATS, uvs=uvs)

# The far level of every tree, level 5: what the far layer draws of it out to kilometres (client/core/render/farnodes.ts,
# D259), its reach cut by its triangles. Each is a few closed solids in flat colours made to level 4's box, colours and
# masses, so a tree keeps its size, its spot and its tone where far meets near.
#
# A hammock tree's crown is a low dome: a lit top over a band of faces and a dark skirt, as wide each way as level 4's
# masses reach. Tried first and seen in the wood: two upright octahedra read as diamonds on a hill, a lens of three
# rings of three as cut crystal, a crown roofed over its masses' heads as a field of umbrellas paler than level 4, and
# clumps tipped as leaves lie as shards seen from above.

import math
from itertools import combinations, combinations_with_replacement

import broadleaf as bl
from kit import Mesh, add, cross, dot, mul, rng_for, rotate, sub, unit

LEVEL = 5


def pick(colours, light=0.42):
    """A face's colour by the way it looks, as the flat levels pick theirs: the first of `colours` on faces looking up
    more than `light`, the last on faces looking down, the middle one on the rest."""
    top, side, under = colours
    return lambda n: top if n[1] > light else under if n[1] < -0.3 else side


def painted(m, tris, colour):
    """Faces wound alike as one closed solid, turned outward, each coloured by `colour(normal)`."""
    volume = sum(dot(a, cross(b, c)) for a, b, c in tris)
    for a, b, c in tris:
        if volume < 0:
            b, c = c, b
        m.face([m.point(a), m.point(b), m.point(c)], colour(unit(cross(sub(b, a), sub(c, a)))))


def solid(m, tris):
    """Triangles (three points and a colour) wound alike, as one closed solid: turned over if that winding looks in."""
    volume = sum(dot(a, cross(b, c)) for (a, b, c), _ in tris)
    for (a, b, c), colour in tris:
        m.face([m.point(a), m.point(b), m.point(c)] if volume > 0 else [m.point(a), m.point(c), m.point(b)], colour)


def gem(centre, radius, tall, sides, tilt, turn):
    """The faces, wound alike, of a ring of `sides` points `radius` round `centre` with a point `tall` above and below
    it, the whole tipped `tilt` radians about a level axis `turn` radians round: an octahedron for four sides."""
    axis = (math.cos(turn), 0.0, math.sin(turn))

    def place(p):
        q = rotate(rotate(p, axis, tilt), (0.0, 1.0, 0.0), turn)
        return (centre[0] + q[0] * radius, centre[1] + q[1] * tall, centre[2] + q[2] * radius)

    ring = [place((math.cos(2 * math.pi * k / sides), 0.0, math.sin(2 * math.pi * k / sides))) for k in range(sides)]
    top, bottom = place((0.0, 1.0, 0.0)), place((0.0, -1.0, 0.0))
    return [(top, ring[k], ring[(k + 1) % sides]) for k in range(sides)] + [(bottom, ring[(k + 1) % sides], ring[k]) for k in range(sides)]


def fitted(gems, lo, hi):
    """Gems' faces stretched together on each axis to span from `lo` to `hi`."""
    pts = [p for g in gems for t in g for p in t]
    least = [min(p[k] for p in pts) for k in range(3)]
    most = [max(p[k] for p in pts) for k in range(3)]
    fit = lambda p: tuple(lo[k] + (p[k] - least[k]) * (hi[k] - lo[k]) / (most[k] - least[k]) for k in range(3))
    return [[tuple(fit(p) for p in t) for t in g] for g in gems]


def fin(m, foot, head, width, turn, colour):
    """A trunk or post as one triangle seen from both sides, from `width` across at its buried foot to a point in the
    crown."""
    across = (math.cos(turn) * width / 2, 0.0, math.sin(turn) * width / 2)
    a, b = add(foot, across), sub(foot, across)
    m.face([m.point(a), m.point(b), m.point(head)], colour)
    m.face([m.point(b), m.point(a), m.point(head)], colour)


def crown_of(near, lobes, count, colours):
    """Level 4's whole box, its crown's box, its masses largest first, and the height they are widest at."""
    box = box_of(near)
    lo, hi = box_of(near, colours)
    big = sorted(bl.masses(lobes, count), key=lambda l: -l.radii[0] ** 2 * l.radii[1])
    waist = sum(l.centre[1] * l.radii[0] ** 2 for l in big) / sum(l.radii[0] ** 2 for l in big)
    return box, lo, hi, big, waist


def broadleaf(near, lobes, colours, stem, trunk, seed):
    """A live oak or a fig, sixteen faces: a low dome on a trunk. Its waist is a ring of four points two fifths of the
    way up level 4's crown, each as far out as level 4's masses reach that way, its shoulder a ring of four three
    quarters as far out near the top, turned an eighth of a turn from the waist's; a flat top, and below a shallow fan
    to a point over the trunk, all stretched to the crown's box. The trunk is one face both sides drawn, `trunk` metres
    in radius."""
    m = Mesh(False)
    ((x0, y0, z0), _), lo, hi, big, waist = crown_of(near, lobes, 6, colours)
    rng = rng_for(seed, "far")
    centre = ((lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2)
    turn = rng.uniform(0, 2 * math.pi)
    ring = reach_ring(big, 4, lo[1] + 0.4 * (hi[1] - lo[1]), turn, centre)
    shoulder = [(centre[0] + (p[0] - centre[0]) * 0.75, p[1], centre[1] + (p[2] - centre[1]) * 0.75)
                for p in reach_ring(big, 4, lo[1] + 0.85 * (hi[1] - lo[1]), turn + math.pi / 4, centre)]
    under = (0.0, lo[1], 0.0)
    tris = [shoulder[:3], [shoulder[0], shoulder[2], shoulder[3]]]
    for i in range(4):
        j = (i + 1) % 4
        tris += [(ring[i], ring[j], shoulder[i]), (shoulder[i], ring[j], shoulder[j]), (ring[j], ring[i], under)]
    (dome,) = fitted([tris], lo, hi)
    painted(m, dome, pick(colours))
    fin(m, (0.0, y0, 0.0), (0.0, lo[1] + 0.35 * (hi[1] - lo[1]), 0.0), 2 * trunk, rng.uniform(0, math.pi), stem)
    return m


def delaunay(pts):
    """The triangles of the Delaunay triangulation of a few points on the ground (x, z), as index triples."""
    out = []
    n = len(pts)
    for i in range(n):
        for j in range(i + 1, n):
            for k in range(j + 1, n):
                (ax, az), (bx, bz), (cx, cz) = pts[i], pts[j], pts[k]
                d = 2 * (ax * (bz - cz) + bx * (cz - az) + cx * (az - bz))
                if abs(d) < 1e-9:
                    continue
                ux = ((ax * ax + az * az) * (bz - cz) + (bx * bx + bz * bz) * (cz - az) + (cx * cx + cz * cz) * (az - bz)) / d
                uz = ((ax * ax + az * az) * (cx - bx) + (bx * bx + bz * bz) * (ax - cx) + (cx * cx + cz * cz) * (bx - ax)) / d
                r2 = (ax - ux) ** 2 + (az - uz) ** 2
                if all((p[0] - ux) ** 2 + (p[1] - uz) ** 2 >= r2 - 1e-9 for q, p in enumerate(pts) if q not in (i, j, k)):
                    out.append((i, j, k))
    return out


def roofed(ring, peaks, under):
    """A crown's faces, wound outward: a ring of points round its waist, convex seen from above, roofed over `peaks`
    (points within it standing above it) and closed below by a fan to `under`. The roof's faces come first."""
    pts = ring + peaks
    up = (0.0, 1.0, 0.0)
    tris = []
    for i, j, k in delaunay([(p[0], p[2]) for p in pts]):
        a, b, c = pts[i], pts[j], pts[k]
        tris.append((a, b, c) if dot(cross(sub(b, a), sub(c, a)), up) > 0 else (a, c, b))
    for k in range(len(ring)):
        a, b = ring[k], ring[(k + 1) % len(ring)]
        tris.append((a, b, under) if dot(cross(sub(b, a), sub(under, a)), up) < 0 else (b, a, under))
    return tris


def reach_ring(masses, n, waist, turn, centre):
    """`n` points round a crown's waist, each as far out from `centre` (x, z) as level 4's masses reach that way."""
    out = []
    for k in range(n):
        a = turn + 2 * math.pi * k / n
        d = (math.cos(a), math.sin(a))
        r = max((l.centre[0] - centre[0]) * d[0] + (l.centre[2] - centre[1]) * d[1] + l.radii[0] for l in masses)
        out.append((centre[0] + d[0] * r, waist, centre[1] + d[1] * r))
    return out


def spanning(ring, lo, hi):
    """The ring stretched on x and z so it spans from `lo` to `hi`."""
    xs, zs = [p[0] for p in ring], [p[2] for p in ring]
    sx, sz = (hi[0] - lo[0]) / (max(xs) - min(xs)), (hi[2] - lo[2]) / (max(zs) - min(zs))
    return [(lo[0] + (p[0] - min(xs)) * sx, p[1], lo[2] + (p[2] - min(zs)) * sz) for p in ring]


def banyan(near, lobes, colours, stem, trunk, pillar, share=0.65):
    """A banyan, ten faces of roof and two for each post: its roof ridged along its length from a ring of four round its
    waist, the largest of its faces to `share` of its area in the light green and the rest in the middle one, its
    underside a shallow dark fan, over its trunk and its largest pillar if level 4 draws one (`pillar`: its foot,
    radius and depth). Lit, a flat roof all in the light green stands out paler than level 4's crown of many clumps."""
    m = Mesh(False)
    ((x0, y0, z0), _), lo, hi, big, waist = crown_of(near, lobes, 6, colours)
    light, mid, dark = colours
    centre = ((lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2)
    turn = 0.0 if hi[0] - lo[0] > hi[2] - lo[2] else math.pi / 2
    ring = spanning(reach_ring(big, 4, waist, turn + math.pi / 4, centre), lo, hi)
    along = (math.cos(turn), 0.0, math.sin(turn))
    half = 0.3 * max(hi[0] - lo[0], hi[2] - lo[2])
    ridge = (centre[0], hi[1], centre[1])
    under = (0.0, lo[1] + 0.5, 0.0)
    tris = roofed(ring, [add(ridge, mul(along, half)), sub(ridge, mul(along, half))], under)
    roof, skirt = tris[: -len(ring)], tris[-len(ring) :]
    area = lambda t: math.sqrt(sum(v * v for v in cross(sub(t[1], t[0]), sub(t[2], t[0])))) / 2
    lit, total = 0.0, sum(area(t) for t in roof)
    for t in sorted(roof, key=area, reverse=True):
        colour = light if lit < share * total else mid
        lit += area(t)
        m.face([m.point(p) for p in t], colour)
    for t in skirt:
        m.face([m.point(p) for p in t], dark)
    fin(m, (0.0, y0, 0.0), under, 2 * trunk, turn + math.pi / 2, stem)
    if pillar is not None:
        (px, pz), pr, depth = pillar
        fin(m, (px, depth, pz), (px, lo[1] + 0.5, pz), 2 * pr, turn, stem)
    return m


def mangrove(near, lobes, colours, roots, reach, seed):
    """A mangrove, twelve faces: its crown an octahedron tipped as a clump lies, spanning level 4's crown, on a
    three-sided pyramid of stilts `reach` metres out, closed below the ground."""
    m = Mesh(False)
    ((x0, y0, z0), _), lo, hi, big, waist = crown_of(near, lobes, 3, colours)
    rng = rng_for(seed, "far")
    middle = ((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2)
    turn = rng.uniform(0, 2 * math.pi)
    (crown,) = fitted([gem(middle, 1.0, 1.0, 4, rng.uniform(0.4, 0.55), turn)], lo, hi)
    painted(m, crown, pick(colours))
    under = (middle[0], lo[1] + 0.3 * (hi[1] - lo[1]), middle[2])
    base = [(reach * math.cos(a), y0, reach * math.sin(a)) for a in (turn + 2 * math.pi * k / 3 for k in range(3))]
    solid(m, [((under, base[k], base[(k + 1) % 3]), roots) for k in range(3)] + [((base[2], base[1], base[0]), roots)])
    return m


def palm(near, crown, foot, hub, r_foot, r_head, tips, stem, spread):
    """A palm, twelve faces: a stem from its buried `foot` to the `hub` of its crown, following its lean, and a star of
    three of level 4's fronds (`tips`, their drooping ends), each a blade from the hub out to its end `spread` radians
    across with both sides drawn. The three are those that reach nearest as far each way as level 4's fronds (its faces
    in the colours `crown`), and the star is stretched on the ground from the hub to reach exactly so far; their
    greens are those whose mean is nearest the mean of level 4's fronds."""
    m = Mesh(False)
    lo, hi = box_of(near, crown)
    # Where the young fronds stand above the hub, the star's middle is raised to their tips.
    hub = (hub[0], max(hub[1], hi[1]), hub[2])
    column(m, foot, hub, r_foot, r_head, stem)

    def blade(tip):
        out = sub(tip, hub)
        turned = lambda a: (hub[0] + out[0] * math.cos(a) - out[2] * math.sin(a), tip[1], hub[2] + out[0] * math.sin(a) + out[2] * math.cos(a))
        return (hub, turned(-spread / 2), turned(spread / 2))

    def scales(blades):
        """How far the star is stretched each way on x and z to meet level 4's reach: x less, x more, z less, z more."""
        pts = [p for b in blades for p in b]
        return [(lo[k] - hub[k]) / min(min(p[k] for p in pts) - hub[k], -1e-3) for k in (0, 2)] + [(hi[k] - hub[k]) / max(max(p[k] for p in pts) - hub[k], 1e-3) for k in (0, 2)]

    best = min(combinations([blade(t) for t in tips], 3), key=lambda bs: max(abs(math.log(max(s, 1e-3))) for s in scales(bs)))
    xl, zl, xm, zm = scales(best)
    stretch = lambda p: (hub[0] + (p[0] - hub[0]) * (xm if p[0] > hub[0] else xl), p[1], hub[2] + (p[2] - hub[2]) * (zm if p[2] > hub[2] else zl))
    for (a, b, c), colour in zip(best, nearest_mix(near, crown, 3)):
        a, b, c = stretch(a), stretch(b), stretch(c)
        m.face([m.point(a), m.point(b), m.point(c)], colour)
        m.face([m.point(a), m.point(c), m.point(b)], colour)
    return m


def linear(name):
    """A flat colour's name, f<rrggbb>, as linear red, green and blue."""
    c = [int(name[k : k + 2], 16) / 255 for k in (1, 3, 5)]
    return [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c]


def nearest_mix(mesh, colours, n):
    """`n` of the colours `mesh` wears among `colours` whose mean comes nearest the mean of its faces in them by area."""
    acc, total = [0.0, 0.0, 0.0], 0.0
    worn = set()
    for idx, mat, _, _ in mesh.faces:
        if mat not in colours:
            continue
        worn.add(mat)
        p = [mesh.points[i] for i in idx]
        for k in range(1, len(p) - 1):
            area = 0.5 * math.sqrt(sum(v * v for v in cross(sub(p[k], p[0]), sub(p[k + 1], p[0]))))
            acc = [a + area * c for a, c in zip(acc, linear(mat))]
            total += area
    want = [a / total for a in acc]
    mixes = combinations_with_replacement(sorted(worn), n)
    return min(mixes, key=lambda mix: sum((sum(linear(c)[k] for c in mix) / n - want[k]) ** 2 for k in range(3)))


def column(m, foot, head, r_foot, r_head, colour):
    """A three-sided stem from `foot` to `head`, closed by a cap at the head and by drawing its foot in to an edge, so it
    takes six triangles and has no hole. The foot is buried."""
    axis = unit(sub(head, foot))
    side = unit(cross(axis, (0.0, 0.0, 1.0) if abs(axis[2]) < 0.9 else (1.0, 0.0, 0.0)))
    other = cross(axis, side)

    def around(c, r, a):
        return add(c, add(mul(side, r * math.cos(a)), mul(other, r * math.sin(a))))

    # Its ends lie level, so a leaning stem reaches no further up or down than its head and its foot.
    t0, t1, t2 = ((c[0], head[1], c[2]) for c in (around(head, r_head, 2 * math.pi * k / 3) for k in range(3)))
    p, q = ((c[0], foot[1], c[2]) for c in (around(foot, r_foot, 0.0), around(foot, r_foot, math.pi)))
    solid(m, [((t0, t1, q), colour), ((t0, q, p), colour), ((t1, t2, q), colour), ((t2, t0, p), colour), ((t2, p, q), colour), ((t2, t1, t0), colour)])


def box_of(mesh, colours=None):
    """The least and most corner of the faces of `mesh` drawn in `colours` (all of them if None)."""
    pts = [mesh.points[i] for idx, mat, _, _ in mesh.faces if colours is None or mat in colours for i in idx]
    return [min(p[k] for p in pts) for k in range(3)], [max(p[k] for p in pts) for k in range(3)]

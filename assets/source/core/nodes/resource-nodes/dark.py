"""Bedrock seeps and broken obsidian in engine metres."""

from math import cos, sin, tau

from mathutils import Vector

from resource_uv import loft_uv, planar_uv


STONE = "rock_dark"
TAR = "bitumen"
GLASS = "obsidian"

OIL_BEDS = (
    ((0, .78, -.01, .02), (.07, .96, -.01, .02), (.16, 1, -.025, .015),
     (.28, .93, -.025, .025), (.32, .88, -.035, .035), (.40, .94, -.04, .015),
     (.54, .84, -.055, -.015), (.59, .77, -.075, -.04), (.66, .79, -.095, -.055),
     (.81, .65, -.15, -.07), (.93, .42, -.23, -.08), (.99, .18, -.24, -.08)),
    ((0, .79, -.035, -.02), (.08, .95, -.035, -.03), (.17, .98, -.04, -.04),
     (.27, .92, -.035, -.04), (.32, .87, -.015, -.055), (.43, .93, .01, -.065),
     (.55, .86, .045, -.08), (.61, .77, .075, -.09), (.68, .79, .11, -.10),
     (.81, .62, .14, -.12), (.92, .45, .21, -.14), (.99, .19, .26, -.14)),
)
OIL_STUMPS = (
    ((0, .76, -.035, .015), (.045, .91, -.045, .015), (.096, .94, -.035, .025),
     (.145, .87, -.05, .025), (.18, .78, -.075, .015), (.23, .69, -.14, -.03),
     (.26, .40, -.18, -.045), (.265, .15, -.21, -.04)),
    ((0, .77, -.015, -.02), (.05, .92, -.03, -.035), (.10, .95, -.025, -.03),
     (.145, .85, .015, -.06), (.18, .77, .055, -.07), (.23, .64, .095, -.09),
     (.255, .38, .19, -.12), (.26, .14, .22, -.14)),
)
OIL_SHOULDERS = ((.93, .82, .51), (.89, .75, 2.45))
OIL_ROWS = (
    (tuple(range(12)), (0, 1, 2, 3, 4, 5, 7, 9, 11), (0, 2, 4, 5, 7, 9, 11), (0, 2, 5, 8, 11)),
    (tuple(range(8)), (0, 1, 2, 4, 5, 7), (0, 2, 3, 5, 7), (0, 2, 4, 7)),
)
OIL_ANGLES = (48, 28, 18, 10)


def bed_point(row, theta, extents, broken):
    height, radius, x, z = row
    width, length, phase = extents
    edge = 1 + .057 * cos(3 * theta + phase) + .023 * sin(5 * theta - phase)
    edge += .024 * sin(theta * 2 - height * 4 + phase)
    shelf = .64 * sin(theta + phase) + .30 * sin(2 * theta - phase)
    if broken:
        shelf += .37 * sin(5 * theta + phase) * radius
    return Vector((x + width * radius * edge * cos(theta),
                   height + min(.16 if broken else .13, height * .32) * shelf,
                   z + length * radius * edge * sin(theta)))


def seep_surface(theta, lower, upper, phase, broken):
    band = (lower + upper) / 2
    drift = cos(theta + phase + .21 * band) + .39 * sin(3 * theta - phase)
    pocket = cos(2 * theta - phase - .31 * band) + .46 * sin(3 * theta + phase)
    if broken:
        return TAR if (1 <= band <= 4 and drift > .08) or (band > 4 and pocket > .87) else STONE
    return TAR if (1 <= band <= 4 and drift > -.14) or (4 < band <= 8 and pocket > .18) else STONE


def bed_normals(rings):
    count = len(rings[0])
    return [[(ring[(side + 1) % count] - ring[side - 1]).cross(
              rings[min(row + 1, len(rings) - 1)][side] - rings[max(row - 1, 0)][side]
            ).normalized() for side in range(count)] for row, ring in enumerate(rings)]


def oil(prop, variant, broken=False):
    profile = (OIL_STUMPS if broken else OIL_BEDS)[variant]
    extents = OIL_SHOULDERS[variant]
    phase = extents[2]
    level = prop.level
    rows = OIL_ROWS[broken][level]
    columns = OIL_ANGLES[level]
    angles = [-tau * side / columns for side in range(columns)]
    rings = [[bed_point(profile[row], theta, extents, broken) for theta in angles] for row in rows]
    charts = loft_uv(rings) if prop.textured else None
    normals = bed_normals(rings) if prop.textured else None
    origin = len(prop.points)
    prop.points.extend(point for ring in rings for point in ring)
    for row, (lower, upper) in enumerate(zip(rows, rows[1:])):
        first = origin + row * columns
        next_ring = first + columns
        for side, angle in enumerate(angles):
            after = (side + 1) % columns
            mat = seep_surface(angle - tau / (2 * columns), lower, upper, phase, broken)
            normal = None if normals is None else (
                normals[row][side], normals[row][after], normals[row + 1][after], normals[row + 1][side])
            prop.face((first + side, first + after, next_ring + after, next_ring + side), mat,
                      uv=charts[row][side] if charts else None, normal=normal)
    bottom = len(prop.points)
    top = bottom + 1
    peak = Vector((profile[-1][2], profile[-1][0] + (.018 if broken else .023), profile[-1][3]))
    prop.points.extend((Vector((0, 0, 0)), peak))
    for side in range(columns):
        after = (side + 1) % columns
        prop.face((origin + after, origin + side, bottom), STONE)
        crown = origin + (len(rings) - 1) * columns
        mat = TAR if broken and cos(angles[side] - phase) > .23 else STONE
        crown_normal = None if normals is None else (normals[-1][side], normals[-1][after], Vector((0, 1, 0)))
        prop.face((crown + side, crown + after, top), mat, normal=crown_normal)
    if broken:
        oil_spall(prop, variant)


def oil_rock_1(prop):
    oil(prop, 0)


def oil_rock_1_depleted(prop):
    oil(prop, 0, broken=True)


def oil_rock_2(prop):
    oil(prop, 1)


def oil_rock_2_depleted(prop):
    oil(prop, 1, broken=True)


# Each outline runs around a different fracture in the horizontal plane.
BLADE = ((-.78, .65), (.34, 1), (1, .04), (.34, -.93), (-.73, -.77))
WEDGE = ((-.91, .34), (-.17, .91), (.8, .56), (1, -.31), (-.38, -.86))
SLAB = ((-.97, .03), (-.35, .92), (.73, .69), (1, -.39), (-.37, -.91))
SPALL = ((-.80, .58), (.34, .82), (1, -.14), (-.49, -.86))


def oil_spall(prop, variant):
    x, z, height, tilt = ((.64, .49, .13, .12), (-.70, .33, .15, -.37))[variant]
    rings = [[Vector((x + a * scale * .22, y * (1 + a * tilt + b * .22), z + b * scale * .29))
              for a, b in WEDGE] for scale, y in ((.91, 0), (1, height * .38), (.75, height))]
    if prop.level >= 2:
        rings.pop(1)
    prop.shell(rings, STONE, planar_sides=True, cap_surface=TAR)


def shard(outline, center, extents, height, *, turn, lean, tilt, toe, rind):
    return outline, center, extents, height, turn, lean, tilt, toe, rind


OBSIDIAN_NODES = (
    (shard(BLADE, (-.27, -.12), (.57, .64), 1.15, turn=-.20, lean=(-.19, .04), tilt=(-.55, -.24), toe=.35, rind=(0, 3)),
     shard(WEDGE, (.35, -.05), (.47, .49), .78, turn=.29, lean=(.10, -.09), tilt=(.34, -.67), toe=.32, rind=(1, 2)),
     shard(SPALL, (.16, .41), (.43, .42), .41, turn=-.29, lean=(-.09, .04), tilt=(-.40, -.51), toe=.25, rind=(0, 1))),
    (shard(SLAB, (.025, -.14), (.775, .61), 1.02, turn=.13, lean=(.10, -.13), tilt=(.65, -.28), toe=.39, rind=(0, 4)),
     shard(BLADE, (-.42, .21), (.46, .49), .72, turn=-.08, lean=(-.05, .14), tilt=(-.63, .49), toe=.30, rind=(1, 3)),
     shard(SPALL, (.49, .31), (.35, .38), .49, turn=.51, lean=(.01, .13), tilt=(.39, .46), toe=.22, rind=(0, 1))),
)
OBSIDIAN_STUMPS = (
    (shard(BLADE, (-.23, -.12), (.60, .64), .31, turn=-.20, lean=(-.07, .02), tilt=(-.72, -.44), toe=.30, rind=(0, 3)),
     shard(WEDGE, (.39, -.06), (.44, .46), .23, turn=.29, lean=(.015, -.03), tilt=(.35, -.67), toe=.30, rind=(1, 2)),
     shard(SPALL, (.16, .42), (.41, .41), .19, turn=-.29, lean=(-.06, .04), tilt=(-.47, -.53), toe=.25, rind=(0, 1))),
    (shard(SLAB, (.01, -.14), (.79, .61), .29, turn=.13, lean=(.06, -.055), tilt=(.69, -.44), toe=.34, rind=(0, 4)),
     shard(BLADE, (-.42, .20), (.46, .48), .23, turn=-.08, lean=(-.04, .07), tilt=(-.65, .45), toe=.30, rind=(1, 3)),
     shard(SPALL, (.47, .32), (.37, .36), .17, turn=.51, lean=(.01, .05), tilt=(.40, .46), toe=.20, rind=(0, 1))),
)
OBSIDIAN_STEPS = ((5, 3, 2, 1), (4, 3, 2, 1), (3, 2, 1, 1))


def shard_rings(spec, level):
    outline, center, extents, height, turn, lean, tilt, toe, _ = spec
    cuts = [a * tilt[0] + b * tilt[1] for a, b in outline]
    lo, hi = min(cuts), max(cuts)
    crown = (.71, .70, .685, .65)[level]
    bevel = (1.06, 1.045, 1.01, .94)[level]
    crest = (1, .992, .98, .932)[level]
    rings = [[], [], []]
    for side, (a, b) in enumerate(outline):
        x, z = a * extents[0], b * extents[1]
        x, z = x * cos(turn) - z * sin(turn), x * sin(turn) + z * cos(turn)
        cut = (cuts[side] - lo) / (hi - lo)
        for row, (swell, shear, y) in enumerate((
            (.92, 0, 0),
            (bevel, .18, height * (toe + .12 * cut)),
            (crown + .08 * cut, .8 + .20 * cut, height * crest * (.48 + .52 * cut)),
        )):
            rings[row].append(Vector((center[0] + swell * x + shear * lean[0], y,
                                      center[1] + swell * z + shear * lean[1])))
    return rings


def edge_point(a, b, step, steps):
    if step == 0:
        return a
    if step == steps:
        return b
    if tuple(a) > tuple(b):
        a, b = b, a
        step = steps - step
    return a + (b - a) * (step / steps)


def fracture(prop, face, mat, steps, depth):
    start = len(prop.points)
    a, b, c = face
    ab, ac = b - a, c - a
    n = ab.cross(ac).normalized()
    offset = n * (27 * depth)
    normals = []
    rows = []
    for i in range(steps + 1):
        row = []
        for j in range(steps + 1 - i):
            u, v = i / steps, j / steps
            w = 1 - u - v
            if i == 0:
                point = edge_point(a, c, j, steps)
            elif j == 0:
                point = edge_point(a, b, i, steps)
            elif i + j == steps:
                point = edge_point(b, c, j, steps)
            else:
                point = a + ab * u + ac * v + offset * (u * v * w)
            row.append(len(prop.points) - start)
            prop.points.append(point)
            if prop.textured and depth:
                du = ab + offset * (v * (w - u))
                dv = ac + offset * (u * (w - v))
                normals.append(du.cross(dv).normalized())
        rows.append(row)
    uv = planar_uv(prop.points[start:], normal=n) if prop.textured else None

    def emit(indices):
        prop.face(tuple(start + index for index in indices), mat,
                  uv=[uv[index] for index in indices] if uv else None,
                  normal=[normals[index] for index in indices] if normals else None)

    for i in range(steps):
        for j in range(steps - i):
            emit((rows[i][j], rows[i + 1][j], rows[i][j + 1]))
            if j < steps - i - 1:
                emit((rows[i][j + 1], rows[i + 1][j], rows[i + 1][j + 1]))


def obsidian(prop, variant, broken=False):
    for piece, spec in enumerate((OBSIDIAN_STUMPS if broken else OBSIDIAN_NODES)[variant]):
        rings = shard_rings(spec, prop.level)
        count = len(rings[0])
        steps = OBSIDIAN_STEPS[piece][prop.level]
        for row, (lower, upper) in enumerate(zip(rings, rings[1:])):
            for side in range(count):
                after = (side + 1) % count
                mat = STONE if (row == 0 and side in spec[-1]) or (broken and row == 1 and side == 0) else GLASS
                scar = (.012 + .008 * ((side + piece) % 3)) if row and mat == GLASS else 0
                if broken:
                    scar *= .32
                fracture(prop, (lower[side], lower[after], upper[side]), mat, steps, -.66 * scar)
                fracture(prop, (lower[after], upper[after], upper[side]), mat, steps, -scar)
        for side in range(1, count - 1):
            fracture(prop, (rings[0][0], rings[0][side + 1], rings[0][side]), STONE, steps, 0)
            mat = GLASS if piece < 2 or side > 1 else STONE
            fracture(prop, (rings[-1][0], rings[-1][side], rings[-1][side + 1]), mat, steps,
                     -.011 if not broken else -.005)


def obsidian_rock_1(prop):
    obsidian(prop, 0)


def obsidian_rock_1_depleted(prop):
    obsidian(prop, 0, broken=True)


def obsidian_rock_2(prop):
    obsidian(prop, 1)


def obsidian_rock_2_depleted(prop):
    obsidian(prop, 1, broken=True)

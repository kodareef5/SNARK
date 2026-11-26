"""Build two cupped bivalves and their open, empty shells in metres."""

from math import cos, hypot, pi, sin, tau

from mathutils import Vector

SHELL = "clam_shell"
LIP = "clam_lip"
PEARL = "pearl"

STATIONS = (
    ((.23, .47, .73, 1), (.38, .75, 1)),
    ((.32, .69, 1), (.43, .81, 1)),
    ((.55, 1), (.63, 1)),
    ((1,), (1,)),
)

# The giant clam's flutes sweep across the outer edge before the rim returns along the mouth.
GIANT_RIM = (
    (-.226, .014, 0), (-.208, .061, .3), (-.176, .095, 1), (-.147, .076, -1),
    (-.114, .114, 1), (-.087, .088, -1), (-.054, .123, 1), (-.025, .096, -1),
    (.008, .127, 1), (.039, .101, -1), (.070, .123, 1), (.103, .093, -1),
    (.131, .111, 1), (.160, .077, -1), (.186, .083, .8), (.208, .058, -.2),
    (.226, .018, 0), (.200, .001, 0), (.163, .020, 1), (.128, .012, -.8),
    (.092, .032, 1), (.054, .018, -1), (.017, .039, 1), (-.021, .022, -1),
    (-.057, .034, 1), (-.099, .013, -1), (-.139, .025, .8), (-.189, .004, 0),
)

GIANT_SAMPLES = (
    tuple(range(28)),
    (0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 22, 26),
    (0, 2, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24),
    (0, 2, 4, 7, 8, 11, 14, 16, 22, 26),
)

SCALLOP_EARS = (
    (.092, .048), (.115, .014), (.110, .002), (0, .003), (-.119, .001), (-.127, .015), (-.096, .048),
)

EAR_SAMPLES = (
    tuple(range(7)),
    (0, 2, 3, 4, 6),
    (0, 2, 4, 6),
    (0, 2, 4, 6),
)


def rotate(point, angle):
    x, y, z = point
    return Vector((x * cos(angle) - z * sin(angle), y, x * sin(angle) + z * cos(angle)))


def disk(prop, rings, center, surface, forward):
    center_point, center_uv = center
    start = len(prop.points)
    count = len(rings[0])
    prop.points.append(center_point)
    prop.points.extend(point for ring in rings for point, _ in ring)
    charts = [center_uv, *(uv for ring in rings for _, uv in ring)]
    faces = [(0, 1 + i, 1 + (i + 1) % count) for i in range(count)]
    for row in range(1, len(rings)):
        lower = 1 + (row - 1) * count
        upper = lower + count
        for i in range(count):
            next_i = (i + 1) % count
            faces.append((lower + i, upper + i, upper + next_i, lower + next_i))
    if not forward:
        faces = [face[::-1] for face in faces]
    normals = None
    if prop.textured:
        normals = [Vector((0, 0, 0)) for _ in charts]
        for face in faces:
            origin = prop.points[start + face[0]]
            area = Vector((0, 0, 0))
            for a, b in zip(face[1:], face[2:]):
                area += (prop.points[start + a] - origin).cross(prop.points[start + b] - origin)
            for i in face:
                normals[i] += area
        normals = [normal.normalized() for normal in normals]
    for face in faces:
        prop.face(tuple(start + i for i in face), surface, uv=[charts[i] for i in face],
                  normal=tuple(normals[i] for i in face) if normals is not None else None)
    return start + 1 + (len(rings) - 1) * count


def valve(prop, rim, center_z, place, *, forward=True):
    outer_stations, inner_stations = STATIONS[prop.level]

    def vertex(edge, radius, inside):
        x, z, rise, rib = edge
        edge_scale = 1 if inside else 1.027
        run_x = x * radius * edge_scale
        run_z = (z - center_z) * radius * edge_scale
        height = rise * radius ** 1.7
        if not inside:
            height += rib * radius * sin(pi * radius) - (.018 - .008 * radius)
        point = place(run_x, height, center_z + run_z)
        chord = hypot(run_x, run_z)
        stretch = hypot(chord, height) / chord if chord > 0 else 1
        return point, (run_x * stretch, center_z + run_z * stretch)

    center = (0, center_z, 0, 0)
    outer_rings = [[vertex(edge, radius, False) for edge in rim] for radius in outer_stations]
    inner_rings = [[vertex(edge, radius, True) for edge in rim] for radius in inner_stations]
    outer_start = disk(prop, outer_rings, vertex(center, 0, False), SHELL, not forward)
    inner_start = disk(prop, inner_rings, vertex(center, 0, True), LIP, forward)
    count = len(rim)
    run = 0
    for i in range(count):
        next_i = (i + 1) % count
        a, b, c, d = (outer_start + i, outer_start + next_i, inner_start + next_i, inner_start + i)
        end = run + (prop.points[b] - prop.points[a]).length
        uv = ((run, 0), (end, 0), (end, (prop.points[c] - prop.points[b]).length),
              (run, (prop.points[d] - prop.points[a]).length))
        face = (a, b, c, d)
        prop.face(face if forward else face[::-1], LIP, uv=uv if forward else uv[::-1])
        run = end


def pearls(prop, locations, angle):
    count, latitudes, total = ((6, 3, 3), (5, 2, 3), (4, 1, 2), (4, 1, 2))[prop.level]
    for index, (x, y, z, radius) in enumerate(locations[:total]):
        center = rotate((x, y, z), angle)
        start = len(prop.points)
        rings = []
        for row in range(latitudes):
            latitude = -pi / 2 + (row + 1) * pi / (latitudes + 1)
            ring = []
            for side in range(count):
                heading = (side + .17 * row + .22 * index) * tau / count
                width = radius * cos(latitude) * (1 + .052 * sin(3 * heading + row))
                point = Vector((width * cos(heading), radius * .87 * sin(latitude), -width * sin(heading)))
                ring.append((len(prop.points), point.normalized()))
                prop.points.append(center + point)
            rings.append(ring)
        bottom = (len(prop.points), Vector((0, -1, 0)))
        prop.points.append(center + bottom[1] * radius * .87)
        top = (len(prop.points), Vector((0, 1, 0)))
        prop.points.append(center + top[1] * radius * .87)
        for side in range(count):
            next_side = (side + 1) % count
            faces = [(bottom, rings[0][next_side], rings[0][side]),
                     (top, rings[-1][side], rings[-1][next_side])]
            for lower, upper in zip(rings, rings[1:]):
                faces.append((lower[side], lower[next_side], upper[next_side], upper[side]))
            for face in faces:
                indices, normals = zip(*face)
                prop.face(indices, PEARL, normal=normals if prop.textured else None)


def giant(prop, depleted):
    angle = .159
    front = (.018, .050, .075) if not depleted else (.018, .038, .061)
    rear = (.026, .098, .153) if not depleted else (.020, .043, .069)
    fold = (1, .94, .81, .62)[prop.level]
    samples = GIANT_SAMPLES[prop.level]
    if depleted and prop.level == 2:
        samples = tuple(index for index in samples if index != 14)
    for sign, (floor, lip, crest) in ((1, front), (-1, rear)):
        rim = []
        for index in samples:
            x, z, ridge = GIANT_RIM[index]
            rise = lip + (crest - lip) * min(1, z / .118) - floor
            rise += (.011 * ridge * fold + .009 * sign * x / .226)
            if depleted:
                z = z * 1.13 + .004
            rim.append((x, z, rise, -.008 * ridge * fold))

        def place(x, height, z):
            return rotate((x, floor + height, sign * z), angle)

        valve(prop, rim, .068 if not depleted else .076, place, forward=sign > 0)
    if not depleted:
        pearls(prop, ((-.066, .051, .056, .032), (.029, .052, .053, .027), (.094, .045, .059, .023)), angle)


def scallop_rim(level):
    count = (21, 11, 8, 6)[level]
    fold = (1, .81, .62, .45)[level]
    rim = []
    for i in range(count):
        angle = (2 * i / (count - 1) - 1) * 2.55
        rib = (1 if i % 2 == 0 else -1) * sin(pi * i / (count - 1)) ** .45 * fold
        rim.append(((.209 + .009 * rib) * sin(angle), .151 + (.149 + .012 * rib) * cos(angle), rib))
    rim.extend((*SCALLOP_EARS[i], 0) for i in EAR_SAMPLES[level])
    return rim


def scallop(prop, depleted):
    angle = -.141
    hinge = -.153 if not depleted else -.014
    outline = scallop_rim(prop.level)
    lower = [(x, z, .020 + .021 * min(1, z / .27) + .006 * rib + .010 * x / .21, -.010 * rib)
             for x, z, rib in outline]
    upper = [(x, z, .024 + .010 * z / .31 + .008 * rib, -.013 * rib) for x, z, rib in outline]

    def bottom(x, height, z):
        reach = 1 if not depleted else .56
        return rotate((x, .018 + height, hinge + reach * z), angle)

    def lid(x, height, z):
        if depleted:
            return rotate((.90 * x, .020 + height + .006 * x / .21, hinge - .51 * z), angle)
        lift = (.138 + .074 * x / .21) * z / .31
        reach = .50 - .13 * x / .21
        return rotate((.93 * x, .054 + lift - height, hinge + reach * z), angle)

    valve(prop, lower, .145, bottom)
    valve(prop, upper, .145, lid, forward=False)
    if not depleted:
        pearls(prop, ((-.080, .058, .055, .031), (.008, .063, .081, .028), (.078, .054, .037, .023)), angle)


def clam_1(prop):
    giant(prop, False)


def clam_1_depleted(prop):
    giant(prop, True)


def clam_2(prop):
    scallop(prop, False)


def clam_2_depleted(prop):
    scallop(prop, True)

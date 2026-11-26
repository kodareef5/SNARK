"""Build the reinforced equipment trunk in four authored levels."""

from mathutils import Vector

from hand_geometry import Y, rounded_outline

IRON = "crate_iron"
RUBBER = "crate_rubber"
BRONZE = "crate_bronze"

BODY = (
    ((0, 1.14, 0.90, 0.10), (0.065, 1.28, 1.04, 0.115),
     (0.132, 1.34, 1.08, 0.12), (0.205, 1.24, 0.98, 0.105),
     (0.738, 1.24, 0.98, 0.105), (0.808, 1.31, 1.055, 0.105),
     (0.893, 1.30, 1.05, 0.10)),
    ((0, 1.14, 0.90, 0.10), (0.110, 1.34, 1.08, 0.12),
     (0.205, 1.24, 0.98, 0.105), (0.738, 1.24, 0.98, 0.105),
     (0.893, 1.30, 1.05, 0.10)),
    ((0, 1.14, 0.90, 0.10), (0.110, 1.34, 1.08, 0.12),
     (0.205, 1.24, 0.98, 0.105), (0.738, 1.24, 0.98, 0.105),
     (0.893, 1.30, 1.05, 0.10)),
    ((0, 1.14, 0.90, 0.10), (0.160, 1.30, 1.03, 0.11),
     (0.893, 1.30, 1.03, 0.11)),
)

LID = (
    ((0.859, 1.29, 1.045, 0.10), (0.900, 1.39, 1.13, 0.112),
     (0.939, 1.39, 1.13, 0.112), (0.976, 1.325, 1.055, 0.095),
     (1.013, 1.355, 1.08, 0.104), (1.077, 1.355, 1.08, 0.104),
     (1.119, 1.25, 1.00, 0.10)),
    ((0.859, 1.29, 1.045, 0.10), (0.920, 1.39, 1.13, 0.112),
     (0.981, 1.35, 1.07, 0.10), (1.077, 1.35, 1.07, 0.10),
     (1.119, 1.25, 1.00, 0.10)),
    ((0.859, 1.29, 1.045, 0.10), (0.924, 1.39, 1.13, 0.112),
     (1.070, 1.35, 1.07, 0.10), (1.135, 1.25, 1.00, 0.10)),
    ((0.859, 1.29, 1.045, 0.10), (0.937, 1.39, 1.13, 0.112),
     (1.190, 1.25, 1.00, 0.10)),
)


def rectangle(width, height):
    x, y = width / 2, height / 2
    return [(-x, y), (x, y), (x, -y), (-x, -y)]


def case_sections(stations):
    return [[Vector((x, y, z)) for x, z in rounded_outline(width, depth, clip)]
            for y, width, depth, clip in stations]


def carry_well(prop, outer):
    start, end = (prop.points[index] for index in outer[:2])
    across = (end - start).normalized()
    center = (start + end) * 0.5
    center.y = 0.582
    inward = Vector((-1 if center.x > 0 else 1, 0, 0))
    detailed = prop.textured
    stations = [(0, 0.450, 0.250), (0.077, 0.370, 0.170)]
    if prop.textured:
        stations.insert(1, (0.031, 0.405, 0.204))
    loops = []
    for depth, width, height in stations:
        outline = rounded_outline(width, height, 0.041) if detailed else rectangle(width, height)
        first = len(prop.points)
        prop.points.extend(center + across * u + inward * depth - Y * v
                           for u, v in outline)
        loops.append(tuple(range(first, first + len(outline))))

    mouth = loops[0]
    for side, lower in enumerate(outer):
        following = (side + 1) % 4
        if detailed:
            prop.face((lower, outer[following], mouth[2 * side + 1], mouth[2 * side]), IRON)
            prop.face((outer[following], mouth[2 * following], mouth[2 * side + 1]), IRON)
        else:
            prop.face((lower, outer[following], mouth[following], mouth[side]), IRON)
    count = len(mouth)
    for outside, inside in zip(loops, loops[1:]):
        for side in range(count):
            following = (side + 1) % count
            prop.face((outside[side], outside[following], inside[following], inside[side]), RUBBER)
    prop.face(loops[-1], RUBBER)


def lower_shell(prop):
    rings = case_sections(BODY[prop.level])
    start = len(prop.points)
    count = len(rings[0])
    prop.points.extend(point for ring in rings for point in ring)
    well_band = (3, 2, 2, 1)[prop.level]
    foot_bands = 2 if prop.level == 0 else 1
    for row in range(len(rings) - 1):
        lower = start + row * count
        upper = lower + count
        for side in range(count):
            following = (side + 1) % count
            face = (lower + side, lower + following, upper + following, upper + side)
            if row == well_band and side in (2, 6):
                carry_well(prop, face)
            else:
                finish = RUBBER if row < foot_bands or side % 2 else IRON
                prop.face(face, finish)
    prop.face(tuple(reversed(range(start, start + count))), RUBBER)
    top = start + (len(rings) - 1) * count
    prop.face(tuple(range(top, top + count)), IRON)


def lid(prop):
    rings = case_sections(LID[prop.level])
    rim = 2 if prop.level == 0 else 1
    prop.shell(rings, RUBBER, cap_surface=IRON, planar_sides=True,
               band_surfaces=[RUBBER] * rim + [IRON] * (len(rings) - 1 - rim))
    if prop.level == 3:
        return
    top = LID[prop.level][-1][0]
    if prop.level == 0:
        outline = rounded_outline(0.31, 0.27, 0.065)
        stations = [(top - 0.025, 0.82), (top + 0.025, 1), (1.190, 0.76)]
    else:
        outline = rectangle(0.27, 0.23)
        stations = [(top - 0.025, 1), (1.190, 0.80)]
    for x in (-0.49, 0.49):
        for z in (-0.36, 0.36):
            prop.panel((x, 0, z), outline, stations, RUBBER)


def face_fitting(prop, center, outline, stations, surface):
    x, y, z = center
    sign = 1 if z > 0 else -1
    rings = [[(x + u * scale, y - sign * v * scale, z + sign * depth) for u, v in outline]
             for depth, scale in stations]
    prop.shell(rings, surface, planar_sides=True)


def case_hardware(prop):
    close = prop.level == 0
    for x in (-0.37, 0.37):
        if prop.textured:
            rim = rounded_outline(0.204, 0.278, 0.037)
            stations = [(0, 0.86), (0.038, 1), (0.073, 0.85)] if close else [(0, 1), (0.068, 0.85)]
            face_fitting(prop, (x, 0.866, 0.50), rim, stations, RUBBER)
        latch = rounded_outline(0.138, 0.214, 0.031) if close else rectangle(0.138, 0.214)
        z = 0.553 if prop.textured else 0.505
        latch_depth = 0.078 if prop.level == 2 else 0.048
        face_fitting(prop, (x, 0.865, z), latch, [(0, 1), (latch_depth, 0.83)], BRONZE)
        if close:
            face_fitting(prop, (x, 0.967, 0.568), rectangle(0.154, 0.057),
                         [(0, 1), (0.028, 0.86)], IRON)
        if prop.textured:
            hinge = rounded_outline(0.224, 0.134, 0.033) if close else rectangle(0.224, 0.134)
            stations = [(0, 0.86), (0.033, 1), (0.067, 0.83)] if close else [(0, 1), (0.063, 0.83)]
            face_fitting(prop, (x, 0.911, -0.51), hinge, stations, RUBBER)
        if prop.level < 3:
            rib = (rounded_outline(0.174, 0.510, 0.051) if prop.textured else rectangle(0.150, 0.448))
            stations = [(0, 0.86), (0.043, 1), (0.075, 0.77)] if close else [(0, 1), (0.063, 0.82)]
            for z in (-0.477, 0.477):
                face_fitting(prop, (x, 0.449, z), rib, stations, IRON)


def carry_grips(prop):
    if prop.level == 0:
        path = ((0.637, -0.162), (0.586, -0.162), (0.543, -0.122),
                (0.543, 0.122), (0.586, 0.162), (0.637, 0.162))
        sides = 6
    else:
        path = ((0.637, -0.182), (0.543, -0.122), (0.543, 0.122), (0.637, 0.182))
        sides = 4
    for side in (-1, 1):
        if prop.level == 0:
            for z in (-0.162, 0.162):
                prop.panel((side * 0.563, 0, z), rectangle(0.070, 0.062),
                           [(0.604, 1), (0.662, 0.94)], RUBBER)
        prop.cord([(side * 0.582, y, z) for y, z in path], 0.027, sides, IRON)


def event_crate(prop):
    lower_shell(prop)
    lid(prop)
    case_hardware(prop)
    if prop.textured:
        carry_grips(prop)

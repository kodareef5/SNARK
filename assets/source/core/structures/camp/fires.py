"""Stone hearths, torch and cooking pot in the structure's centered bounds."""

from math import cos, pi, sin, tau
from random import Random

from hand_geometry import Vector, Y, rounded_outline


def stone(prop, center, footprint, height, heading, phase, surface="stone"):
    x, y, z = center
    width, depth = footprint
    count = (12, 8, 6, 5)[prop.level]
    sections = (
        ((0, .79), (.19, .94), (.48, 1), (.77, .9), (1, .66)),
        ((0, .8), (.24, .97), (.58, .96), (1, .67)),
        ((0, .81), (.47, 1), (1, .69)),
        ((0, .86), (1, .78)),
    )[prop.level]
    c, s = cos(heading), sin(heading)
    rings = []
    for rise, scale in sections:
        ring = []
        for side in range(count):
            angle = tau * side / count
            cut = scale * (1 + .10 * sin(3 * angle + phase) + .05 * cos(5 * angle + phase))
            u = cos(angle) * cut * width / 2
            v = -sin(angle) * cut * depth / 2
            ring.append((x + u * c - v * s + rise * height * .12 * cos(phase),
                         y + rise * height, z + u * s + v * c))
        rings.append(ring)
    prop.shell(rings, surface, planar_sides=True)


def billet(prop, start, end, radius, phase, surface):
    start, end = Vector(start), Vector(end)
    run = end - start
    sections = (
        ((0, .75), (.06, .99), (.25, 1.02), (.57, .95), (.93, .87), (1, .65)),
        ((0, .8), (.08, 1), (.88, .89), (1, .71)),
        ((0, .88), (.28, .99), (1, .75)),
        ((0, .91), (1, .83)),
    )[prop.level]
    prop.tube(start, run.normalized(), [(t * run.length, r * radius) for t, r in sections],
              (10, 8, 6, 5)[prop.level], surface, smooth=False, oval=.76, wobble=.12, phase=phase)


def fuel_bed(prop, center, width, depth, height, surface, pieces):
    marks = ((0, -.14, .98), (-.23, .16, .82), (.22, .17, .77), (.32, -.20, .66),
             (-.34, -.20, .71), (.05, .33, .60), (-.10, -.35, .60), (.32, .32, .52))
    x, y, z = center
    for i, (a, b, size) in enumerate(marks[:pieces[prop.level]]):
        stone(prop, (x + a * width, y, z + b * depth),
              (.48 * width * size, .55 * depth * size), height * size, i * .86, i, surface)


def flame(prop, center, radius, height, lean, phase):
    x, y, z = center
    bend_x, bend_z = lean
    sections = (
        ((0, .80), (.21, 1), (.51, .69), (.76, .40), (1, .035)),
        ((0, .84), (.23, 1), (.59, .62), (1, .045)),
        ((0, .92), (.38, .88), (1, .055)),
        ((0, .96), (1, .09)),
    )[prop.level]
    count = (12, 8, 6, 4)[prop.level]
    rings = []
    for rise, spread in sections:
        ring = []
        for side in range(count):
            angle = tau * side / count + phase + .4 * rise
            r = radius * spread * (1 + .12 * sin(3 * angle + rise))
            ring.append((x + r * cos(angle) + bend_x * rise ** 1.55,
                         y + rise * height, z - r * sin(angle) + bend_z * rise ** 1.55))
        rings.append(ring)
    prop.shell(rings, "ember", planar_sides=True)


def campfire(prop, lit):
    ground = -.1875
    rng = Random(39)
    for side in range(10):
        angle = side * tau / 10 + rng.uniform(-.06, .06)
        radius = rng.uniform(.354, .378)
        stone(prop, (radius * cos(angle), ground, radius * sin(angle)),
              (rng.uniform(.175, .219), rng.uniform(.213, .267)),
              rng.uniform(.116, .185), angle, rng.uniform(0, tau))
    surface = "ember" if lit else "coal"
    fuel_bed(prop, (0, ground + .007, 0), .47, .48, .087, surface, (7, 6, 4, 2))
    logs = (
        ((-.205, -.122, -.185), (.179, -.106, .148), .059, .16),
        ((.207, -.091, -.156), (-.172, -.065, .193), .057, .55),
        ((-.248, -.064, .087), (.204, -.033, .045), .056, .34),
        ((.129, -.067, .214), (-.085, -.01, -.162), .045, .72),
        ((-.12, -.084, -.229), (.143, -.095, .193), .038, .25),
    )
    for start, end, radius, phase in logs[:(5, 4, 3, 3)[prop.level]]:
        billet(prop, start, end, radius, phase, "wood")
    if lit:
        flame(prop, (.01, -.035, .017), .105, .218, (-.04, -.018), .16)
        flame(prop, (-.106, -.065, -.016), .062, .193, (.03, .035), .65)
        flame(prop, (.106, -.077, -.028), .064, .166, (.036, -.018), .34)


def standing_torch(prop, lit):
    ground = -.9
    surface = "ember" if lit else "coal"
    count = (12, 8, 6, 5)[prop.level]
    shaft = (
        ((0, .076), (.04, .083), (.19, .063), (.43, .056), (.79, .053), (1.17, .052),
         (1.28, .044), (1.41, .058), (1.52, .074)),
        ((0, .077), (.045, .082), (.32, .058), (.88, .054), (1.30, .047), (1.52, .074)),
        ((0, .079), (.10, .073), (.60, .054), (1.30, .048), (1.52, .072)),
        ((0, .080), (.30, .056), (1.30, .046), (1.52, .075)),
    )[prop.level]
    prop.tube((-.009, ground, .008), Y, shaft, count, "wood", smooth=False, oval=.92, wobble=.08)
    for i in range(3):
        angle = i * tau / 3 + .31
        x, z = .103 * cos(angle), .103 * sin(angle)
        prop.panel((x, ground, z), rounded_outline(.073, .081, .022) if prop.level < 2
                   else [(-.035, .035), (.035, .035), (.035, -.035), (-.035, -.035)],
                   ((0, .91), (.11, 1), (.174, .62)) if prop.level == 0 else ((0, 1), (.166, .62)),
                   "wood")
    for i in range((7, 5, 4, 3)[prop.level]):
        angle = .18 + i * tau / ((7, 5, 4, 3)[prop.level])
        x, z = cos(angle), sin(angle)
        tip = (.108 * x - .009, .585 + .017 * sin(3 * angle), .108 * z + .008)
        billet(prop, (.042 * x - .009, .319, .042 * z + .008), tip, .025, angle, "wood")
    wraps = ((.37, .070), (.393, .078), (.417, .088), (.455, .093), (.477, .097))
    for height, width in wraps[:(5, 3, 2, 1)[prop.level]]:
        collar = ((-.014, width * .83), (-.010, width * 1.04), (.009, width * 1.02), (.014, width * .83))
        if prop.level >= 2:
            collar = ((-.017, width), (.017, width * 1.05))
        prop.tube((-.009, height, .008), Y, collar, count, "hide", smooth=False, oval=.97)
    stone(prop, (-.009, .471, .008), (.176, .174), .164, .18, .93, surface)
    if lit:
        flame(prop, (-.016, .553, .013), .086, .347, (.047, -.037), .13)
        flame(prop, (-.079, .549, .018), .044, .242, (-.033, .012), .44)
        flame(prop, (.050, .539, .009), .052, .219, (.021, .027), .72)


def bail(prop):
    count = (10, 8, 6, 5)[prop.level]
    segments = (18, 11, 7, 4)[prop.level]
    rings = []
    for i in range(segments + 1):
        angle = pi * i / segments
        c, s = cos(angle), sin(angle)
        ring = []
        for side in range(count):
            section = tau * side / count
            spread = .014 * cos(section)
            ring.append(((.337 + spread) * c, .143 + (.188 + spread) * s,
                         .037 * s - .014 * sin(section)))
        rings.append(ring)
    prop.shell(rings, "iron", smooth=True)


def cooking_pot(prop, lit):
    ground = -.35
    surface = "ember" if lit else "coal"
    count = (20, 16, 12, 8)[prop.level]
    pot = (
        ((-.174, .111), (-.166, .159), (-.132, .218), (-.084, .258), (-.03, .289),
         (.051, .308), (.075, .300), (.108, .293), (.139, .319), (.158, .327),
         (.173, .312), (.173, .288), (.123, .273), (-.044, .240), (-.133, .139)),
        ((-.174, .111), (-.149, .188), (-.076, .266), (.044, .307), (.104, .295),
         (.157, .326), (.173, .311), (.168, .284), (.024, .263), (-.133, .139)),
        ((-.174, .111), (-.109, .232), (.038, .307), (.149, .326),
         (.173, .303), (.146, .277), (-.133, .139)),
        ((-.174, .114), (.030, .306), (.171, .321), (.171, .285), (-.125, .143)),
    )[prop.level]
    prop.tube((0, 0, .022), Y, pot, count, "iron", oval=.92)
    for i in range(3):
        angle = (pi / 2) + tau * i / 3
        x, z = cos(angle), sin(angle)
        profile = (
            ((0, .72), (.025, .83), (.095, .86), (.164, 1), (.211, .8)),
            ((0, .74), (.039, .84), (.161, 1), (.211, .82)),
            ((0, .75), (.12, .94), (.211, .83)),
            ((0, .77), (.211, .89)),
        )[prop.level]
        rings = []
        sides = (8, 7, 6, 4)[prop.level]
        for rise, size in profile:
            inset = .201 - .42 * rise
            rings.append([(x * inset + .038 * size * cos(tau * k / sides),
                           ground + rise,
                           .022 + z * inset - .035 * size * sin(tau * k / sides))
                          for k in range(sides)])
        prop.shell(rings, "iron", planar_sides=True)
    for x in (-.313, .313):
        prop.panel((x, .112, .021), rounded_outline(.113, .083, .024),
                   ((-.035, .75), (-.010, 1), (.062, .91)) if prop.level == 0
                   else ((-.031, .75), (.058, .95)), "iron")
    bail(prop)
    for i, (x, z, width, depth, height, heading) in enumerate((
        (-.269, -.015, .209, .185, .136, .5), (-.219, .207, .22, .201, .146, .8),
        (.151, .257, .237, .20, .144, -.28), (.268, .078, .21, .19, .127, 1.4),
        (-.246, -.219, .18, .195, .089, .1), (.23, -.205, .18, .15, .081, .7),
    )[:(6, 5, 4, 4)[prop.level]]):
        stone(prop, (x, ground, z), (width, depth), height, heading, i + 2)
    fuel_bed(prop, (.006, ground + .006, -.065), .49, .46, .073, surface, (5, 4, 3, 2))
    if lit:
        flame(prop, (-.046, -.315, -.204), .053, .214, (.042, .025), .28)
        flame(prop, (.091, -.326, -.174), .063, .205, (-.017, -.019), .12)
        flame(prop, (-.132, -.317, -.065), .053, .186, (.023, -.021), .43)


def masonry(prop, low, high, bevel=.035):
    x0, y0, z0 = low
    x1, y1, z1 = high
    width, depth, height = x1 - x0, z1 - z0, y1 - y0
    if prop.level < 2:
        outline = rounded_outline(width, depth, bevel)
    else:
        w, d = width / 2, depth / 2
        outline = [(-w, d), (w, d), (w, -d), (-w, -d)]
    stations = ((0, .93), (min(bevel * .7, height * .2), 1), (height, .96))
    if prop.level > 0:
        stations = ((0, 1), (height, .97))
    prop.panel(((x0 + x1) / 2, y0, (z0 + z1) / 2), outline, stations, "stone")


def vault(prop):
    spring = -.385
    count = (9, 7, 5, 3)[prop.level]
    arc_points = (4, 3, 2, 2)[prop.level]
    for wedge in range(count):
        start, end = pi * wedge / count, pi * (wedge + 1) / count
        angles = [start + (end - start) * i / (arc_points - 1) for i in range(arc_points)]
        outer = .758 + .011 * sin(wedge * 7)
        # The larger arch has visible joints over a continuous inner stone liner.
        seam = .017 if prop.level < 2 else .0
        front_angles = [angle + seam * (1 - 2 * i / (arc_points - 1)) for i, angle in enumerate(angles)]
        perimeter = [(r * cos(a), spring + r * sin(a)) for r, stops in
                     ((outer, front_angles), (.535, reversed(front_angles))) for a in stops]
        middle = (start + end) / 2
        midpoint = (.655 * cos(middle), spring + .655 * sin(middle))
        depth = -.426 + .016 * cos(wedge * 3)
        profile = ((depth, .93), (depth + .022, 1), (-.16, .95))
        if prop.level > 0:
            profile = ((depth, .99), (.31 if prop.level == 3 else -.17, 1))
        rings = [[(midpoint[0] + (x - midpoint[0]) * scale,
                   midpoint[1] + (y - midpoint[1]) * scale, z)
                  for x, y in perimeter] for z, scale in profile]
        prop.shell(rings, "stone", planar_sides=True)
    count = (5, 5, 3, 0)[prop.level]
    for wedge in range(count):
        start, end = pi * wedge / count, pi * (wedge + 1) / count
        # The liner steps back, keeping a dark reveal inside the opening.
        angles = (start, (start + end) / 2, end)
        perimeter = [(r * cos(a), spring + r * sin(a)) for r, stops in
                     ((.765, angles), (.548, reversed(angles))) for a in stops]
        prop.shell([[(x, y, z) for x, y in perimeter] for z in (-.225, .32)], "stone", planar_sides=True)


def fireplace(prop, lit):
    ground = -1.2
    surface = "ember" if lit else "coal"
    masonry(prop, (-.9, ground, -.5), (.9, -.972, .481), .059)
    masonry(prop, (-.828, -.993, .21), (.828, .412, .47))
    masonry(prop, (-.77, -.974, .192), (.77, .274, .233), .008)
    vault(prop)
    for side in (-1, 1):
        for i in range((4, 3, 2, 1)[prop.level]):
            courses = (4, 3, 2, 1)[prop.level]
            base = -.983 + .986 * i / courses
            top = -.983 + .986 * (i + 1) / courses + .006
            edge = .84 + .023 * sin(i * 2.6 + side)
            upright = .558 + .02 * sin(i * 3 + side)
            left, right = sorted((side * upright, side * edge))
            masonry(prop, (left, base, -.396 + .018 * cos(i + side)), (right, top, .25))
        shoulders = ((.584, .832, -.374, .115, .388), (.722, .848, -.355, -.13, .371))
        for x0, x1, z, y0, y1 in shoulders[:1 if prop.level == 3 else 2]:
            a, b = sorted((side * x0, side * x1))
            masonry(prop, (a, y0, z), (b, y1, .23))
    masonry(prop, (-.794, .291, -.362), (.794, .469, .44))
    masonry(prop, (-.883, .397, -.486), (.883, .538, .474), .056)
    masonry(prop, (-.722, .510, -.355), (.722, .666, .449), .065)
    masonry(prop, (-.620, .627, -.275), (.62, .795, .445), .066)
    masonry(prop, (-.486, .759, -.213), (.486, .911, .435), .049)
    masonry(prop, (-.388, .867, -.158), (.388, 1.101, .422))
    masonry(prop, (-.452, 1.079, -.209), (.452, 1.2, .45), .035)
    if prop.level < 2:
        rows = ((.513, .648, -.369, .675), (.656, .783, -.288, .579),
                (.781, .894, -.224, .452))
        for row, (bottom, top, front, half) in enumerate(rows[:3 if prop.level == 0 else 2]):
            stretches = (3 + row % 2) if prop.level == 0 else 2
            for i in range(stretches):
                left = -half + 2 * half * i / stretches
                right = -half + 2 * half * (i + 1) / stretches
                offset = .009 * sin(row * 11 + i * 3)
                masonry(prop, (left + .01, bottom + offset, front + offset),
                        (right - .01, top + offset, front + .099), .025)
    fuel_bed(prop, (0, -.982, -.077), .82, .53, .161, surface, (3, 3, 2, 1))
    for start, end, radius, phase in (
        ((-.31, -.892, -.196), (.30, -.868, -.087), .080, .21),
        ((.267, -.863, -.179), (-.272, -.804, .061), .073, .72),
        ((-.236, -.805, -.154), (.23, -.75, -.008), .068, .35),
    )[:(3, 3, 2, 2)[prop.level]]:
        billet(prop, start, end, radius, phase, "wood")
    if lit:
        flame(prop, (-.047, -.824, -.155), .167, .565, (.066, .012), .63)
        flame(prop, (.196, -.863, -.138), .132, .414, (.032, .062), .37)
        flame(prop, (-.234, -.884, -.208), .115, .337, (.04, .009), .81)

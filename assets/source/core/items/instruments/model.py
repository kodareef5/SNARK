"""Six field instruments, built around the palm in engine metres."""

from math import cos, radians, sin, tau

from mathutils import Matrix, Vector

from geometry import Instrument, X, Y, Z, panel_rings, rounded_outline


def barrel(prop, rows, sides, surface, **options):
    prop.tube((0, 0, 0), Z, rows, sides, surface, **options)


def spiral(prop, start, end, radius, turns, surface, *, angle=0, strands=12, cord=0.002):
    steps = round(turns * strands)
    path = []
    for index in range(steps + 1):
        fraction = index / steps
        a = angle + fraction * turns * tau
        path.append((radius * cos(a), radius * sin(a), start + (end - start) * fraction))
    prop.cord(path, cord, 5, surface)


def crossed_seam(prop, z, width, radius, count, angle, surface):
    for index in range(count):
        a = angle + tau * index / count
        for lean in (-1, 1):
            path = []
            for fraction in (0, 0.5, 1):
                around = a + (fraction - 0.5) * 0.31 * lean
                r = radius + 0.0016 * sin(fraction * tau / 2)
                path.append((r * cos(around), r * sin(around), z + (fraction - 0.5) * width))
            prop.cord(path, 0.0016, 4, surface)


def spyglass(prop):
    level = prop.level
    sides = (32, 18, 12, 8)[level]
    housing = [(-0.085, 0.025, "wood"), (-0.043, 0.028, "hide"), (-0.039, 0.033, "hide"),
               (0.059, 0.036, "hide"), (0.064, 0.031, "wood"),
               (0.115, 0.034, "wood"), (0.121, 0.043, "wood"), (0.131, 0.041, "wood"),
               (0.204, 0.047, "hide"), (0.210, 0.052, "hide"), (0.249, 0.055, "hide"),
               (0.253, 0.049, "wood"), (0.262, 0.050, "wood")]
    if level == 2:
        housing = [housing[i] for i in (0, 2, 3, 4, 6, 8, 9, 10, 12)]
    if level == 3:
        housing = [housing[i] for i in (0, 2, 4, 6, 12)]
    barrel(prop, [(z, radius) for z, radius, _ in housing], sides, "wood",
           band_surfaces=[surface for _, _, surface in housing[:-1]], wobble=0.017 if level < 2 else 0)
    if level == 0:
        crossed_seam(prop, 0.012, 0.017, 0.0342, 8, 0.33, "flax")
        crossed_seam(prop, 0.230, 0.024, 0.0539, 10, 0.09, "flax")

    eyecup = [(-0.101, 0.017), (-0.109, 0.022), (-0.109, 0.028), (-0.101, 0.030),
              (-0.086, 0.028), (-0.075, 0.024)]
    if level == 2:
        eyecup = [eyecup[i] for i in (1, 3, 5, 0)]
    if level == 3:
        eyecup = [eyecup[i] for i in (2, 3, 5)]
    barrel(prop, eyecup, sides, "eyecup", closed=True)
    if level < 2:
        barrel(prop, [(-0.101, 0.0175), (-0.095, 0.020)], sides, "spy_lens",
               cap_basis=(X, Y))
    front = [(0.248, 0.051), (0.255, 0.056), (0.278, 0.058), (0.285, 0.053),
             (0.284, 0.046), (0.274, 0.045), (0.261, 0.048)]
    if level == 3:
        barrel(prop, [(0.247, 0.050), (0.275, 0.057), (0.284, 0.046)], sides, "objective_rim",
               cap_surface="spy_lens")
        return
    if level == 2:
        front = [front[i] for i in (0, 2, 3, 5)]
    barrel(prop, front, sides, "objective_rim", closed=True)
    lens = [(0.263, 0.047), (0.273, 0.047), (0.277, 0.040), (0.279, 0.025)]
    if level == 1:
        lens = [lens[i] for i in (0, 1, 3)]
    if level > 1:
        lens = [(0.263, 0.0465), (0.275, 0.0465)]
    barrel(prop, lens, sides, "spy_lens", cap_basis=(X, Y), project_from=1 if level < 2 else None)


def stone_head(prop):
    outline = [(-0.061, -0.015), (-0.049, -0.028), (-0.005, -0.037), (0.086, -0.043),
               (0.104, -0.029), (0.103, 0.032), (0.088, 0.043), (0.017, 0.049),
               (-0.037, 0.032), (-0.063, 0.010)]
    if prop.level == 3:
        outline = [outline[index] for index in (0, 2, 4, 5, 7, 9)]
    sections = [(-0.036, 0.83), (-0.028, 1), (0.023, 0.98), (0.036, 0.83)]
    if prop.level > 1:
        sections = [sections[0], sections[1], sections[-1]]
    rings = [[Vector((x, y * scale, 0.238 + z * scale)) for y, z in outline]
             for x, scale in sections]
    prop.shell(rings, "stone", cap_surface="stamp", cap_origin=Vector((0.036, 0.054, 0.238)),
               cap_basis=(Y, Z), planar_sides=True)


def template_hammer(prop):
    level = prop.level
    sides = (14, 10, 8, 6)[level]
    center = (0, -0.005, 0)
    haft = [(-0.096, 0.017), (-0.066, 0.018), (0.043, 0.017), (0.131, 0.014),
            (0.214, 0.020), (0.268, 0.022), (0.283, 0.018)]
    if level == 3:
        haft = [haft[index] for index in (0, 2, 5, 6)]
    prop.tube(center, Z, haft, sides, "wood", oval=0.86, wobble=0.039)
    stone_head(prop)

    grip = [(-0.073, 0.019), (-0.065, 0.023), (0.016, 0.0215), (0.046, 0.019)]
    if level == 3:
        grip = [grip[0], grip[1], grip[-1]]
    prop.tube(center, Z, grip, sides, "hide", oval=0.9, wobble=0.018)
    pommel = [(-0.107, 0.021), (-0.101, 0.026), (-0.084, 0.028), (-0.077, 0.021)]
    if level == 3:
        pommel = [pommel[0], pommel[2], pommel[-1]]
    prop.tube(center, Z, pommel, sides, "stone", smooth=False, phase=0.2, wobble=0.06)

    if level < 3:
        barrel(prop, [(0.170, 0.020), (0.177, 0.025), (0.203, 0.025), (0.210, 0.022)],
               sides, "flax", oval=0.84)
        for flip in (-1, 1):
            paths = [
                [(0.019, -0.021, 0.194), (0.029, -0.007, 0.211), (0.037, 0.011, 0.253), (0.037, 0.026, 0.267),
                 (0.018, 0.026, 0.277), (-0.023, 0.019, 0.272)],
                [(0.021, 0.020, 0.196), (0.029, 0.015, 0.211), (0.041, -0.008, 0.252), (0.035, -0.022, 0.270),
                 (0.018, -0.024, 0.277), (-0.023, -0.020, 0.272)],
            ]
            for path_index, path in enumerate(paths):
                if level == 2 and path_index == 1:
                    continue
                if flip < 0 and level == 2:
                    continue
                prop.cord([(flip * x, y, z) for x, y, z in path], 0.0052, 5 if level == 0 else 4, "flax")
        if level == 0:
            spiral(prop, 0.174, 0.203, 0.0238, 4.0, "flax", cord=0.0024)
            crossed_seam(prop, 0, 0.012, 0.0226, 6, 0.25, "flax")
        if level < 2:
            for z in (-0.073, 0.042):
                barrel(prop, [(z - 0.004, 0.021), (z, 0.025), (z + 0.004, 0.021)], sides, "flax", oval=0.87)


def compass(prop):
    level = prop.level
    sides = (32, 20, 12, 8)[level]
    center = (0, 0, 0.030)
    body = [(-0.018, 0.049), (-0.015, 0.056), (0.012, 0.058), (0.021, 0.053)]
    if level > 1:
        body = [body[0], body[2], body[3]]
    prop.tube(center, Y, body, sides, "iron", oval=1.13)
    rim = [(0.017, 0.050), (0.021, 0.054), (0.027, 0.052), (0.025, 0.046), (0.020, 0.045)]
    if level > 1:
        rim = [rim[0], rim[2], rim[3], rim[4]]
    if level == 3:
        rim = [rim[0], rim[2], rim[3]]
    prop.tube(center, Y, rim, sides, "bronze", oval=1.13, closed=True)
    prop.tube(center, Y, [(0.020, 0.047), (0.0247, 0.047)], sides, "dial", oval=1.13, cap_basis=(-X, Z))

    loop = [(-0.004, 0.020), (0.005, 0.020), (0.007, 0.013), (-0.005, 0.013)]
    prop.tube((0, 0, 0.101), Y, loop, (16, 12, 8, 6)[level], "bronze", oval=1.21, closed=True)
    if level < 2:
        prop.panel((0, 0.004, -0.036), rounded_outline(0.027, 0.017, 0.004),
                   [(-0.006, 0.85), (0, 1), (0.005, 0.82)], "bronze")
        if level == 0:
            prop.tube((0, 0, 0.030), Y, [(0.024, 0.005), (0.029, 0.004)], 12, "bronze")
            prop.tube((-0.048, -0.006, 0.024), Z,
                      [(-0.018, 0.004), (-0.017, 0.006), (0.017, 0.006), (0.018, 0.004)], 8, "bronze")
    else:
        arrow = [(0, 0.031), (0.009, -0.001), (-0.009, -0.001)]
        prop.panel((0, 0.025, 0.030), arrow, [(-0.0011, 0.95), (0.0005, 1)], "north")


def magnifying_glass(prop):
    level = prop.level
    sides = (36, 22, 10, 6)[level]
    lens_scale = (1, 1, 0.95, 0.93)[level]
    grip = [(-0.083, 0.015), (-0.074, 0.020), (-0.031, 0.021), (0.033, 0.017), (0.069, 0.012)]
    if level > 1:
        grip = [grip[0], grip[2], grip[-1]]
    barrel(prop, grip, (16, 10, 8, 6)[level], "wood", oval=0.82, wobble=0.035)
    barrel(prop, [(0.035, 0.017), (0.040, 0.019), (0.065, 0.016), (0.068, 0.014)],
           (16, 10, 8, 6)[level], "flax", oval=0.82)
    if level == 0:
        spiral(prop, 0.041, 0.064, 0.0155, 3.0, "flax", strands=10, cord=0.0021)
    if level < 2:
        barrel(prop, [(-0.086, 0.015), (-0.082, 0.019), (-0.073, 0.020), (-0.069, 0.019)],
               14 if level == 0 else 8, "bronze", oval=0.84)
    prop.panel((0, 0, 0.073), rounded_outline(0.029, 0.054, 0.004),
               [(-0.011, 0.81), (-0.007, 1), (0.010, 0.93)] if level < 3 else [(-0.010, 0.89), (0.010, 1)],
               "bronze")
    rim = [(-0.012, 0.061), (-0.008, 0.069), (0.010, 0.069), (0.014, 0.066),
           (0.014, 0.060), (0.008, 0.058), (-0.007, 0.058), (-0.012, 0.060)]
    if level > 0:
        rim = [rim[i] for i in ((0, 2, 3, 5, 6) if level == 1 else (0, 2, 4, 6) if level == 2 else (0, 2, 4))]
    prop.tube((0, 0, 0.149), Y, [(height, radius * lens_scale) for height, radius in rim],
              sides, "bronze", closed=True)
    lens = [(-0.007, 0.039), (-0.006, 0.059), (0.007, 0.059), (0.010, 0.049), (0.012, 0.030)]
    if level == 1:
        lens = [lens[i] for i in (0, 2, 4)]
    if level > 1:
        lens = [(-0.006, 0.060), (0.010, 0.061)]
    prop.tube((0, 0, 0.149), Y, [(height, radius * lens_scale) for height, radius in lens],
              sides, "hand_lens", cap_basis=(-X, Z),
              project_from=2 if level == 0 else 1 if level == 1 else None)
    if level == 0:
        for x in (-0.061, 0.061):
            prop.tube((x, 0, 0.149), Y, [(0.010, 0.007), (0.014, 0.006), (0.015, 0.005)], 10, "dark_screw")


def receiver_panel(prop, center, width, length, outline_clip, surface):
    outline = rounded_outline(width, length, outline_clip)
    inset = rounded_outline(width - 0.008, length - 0.008, outline_clip * 0.9)
    if prop.level == 1:
        rings = panel_rings(center, outline, [(-0.003, 0.96), (0.003, 1)])
        rings += panel_rings(center, inset, [(0.007, 1)])
        prop.shell(rings, "rubber", cap_surface=surface, cap_origin=Vector(center), cap_basis=(-X, Z),
                   planar_sides=True)
    else:
        prop.panel(center, outline, [(-0.003, 0.96), (0.003, 1), (0.006, 0.92)], "rubber")
        prop.panel(center, inset, [(0.004, 0.99), (0.007, 1)], surface)


def radio(prop):
    level = prop.level
    outline = rounded_outline(0.083, 0.166, 0.009)
    center = (0, 0, 0.024)
    body = [(-0.023, 0.89), (-0.018, 1), (0.018, 1), (0.023, 0.93)]
    if level > 0:
        body = [body[index] for index in (0, 2, 3)]
    prop.panel(center, outline, body, "iron")
    antenna = [(0.100, 0.013), (0.116, 0.011), (0.125, 0.0075), (0.180, 0.0050), (0.251, 0.0035), (0.258, 0.0033)]
    if level == 1:
        antenna = [antenna[i] for i in (0, 2, 3, 5)]
    elif level == 2:
        antenna = [antenna[i] for i in (0, 2, 4, 5)]
    elif level == 3:
        antenna = [(0.100, 0.011), (0.203, 0.004)]
    prop.tube((-0.025, -0.003, 0), Z, antenna, (16, 10, 8, 6)[level], "rubber")
    knob = [(0.099, 0.012), (0.113, 0.011), (0.119, 0.009)]
    if level == 1:
        knob = [knob[0], knob[-1]]
    prop.tube((0.022, 0, 0), Z, knob, (16, 8, 8, 6)[level], "rubber")
    if level < 2:
        receiver_panel(prop, (0, 0.021, 0.036), 0.064, 0.118, 0.007, "receiver")
        rails = [(-0.032, 0.65), (-0.015, 1), (0.014, 0.84)] if level == 0 else [(-0.032, 0.79), (0.014, 0.93)]
        for x in (-0.035, 0.035):
            prop.panel((x, -0.004, 0.018), rounded_outline(0.016, 0.127, 0.005), rails, "rubber")
        rocker = [(-0.014, 0.86), (0.007, 1), (0.011, 0.8)] if level == 0 else [(-0.014, 0.86), (0.011, 0.96)]
        prop.panel((0.041, 0.001, 0.050), rounded_outline(0.013, 0.046, 0.005), rocker, "talk_button")
        clip = [(0.018, -0.032), (0.025, -0.033), (0.025, -0.028),
                (0.019, -0.027), (-0.014, -0.028), (-0.017, -0.022), (-0.022, -0.022), (-0.019, -0.032)]
        if level == 1:
            clip = [clip[i] for i in (0, 1, 2, 4, 6, 7)]
        prop.shell([[Vector((x, y, z + 0.029)) for y, z in clip] for x in (-0.010, 0.010)],
                   "iron", planar_sides=True)
    else:
        outline = rounded_outline(0.056, 0.103, 0.006)
        prop.panel((0, 0.022, 0.040), outline, [(-0.001, 0.97), (0.004, 1)], "receiver")
        outline = rounded_outline(0.046, 0.030, 0.004)
        prop.panel((0, 0.026, 0.073), outline, [(-0.0008, 0.98), (0.0010, 1)], "navigator")


def gps(prop):
    level = prop.level
    outline = rounded_outline(0.113, 0.154, 0.019)
    steps = [(-0.021, 0.9), (-0.014, 1), (0.017, 1), (0.023, 0.92)]
    if level > 0:
        steps = [steps[0], steps[2], steps[3]]
    prop.panel((0, 0, 0.024), outline, steps, "amber")
    if level < 3:
        bumpers = [(-0.025, 0.88), (-0.016, 1), (0.018, 1), (0.023, 0.90)]
        if level == 1:
            bumpers = [bumpers[i] for i in (0, 2, 3)]
        elif level == 2:
            bumpers = [(-0.025, 0.93), (0.023, 0.94)]
        for z in (-0.039, 0.085):
            prop.panel((0, 0, z), rounded_outline(0.118, 0.031, 0.009), bumpers, "rubber")
    if level < 2:
        receiver_panel(prop, (0, 0.018, 0.039), 0.094, 0.096, 0.009, "navigator")
        for i, x in enumerate((-0.029, 0, 0.029)):
            width = 0.022 if i == 1 else 0.019
            outline = rounded_outline(width, 0.019, 0.004)
            profile = [(-0.007, 0.96), (-0.002, 1), (0.001 + i % 2 * 0.001, 0.83)]
            if level == 1:
                w, h = width * 0.43, 0.008
                outline = [(-w, h), (w, h), (w, -h), (-w, -h)]
                profile = [profile[0], (profile[-1][0], 1)]
            prop.panel((x, 0.026, -0.030), outline, profile, "rubber")
        if level == 0:
            for x in (-0.040, 0.040):
                prop.tube((x, 0, -0.034), Y, [(0.020, 0.0038), (0.023, 0.0034)], 8, "dark_screw")
    else:
        prop.panel((0, 0.023, 0.039), rounded_outline(0.087, 0.083, 0.009),
                   [(-0.001, 0.95), (0.002, 1)], "navigator")
        path = [(-0.022, 0.031), (-0.013, 0.031), (0.015, -0.025), (0.006, -0.025)]
        prop.panel((0, 0.025, 0.039), path, [(-0.001, 1), (0.0015, 0.94)], "route")


def rest_pose(name):
    pitch = {"spyglass": -4.25, "template_hammer": -1.8, "magnifying_glass": 1.8}.get(name, 0)
    roll = 90 if name == "template_hammer" else 0
    return Matrix.Rotation(radians(pitch), 3, "X") @ Matrix.Rotation(radians(roll), 3, "Z")


for build in (spyglass, template_hammer, compass, magnifying_glass, radio, gps):
    for level in range(4):
        prop = Instrument(level)
        build(prop)
        prop.build(build.__name__)
        prop.build(f"{build.__name__}_ground", rotation=rest_pose(build.__name__), grounded=True)

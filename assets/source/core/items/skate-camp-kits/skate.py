"""The placed skate obstacles in their centred collision frames."""

from math import hypot

from mathutils import Vector


def rectangle(x, z, half_x, half_z, y, clip=None):
    if clip is None:
        outline = ((-half_x, half_z), (half_x, half_z), (half_x, -half_z), (-half_x, -half_z))
    else:
        c = abs(clip)
        corner = c if clip > 0 else 0
        outline = ((-half_x + c, half_z), (half_x - corner, half_z),
                   (half_x, half_z - c), (half_x, -half_z + corner),
                   (half_x - c, -half_z), (-half_x + corner, -half_z),
                   (-half_x, -half_z + c), (-half_x, half_z - corner))
    return [(x + u, y, z + v) for u, v in outline]


def stack(prop, x, z, stations, finish, **options):
    prop.shell([rectangle(x, z, width, depth, y, *clip) for y, width, depth, *clip in stations],
               finish, planar_sides=True, **options)


def across(prop, left, right, section, finish):
    prop.shell([[(x, y, z) for y, z in section] for x in (left, right)], finish, planar_sides=True)


KICKER_FLOOR = -.25
KICKER_DEPTH = .034
KICKER_TOE = -.8
KICKER_HEEL = .8
KICKER_NOSE = -.67


def kicker_top(z):
    return z * .5 / 1.6


def kicker_deck(prop):
    seams = (
        (-.53, -.36, -.18, -.02, .14, .29, .45, .62),
        (-.42, -.12, .20, .52),
        (),
        (),
    )[prop.level]
    planks = (KICKER_TOE, KICKER_NOSE, *seams, KICKER_HEEL)
    section = [(kicker_top(z), z) for z in planks]
    section.extend(((kicker_top(KICKER_HEEL) - KICKER_DEPTH, KICKER_HEEL),
                    (KICKER_FLOOR, (KICKER_FLOOR + KICKER_DEPTH) * 1.6 / .5)))
    start = len(prop.points)
    count = len(section)
    prop.points.extend(Vector((x, y, z)) for x in (-.6, .6) for y, z in section)
    rim = (count - 1, *range(count - 2))
    heel = count - 2
    for a, b in zip(rim, rim[1:]):
        prop.face((start + heel, start + b, start + a), "wood")
        prop.face((start + count + heel, start + count + a, start + count + b), "wood")
    incline = hypot(1, .5 / 1.6)
    for i in range(count):
        j = (i + 1) % count
        face = (start + i, start + j, start + count + j, start + count + i)
        if i < len(planks) - 1:
            offset = i * .053
            prop.face(face, "rubber" if i == 0 else "wood",
                      uv=[(-.6, section[i][1] * incline + offset), (-.6, section[j][1] * incline + offset),
                          (.6, section[j][1] * incline + offset), (.6, section[i][1] * incline + offset)])
        else:
            prop.face(face, "wood")


def kicker_stringer(prop, x, width, start, end, chamfer):
    heel = kicker_top(end) - KICKER_DEPTH
    toe = kicker_top(start) - KICKER_DEPTH
    section = [(KICKER_FLOOR + min(chamfer, .012), start), (toe, start), (heel, end),
               (KICKER_FLOOR + chamfer, end)]
    if chamfer:
        section.extend(((KICKER_FLOOR, end - chamfer), (KICKER_FLOOR, start + chamfer)))
    across(prop, x - width, x + width, section, "wood")


def kicker_tie(prop, z, depth, width, height, feet):
    front, back = z - depth, z + depth
    top_front = kicker_top(front) - KICKER_DEPTH
    top_back = kicker_top(back) - KICKER_DEPTH
    bottom = KICKER_FLOOR if feet else top_front - height
    section = [(bottom, front), (top_front, front), (top_back, back), (bottom, back)]
    across(prop, -width, width, section, "wood")


def zzzzzzskate_kicker(prop):
    kicker_deck(prop)
    if prop.level == 3:
        kicker_tie(prop, .68, .055, .49, .18, True)
        return
    stringers = ((-.52, -.18, .18, .52), (-.52, .52), (-.49, .49))[prop.level]
    for x in stringers:
        kicker_stringer(prop, x, .036 if prop.level < 2 else .05, -.63, .71, .025 if prop.level < 2 else 0)
    ties = ((-.42, -.07, .08, .24, .49, .74), (-.33, .26, .70), (.70,))[prop.level]
    for z in ties:
        kicker_tie(prop, z, .035, .56, .065, z > .66)


def bar_section(level, width):
    section = [(.225, -.025), (.225, .025)]
    if level == 0:
        section.extend(((.211, .025), (.196, .023), (.181, width + .002)))
    elif level == 1:
        section.extend(((.197, .025), (.181, width + .003)))
    elif level == 2:
        section.append((.188, .025))
    return [*section, (.175, width), (.175, -width), *((y, -z) for y, z in reversed(section[2:]))]


def grind_bar(prop):
    positive = (
        ((1.27, .015), (1.312, .019), (1.35, .021), (1.388, .019), (1.43, .015), (1.479, .016), (1.5, .018)),
        ((1.30, .016), (1.40, .021), (1.473, .016), (1.5, .018)),
        ((1.31, .017), (1.40, .021), (1.5, .018)),
        ((1.5, .025),),
    )[prop.level]
    stations = [*((-x, width) for x, width in reversed(positive)), *positive]
    prop.shell([[(x, y, z) for y, z in bar_section(prop.level, width)] for x, width in stations],
               "iron", planar_sides=True)


def zzzzzzskate_rail(prop):
    grind_bar(prop)
    stations = (
        ((-.225, .028, .028, .004), (-.212, .03, .03, .004), (-.185, .03, .03, .005),
         (-.164, .023, .023, .004), (.137, .023, .024, .004), (.175, .03, .03, -.005)),
        ((-.225, .028, .028), (-.208, .03, .03), (-.181, .03, .03),
         (-.157, .023, .023), (.137, .023, .024), (.175, .03, .03)),
        ((-.225, .03, .03), (-.188, .027, .027), (.175, .03, .03)),
        ((-.225, .03, .03), (-.188, .03, .03), (.175, .03, .03)),
    )[prop.level]
    bands = ["rubber"] * (2 if prop.level < 2 else 1)
    bands.extend(["iron"] * (len(stations) - 1 - len(bands)))
    for x in (-1.35, 1.35):
        stack(prop, x, 0, stations, "rubber", cap_surface="iron", band_surfaces=bands)


def zzzzzzskate_ledge(prop):
    coping = (
        ((.118, 1.153, .254, .022), (.127, 1.169, .271, .019), (.146, 1.196, .297, .013),
         (.175, 1.2, .30, .007), (.2, 1.2, .30, -.009)),
        ((.118, 1.155, .256, .021), (.135, 1.178, .277, .017), (.161, 1.2, .30, .008),
         (.2, 1.2, .30, -.009)),
        ((.118, 1.156, .256), (.134, 1.181, .281), (.158, 1.2, .30), (.2, 1.2, .30)),
        ((.118, 1.16, .26), (.2, 1.2, .30)),
    )[prop.level]
    stack(prop, 0, 0, coping, "stone")
    body = (
        ((-.164, 1.02, .168), (-.14, 1.093, .193), (.062, 1.093, .193),
         (.093, 1.123, .228), (.118, 1.123, .228)),
        ((-.158, 1.06, .183), (.086, 1.096, .214), (.118, 1.116, .224)),
        ((-.2, 1.11, .228), (-.148, 1.13, .245), (.088, 1.09, .216), (.118, 1.12, .235)),
        ((-.2, 1.03, .147), (.118, 1.13, .195)),
    )[prop.level]
    stack(prop, 0, 0, body, "wood")
    if prop.level > 1:
        return
    runners = (
        ((-.2, 1.082, .038, .013), (-.187, 1.126, .057, .015),
         (-.114, 1.126, .057, .013), (-.095, 1.106, .043, .012)),
        ((-.2, 1.09, .043), (-.181, 1.12, .056), (-.10, 1.12, .053)),
    )[prop.level]
    for z in (-.166, .166):
        stack(prop, 0, z, runners, "wood")
    if prop.level == 0:
        for x in (-.985, .985):
            stack(prop, x, 0, ((-.18, .063, .186), (-.153, .082, .218), (-.102, .082, .218)), "wood")

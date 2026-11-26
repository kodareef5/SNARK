"""Closed exterior meshes for three fictional throwables."""

from hand_geometry import Z, rounded_outline


def _canister(prop, profile, reduced, sides, *, oval=1):
    rows = profile if prop.level == 0 else [profile[index] for index in reduced[prop.level - 1]]
    prop.tube((0, 0, 0), Z, [(length, radius) for length, radius, _ in rows],
              sides[prop.level], rows[0][2], oval=oval,
              cap_surface=rows[-1][2], band_surfaces=[surface for _, _, surface in rows[:-1]])


def grenade_smoke(prop):
    profile = [
        (-0.075, 0.022, "iron"), (-0.066, 0.029, "iron"), (-0.057, 0.029, "iron"),
        (-0.047, 0.026, "orange"), (-0.015, 0.026, "orange"), (-0.005, 0.027, "steel"),
        (0.010, 0.027, "orange"), (0.022, 0.026, "orange"), (0.034, 0.026, "iron"),
        (0.044, 0.029, "iron"), (0.056, 0.029, "iron"), (0.066, 0.023, "steel"),
        (0.075, 0.021, "steel"),
    ]
    _canister(prop, profile, (
        (0, 1, 2, 3, 5, 6, 8, 9, 11, 12),
        (0, 1, 3, 5, 6, 9, 12),
        (0, 1, 3, 9, 12),
    ), (24, 16, 12, 8))


def grenade_poison(prop):
    profile = [
        (-0.046, 0.024, "iron"), (-0.038, 0.029, "iron"), (-0.029, 0.029, "green"),
        (-0.022, 0.034, "green"), (-0.013, 0.038, "green"), (-0.004, 0.040, "green"),
        (0.005, 0.040, "green"), (0.014, 0.037, "green"), (0.023, 0.032, "iron"),
        (0.028, 0.024, "iron"), (0.038, 0.023, "brass"), (0.046, 0.025, "brass"),
        (0.054, 0.023, "brass"),
    ]
    _canister(prop, profile, (
        (0, 1, 2, 3, 5, 6, 8, 9, 10, 12),
        (0, 2, 3, 5, 6, 8, 9, 10, 12),
        (0, 2, 5, 10, 12),
    ), (24, 16, 8, 8), oval=0.88)


def c4(prop):
    profile = [
        (-0.176, 0.043, 0.068, "cloth"), (-0.153, 0.054, 0.080, "cloth"),
        (-0.130, 0.058, 0.093, "cloth"), (-0.106, 0.058, 0.093, "iron"),
        (-0.090, 0.064, 0.096, "iron"), (-0.066, 0.064, 0.096, "iron"),
        (-0.052, 0.058, 0.093, "cloth"), (-0.025, 0.059, 0.094, "cloth"),
        (0.022, 0.060, 0.092, "cloth"), (0.050, 0.060, 0.094, "iron"),
        (0.067, 0.064, 0.096, "iron"), (0.102, 0.064, 0.096, "iron"),
        (0.119, 0.060, 0.092, "cloth"), (0.148, 0.055, 0.084, "cloth"),
        (0.176, 0.042, 0.069, "cloth"),
    ]
    reduced = (
        (0, 2, 3, 4, 6, 8, 9, 11, 12, 14),
        (0, 3, 4, 6, 8, 10, 12, 14),
        (0, 4, 8, 10, 14),
    )
    if prop.level:
        profile = [profile[index] for index in reduced[prop.level - 1]]

    corner = ((1, 0.71), (0.95, 0.88), (0.80, 0.97), (0.57, 1))
    quadrant = (corner, (corner[0], corner[2], corner[3]), (corner[0], corner[3]), ((1, 1),))[prop.level]
    perimeter = [*quadrant, *((-y, z) for y, z in reversed(quadrant)),
                 *((-y, -z) for y, z in quadrant), *((y, -z) for y, z in reversed(quadrant))]
    rise = 0.84 if prop.level == 3 else 1
    rings = [[(x, rise * (0.064 + y * height), z * depth) for y, z in perimeter]
             for x, height, depth, _ in profile]
    prop.shell(rings, "cloth", planar_sides=True,
               band_surfaces=[surface for _, _, _, surface in profile[:-1]])

    label = rounded_outline(0.092, 0.084, 0.021) if prop.level < 2 else [
        (-0.046, 0.042), (0.046, 0.042), (0.046, -0.042), (-0.046, -0.042),
    ]
    fold = [(0.110, 0.86), (0.120, 1), (0.133, 1), (0.143, 0.94), (0.150, 0.79)]
    folds_by_level = (fold, (fold[0], fold[2], fold[-1]), (fold[0], fold[2], fold[-1]), (fold[0], (0.139, 0.82)))
    prop.panel((-0.005, 0, 0), label, [(rise * y, scale) for y, scale in folds_by_level[prop.level]], "orange")

# The individuals of each kind, by the numbers that make them. asset.ts lists the same names. Sizes are metres at the
# size each is modelled; the content scales a node between its kind's least and most.

KINDS = {
    "bush": [
        # A mature, full bush: the one a survivor looks for.
        {"seed": 11, "height": 1.1, "width": 1.45, "depth": 1.3, "sprays": 46, "scale": 1.0, "inner": 14, "stems": 4, "windows": 1, "berried": 0.95, "bunches": 15},
        # Young and compact.
        {"seed": 23, "height": 0.85, "width": 1.0, "depth": 0.95, "sprays": 34, "scale": 0.9, "inner": 11, "stems": 3, "windows": 1, "berried": 0.95, "bunches": 10},
        # Old and sprawling, leaning to one side, with a long low reach.
        {"seed": 37, "height": 1.15, "width": 1.85, "depth": 1.4, "sprays": 48, "scale": 1.0, "inner": 14, "stems": 5, "windows": 2, "lean": (0.14, -0.05), "berried": 0.95, "bunches": 11},
        # Tall and upright.
        {"seed": 41, "height": 1.3, "width": 1.2, "depth": 1.1, "sprays": 46, "scale": 0.97, "inner": 13, "stems": 4, "windows": 1, "berried": 0.95, "bunches": 13},
    ],
    "palmetto": [
        # A mature clump of two crowns.
        {"seed": 101, "height": 1.25, "fans": 22, "crowns": 2, "creep": 0.45, "trunk": 0.06, "fan_size": 0.36, "dead": 2},
        # Young: one crown, fewer and smaller fans.
        {"seed": 113, "height": 0.9, "fans": 12, "crowns": 1, "creep": 0.2, "trunk": 0.045, "fan_size": 0.28, "dead": 1},
        # Old: three crowns on trunks creeping well out.
        {"seed": 127, "height": 1.4, "fans": 26, "crowns": 2, "creep": 0.8, "trunk": 0.075, "fan_size": 0.38, "dead": 3, "high_side": 2.5},
    ],
    "fern": [
        # A mature clump: principal fronds 55 to 80 cm, one side left more open.
        {"seed": 201, "fronds": 22, "length": 0.72, "crown": 0.05, "dead": 1, "open": 0.5},
        # Young: fewer, shorter, more upright fronds.
        {"seed": 211, "fronds": 12, "length": 0.5, "crown": 0.04, "dead": 1, "open": 2.0},
        # Old: wide and low, more dead fronds.
        {"seed": 223, "fronds": 26, "length": 0.85, "crown": 0.06, "dead": 2, "open": 4.0},
        {"seed": 229, "fronds": 19, "length": 0.65, "crown": 0.05, "dead": 1, "open": 1.0},
    ],
    "seagrape": [
        # A mature shrub, about 1.45 m high and 2.8 m across.
        {"seed": 301, "height": 1.45, "reach": 1.6, "limbs": 5, "radius": 0.04, "forks": 1, "nodes": 3.2, "leaf": 0.25, "fruiting": 0.3},
        # Young: four slender limbs.
        {"seed": 311, "height": 1.0, "reach": 1.1, "limbs": 4, "radius": 0.03, "forks": 1, "nodes": 3.5, "leaf": 0.23, "fruiting": 0.2},
        # Old and wind-shaped: low, thick limbs reaching far out.
        {"seed": 331, "height": 1.35, "reach": 2.0, "limbs": 5, "radius": 0.05, "forks": 1, "nodes": 2.6, "leaf": 0.27, "fruiting": 0.3, "lean": (60, 78)},
    ],
    "creeper": [
        # A mature heap over three shoulders of rubble, about 1.1 m high and 2.4 m across.
        {"seed": 401, "width": 2.4, "depth": 2.0, "height": 1.05, "runs": 14, "run": 0.5, "shoulders": 3, "rim": 14, "strands": 8, "runners": 4, "left": 4},
        # Young: a small heap.
        {"seed": 409, "width": 1.5, "depth": 1.3, "height": 0.65, "runs": 6, "run": 0.42, "shoulders": 2, "rim": 10, "strands": 5, "runners": 3, "left": 3},
        # Heaped high on one side, over a broken stump or against a wall's foot.
        {"seed": 419, "width": 2.6, "depth": 1.8, "height": 1.5, "steep": 0.4, "runs": 10, "run": 0.5, "shoulders": 3, "rim": 14, "strands": 9, "runners": 4, "left": 5},
    ],
}

# Every individual has its own used-up mesh, so a node keeps its frame when it is stripped.
DEPLETED = {kind: "each" for kind in KINDS}

# Every rock this folder makes, by name, with the numbers of its form. A name is
# the piece's object in Blender and the mesh `core:<name>` in the pack. The
# shapes follow the concept sheets in ref/concept/ (L1 to L8 in its NOTES.md).

import numpy as np

from forms import Broken, Gripped, Limestone, Ore, Part, Rubble


def through(middle, *planes):
    """
    Joint planes given as (outward direction, a point on the plane), as the cuts of a form or a lobe whose middle is
    `middle`: a point, or a height over the origin.
    """
    middle = np.asarray((0, 0, middle) if np.isscalar(middle) else middle, float)
    out = []
    for n, at in planes:
        n = np.asarray(n, float) / np.linalg.norm(n)
        out.append((tuple(n), float(n @ (np.asarray(at, float) - middle))))
    return out


VARIANTS = {
    # L1. The common boulder: a broad wedge, its peak left of the middle, falling in steps to the right and steeply
    # to the left, split along a deep bedding plane low down, the beds above it set back.
    "rock_1": lambda: Limestone(
        seed=11, radii=(1.75, 1.15, 1.6), centre_z=0.6,
        cuts=through(0.6, ((0.42, 0.05, 1), (-0.3, 0, 1.4)), ((-0.95, 0, 1), (-0.3, 0, 1.4)), ((0.05, -1, 0.12), (0, -0.85, 0.3)),
                     ((-0.05, 1, 0.1), (0, 0.9, 0.3)), ((1, 0.1, 0.2), (1.4, 0, 0.3)), ((-1, -0.05, 0.25), (-1.35, 0, 0.3)),
                     ((0.1, -0.75, 1), (-0.3, -0.5, 1.3)), ((0.7, -0.7, 0.5), (1.0, -0.55, 0.6)), ((-0.6, 0.7, 0.6), (-0.9, 0.6, 0.9)),
                     ((0.2, 0.9, 1), (0, 0.45, 1.3))),
        bites=[((1.2, -0.1, 1.02), (0.42, 1.3, 0.24)), ((-1.2, -0.7, 1.15), (0.3, 0.35, 0.4)),
               ((-0.55, -0.98, 0.26), (0.5, 0.2, 0.17)), ((0.95, -0.82, 0.22), (0.3, 0.2, 0.2))],
        beds=[(0.42, 0.09, 0.022), (0.95, 0.025, 0.018)], steps=[0.06, 0.02], burial=0.85),
    # L2. A blunt block standing taller than it is wide, cleft from the top nearly to the ground, the right-hand half
    # lower and pointed; a solution hole runs into its face.
    "rock_2": lambda: Limestone(
        seed=23, radii=(1.35, 1.1, 1.35), centre_z=0.8,
        cuts=through(0.8, ((0.15, 0.1, 1), (-0.3, 0, 1.6)), ((0.65, 0, 1), (0.6, 0, 1.42)), ((-1, 0.05, 0.12), (-1.05, 0, 0.5)),
                     ((1, -0.05, 0.1), (1.1, 0, 0.5)), ((0.08, -1, 0.08), (0, -0.8, 0.5)), ((-0.05, 1, 0.1), (0, 0.85, 0.5)),
                     ((0, -0.7, 1), (0, -0.6, 1.45)), ((-0.2, 0.8, 1), (0, 0.6, 1.45)), ((-0.9, 0, 1), (-0.85, 0, 1.4))),
        beds=[(0.55, 0.025, 0.02), (1.15, 0.015, 0.02)],
        cracks=[((0.32, 0.0, 1.7), (1, 0.15, 0), 0.3, 0.13)], holes=[((-0.6, -0.95, 0.8), (-0.5, -0.45, 0.82), 0.13)],
        bites=[((0.62, -0.95, 0.5), (0.42, 0.2, 0.32)), ((1.15, 0.25, 1.0), (0.22, 0.38, 0.3)), ((-0.9, 0.7, 0.35), (0.3, 0.25, 0.25)),
               ((-1.05, -0.9, 1.0), (0.32, 0.32, 0.4)), ((-0.75, -1.0, 0.3), (0.35, 0.18, 0.22))],
        burial=0.66),
    # L3. A long slab of beds tilted up toward one end, each bed a ledge set back from the one below it.
    "rock_3": lambda: Limestone(
        seed=37, radii=(2.0, 1.15, 1.4), centre_z=0.2,
        cuts=through(0.2, ((0.22, -0.08, 1), (0, 0, 0.85)), ((0.05, -1, 0.3), (0, -0.75, 0.4)), ((0, 1, 0.35), (0, 0.8, 0.4)),
                     ((1, 0, 0.6), (1.55, 0, 0.3)), ((-1, 0.1, 0.15), (-1.6, 0, 0.5)), ((-0.5, -0.6, 0.4), (-1.3, -0.6, 0.6))),
        beds=[(0.12, 0.03, 0.018), (0.28, 0.035, 0.02), (0.44, 0.03, 0.018), (0.6, 0.035, 0.02), (0.74, 0.02, 0.016)],
        dip=(0.22, -0.08), steps=[0.03, 0.035, 0.03, 0.035, 0.02], burial=1.0, crag=0.07, lumps=0.04),
    # L5. A long low outcrop of bedded ledges breaking the ground, its crest left of the middle, stepping down to
    # either end.
    "rock_4": lambda: Limestone(
        seed=41, radii=(2.55, 1.35, 1.1), centre_z=-0.3,
        cuts=through(-0.3, ((0.12, 0.05, 1), (-0.6, 0, 0.7)), ((-0.22, 0, 1), (-0.6, 0, 0.7)), ((0, -0.45, 1), (0, -0.5, 0.55)),
                     ((0, -1, 0.25), (0, -1.1, 0.1)), ((0, 1, 0.3), (0, 1.15, 0.1)), ((1, 0, 0.35), (2.2, 0, 0.1)),
                     ((-1, 0, 0.3), (-2.2, 0, 0.1))),
        beds=[(0.15, 0.06, 0.03), (0.3, 0.07, 0.03), (0.46, 0.06, 0.025)], dip=(0.16, 0.1), steps=[0.16, 0.2, 0.16],
        skew=(0.5, -0.9), burial=1.2, crag=0.07, chips=18, warp=0.06, lumps=0.035),
    # L7. Half sunk in the sand: a low mound of pitted stone, scoured smooth along the sand line, a pit in its crown.
    "rock_5": lambda: Limestone(
        seed=53, radii=(1.55, 1.15, 1.15), centre_z=-0.45,
        cuts=through(-0.45, ((0.15, -0.1, 1), (0, 0, 0.62)), ((1, 0.2, 0.4), (1.35, 0, 0.1)), ((-1, 0.1, 0.3), (-1.35, 0, 0.1)),
                     ((0, -1, 0.5), (0, -1.0, 0.1)), ((0.1, 1, 0.4), (0, 1.0, 0.1))),
        beds=[(0.35, 0.015, 0.02)], holes=[((0.55, -0.15, 0.62), 0.14)], scour=0.25, burial=0.95, chips=16),
    # L8. Gripped by a strangler fig's roots, the broken stump of the fig on its crown.
    "rock_6": lambda: Gripped(
        seed=67, radii=(1.35, 1.1, 1.0), centre_z=0.4,
        cuts=through(0.4, ((0.05, 0.1, 1), (0, 0, 1.3)), ((1, 0.1, 0.35), (1.25, 0, 0.5)), ((-1, 0.05, 0.3), (-1.25, 0, 0.5)),
                     ((0.1, 1, 0.3), (0, 1.0, 0.5)), ((0.1, -1, 0.3), (0, -1.0, 0.5))),
        beds=[(0.55, 0.02, 0.02)], burial=0.85, stump=(-0.1, 0.05, 0.32, 0.8), roots=6),
    # O1. The ore stone: a broad block under a canted roof that leans toward the front, a triangular break at one end,
    # a seam across its face with ore in lenses along it and rust bled down below.
    "metal_rock_1": lambda: Ore(
        seed=101, radii=(1.75, 1.3, 1.45), centre_z=0.5,
        cuts=through(0.5, ((0.2, -0.35, 1), (-0.4, 0.2, 1.5)), ((0.05, -1, 0.35), (0, -0.9, 0.4)), ((0, 1, 0.2), (0, 1.0, 0.5)),
                     ((1, -0.2, 0.55), (1.3, 0, 0.5)), ((0.7, 0.7, 0.3), (1.0, 0.7, 0.5)), ((-1, 0.1, 0.15), (-1.4, 0, 0.5)),
                     ((-0.7, -0.7, 0.4), (-1.1, -0.6, 0.6)), ((0, -0.6, 1), (0, -0.62, 1.15)), ((-0.5, 0.5, 1), (-1.0, 0.7, 1.2))),
        veins=[((-0.4, -0.7, 1.1), (0.45, 0.25, 0.86), 0.05), ((0.75, -0.55, 0.7), (0.8, 0.3, 0.5), 0.035),
               ((0.3, 0.8, 0.9), (-0.3, 0.6, 0.75), 0.045)],
        cracks=[((0.6, 0.0, 1.2), (1, 0.4, 0.2), 0.7, 0.012)]),
    # O2. A compact block, a raised shoulder at the back of one side, ore at the edge of its lower roof.
    "metal_rock_2": lambda: Ore(
        seed=113, radii=(1.35, 1.15, 1.3), centre_z=0.55,
        cuts=through(0.55, ((0.1, 0, 1), (0.3, 0, 1.25)), ((1, 0.1, 0.15), (1.1, 0, 0.5)), ((-1, 0, 0.15), (-1.05, 0, 0.5)),
                     ((0.05, -1, 0.15), (0, -0.8, 0.5)), ((0, 1, 0.15), (0, 0.85, 0.5)), ((0.2, -0.8, 1), (0.4, -0.6, 1.15))),
        lobes=[((-0.45, 0.2, 0.9), (0.85, 0.85, 1.0),
                through((-0.45, 0.2, 0.9), ((-0.2, 0.1, 1), (-0.5, 0.2, 1.7)), ((-1, 0.1, 0.15), (-1.05, 0.2, 0.9)),
                        ((0, -1, 0.25), (-0.4, -0.45, 0.9)), ((0, 1, 0.2), (-0.4, 0.8, 0.9)), ((1, 0, 0.4), (0.15, 0.2, 1.3)),
                        ((0.6, -0.6, 0.6), (-0.1, -0.2, 1.4))))],
        veins=[((0.7, -0.3, 1.1), (0.5, -0.2, 0.85), 0.05), ((0.0, -0.8, 0.7), (0.4, -0.3, 0.85), 0.045),
               ((-0.6, 0.5, 1.0), (-0.5, 0.4, 0.75), 0.04)]),
    # O3. A long low keel, its ridge falling to one end, clipped square at the other, a seam along its front slope.
    "metal_rock_3": lambda: Ore(
        seed=127, radii=(1.85, 1.05, 1.2), centre_z=0.2,
        cuts=through(0.2, ((0.1, -0.8, 1), (0, 0.1, 1.1)), ((0.05, 0.9, 1), (0, 0.1, 1.1)), ((-0.45, 0, 1), (-0.5, 0, 1.05)),
                     ((1, 0, 0.1), (1.4, 0, 0.5)), ((-1, 0.1, 0.5), (-1.5, 0, 0.3)), ((0, -1, 0.2), (0, -0.85, 0.3)),
                     ((0, 1, 0.2), (0, 0.85, 0.3))),
        veins=[((0.0, -0.4, 0.75), (0.2, -0.5, 0.85), 0.05), ((0.3, 0.4, 0.7), (-0.2, 0.5, 0.85), 0.04),
               ((1.3, 0.0, 0.5), (0.8, 0.3, 0.5), 0.035)], burial=0.95),
    # R1. A floor slab fallen aslant over the heap, high at the back of one end; under that end a chunk of wall with
    # its pink stucco to the front; coral blocks stacked at the other end; rebar bent down out of the slab's edge.
    "rubble_1": lambda: Rubble(
        seed=201, mound=((1.65, 1.2, 0.95), -0.22), burial=0.95,
        parts=[Part("slab", (0.0, 0.1, 0.92), (1.1, 0.75, 0.09), (8, 14, 10), seed=1),
               Part("wall", (-1.0, -0.4, 0.5), (0.6, 0.5, 0.11), (15, 0, 90), seed=2, paint=0),
               Part("wall", (-0.35, -0.85, 0.17), (0.32, 0.26, 0.08), (-20, 8, 6), seed=6, paint=0),
               Part("coral", (1.15, -0.45, 0.12), (0.21, 0.13, 0.11), (10, 0, 0), seed=3),
               Part("coral", (1.18, -0.42, 0.35), (0.21, 0.13, 0.11), (16, 0, 2), seed=4),
               Part("coral", (1.33, -0.02, 0.12), (0.21, 0.13, 0.11), (-6, 0, 0), seed=5),
               Part("coral", (0.92, -0.1, 0.12), (0.21, 0.13, 0.11), (32, 0, 0), seed=7)],
        rebar=[([(0.05, -0.5, 0.82), (0.0, -0.76, 0.7), (-0.05, -0.86, 0.42), (-0.08, -0.9, 0.08)], 0.01),
               ([(0.28, -0.5, 0.78), (0.3, -0.74, 0.62), (0.35, -0.82, 0.34)], 0.01),
               ([(-0.3, -0.5, 0.88), (-0.34, -0.7, 0.86), (-0.42, -0.8, 0.74)], 0.009)]),
    # R2. A wall's mint face leaning on a heap, a yellow piece of another, hollow blocks with their cores to the light.
    "rubble_2": lambda: Rubble(
        seed=211, mound=((1.4, 1.15, 0.92), -0.22), burial=0.8,
        parts=[Part("wall", (0.1, 0.4, 0.62), (0.9, 0.55, 0.1), (5, 0, 42), seed=11, paint=1),
               Part("wall", (0.75, -0.05, 0.42), (0.4, 0.35, 0.08), (20, 10, 70), seed=12, paint=3),
               Part("cinder", (-0.55, -0.45, 0.3), (0.2, 0.1, 0.1), (15, 0, 90), seed=13),
               Part("cinder", (-0.95, -0.2, 0.12), (0.2, 0.1, 0.1), (-20, 0, 90), seed=14),
               Part("cinder", (0.55, -0.6, 0.12), (0.2, 0.1, 0.1), (5, 0, 0), seed=15),
               Part("coral", (-0.15, -0.65, 0.12), (0.22, 0.13, 0.11), (-12, 0, 0), seed=16),
               Part("slab", (-0.62, 0.0, 0.5), (0.55, 0.4, 0.07), (30, -24, 8), seed=17),
               Part("cinder", (0.95, -0.35, 0.3), (0.2, 0.1, 0.1), (40, 12, 0), seed=18)],
        rebar=[([(-0.35, 0.73, 0.92), (-0.35, 0.86, 1.04), (-0.42, 1.0, 1.08), (-0.5, 1.12, 0.98)], 0.01),
               ([(0.3, 0.73, 0.92), (0.31, 0.84, 1.02), (0.38, 0.93, 1.05)], 0.009)]),
    # R3. A column drum lying across a long heap, slabs with aqua and yellow paint, a coral block and a hollow block.
    "rubble_3": lambda: Rubble(
        seed=221, mound=((1.95, 1.3, 0.95), -0.22), burial=1.05,
        parts=[Part("drum", (0.35, 0.05, 0.62), (0.95, 0.42, 0.42), (-8, 3, 0), seed=21),
               Part("wall", (-1.0, -0.25, 0.4), (0.6, 0.55, 0.09), (15, 0, 28), seed=22, paint=2),
               Part("wall", (-0.35, -0.62, 0.3), (0.35, 0.3, 0.09), (-10, 5, 70), seed=23, paint=3),
               Part("slab", (-0.6, 0.45, 0.72), (0.8, 0.45, 0.08), (25, 8, -10), seed=24),
               Part("coral", (0.25, -0.78, 0.13), (0.22, 0.13, 0.11), (8, 0, 0), seed=25),
               Part("cinder", (1.35, -0.5, 0.12), (0.2, 0.1, 0.1), (0, 0, 90), seed=26)],
        rebar=[([(1.15, 0.05, 0.66), (1.45, 0.0, 0.72), (1.62, -0.15, 0.56)], 0.011),
               ([(1.15, -0.12, 0.52), (1.48, -0.25, 0.36), (1.6, -0.32, 0.1)], 0.011)]),
    # The rest are made so no two of the eight share an outline, from any side a player stands at.
    # R4. A wall's fall spilled along the ground: long and low, heaped at the end it came down from, a slab lying there,
    # an aqua piece face up out at the tail, blocks strewn along it.
    "rubble_4": lambda: Rubble(
        seed=231, mound=((2.0, 0.85, 0.66), -0.2), burial=1.15, lumps=120, scale=0.85, lean=-0.4,
        parts=[Part("slab", (-1.05, 0.1, 0.44), (0.7, 0.5, 0.08), (14, 10, -6), seed=31),
               Part("wall", (1.05, 0.05, 0.13), (0.48, 0.36, 0.08), (-28, 4, 3), seed=32, paint=2),
               Part("slab", (0.3, 0.1, 0.26), (0.38, 0.3, 0.07), (-50, -8, 12), seed=38),
               Part("coral", (0.3, -0.6, 0.11), (0.21, 0.13, 0.11), (25, 0, 0), seed=33),
               Part("cinder", (0.7, 0.55, 0.1), (0.2, 0.1, 0.1), (-40, 0, 0), seed=34),
               Part("coral", (-0.3, 0.62, 0.2), (0.21, 0.13, 0.11), (70, 12, 0), seed=35),
               Part("cinder", (1.75, -0.3, 0.1), (0.2, 0.1, 0.1), (15, 0, 90), seed=36),
               Part("coral", (-1.8, -0.35, 0.11), (0.21, 0.13, 0.11), (-15, 0, 0), seed=37)],
        rebar=[([(-0.4, 0.25, 0.38), (-0.15, 0.3, 0.4), (0.02, 0.42, 0.32), (0.15, 0.5, 0.12)], 0.01)]),
    # R5. A tall steep heap standing alone, a broken slab driven upright into its top with rods out of its end, a pink
    # piece of wall leaning at its foot.
    "rubble_5": lambda: Rubble(
        seed=241, mound=((1.2, 1.05, 1.45), -0.2), burial=0.9, lumps=130, scale=1.1,
        parts=[Part("slab", (0.1, 0.05, 1.2), (0.62, 0.48, 0.09), (25, 68, 0), seed=41),
               Part("wall", (-0.75, -0.55, 0.4), (0.45, 0.35, 0.09), (-35, 0, 58), seed=42, paint=0),
               Part("slab", (0.55, 0.45, 0.75), (0.45, 0.35, 0.07), (-30, -35, 15), seed=45),
               Part("cinder", (0.85, -0.6, 0.1), (0.2, 0.1, 0.1), (30, 0, 0), seed=43),
               Part("coral", (-0.95, 0.5, 0.11), (0.22, 0.13, 0.11), (-20, 0, 0), seed=44)],
        rebar=[([(-0.07, 0.15, 1.55), (-0.1, 0.35, 1.62), (-0.18, 0.5, 1.55)], 0.01),
               ([(0.0, -0.2, 1.5), (0.05, -0.4, 1.58), (0.0, -0.55, 1.45), (-0.05, -0.6, 1.2)], 0.01)]),
    # R6. Blocks thrown down from a wall, lying apart on a thin spread of grit: coral and hollow blocks, a few still
    # mortared three high, one pair stacked, some on their sides; a mint shard leaning on the stack.
    "rubble_6": lambda: Rubble(
        seed=251, mound=((1.55, 1.2, 0.2), -0.1), burial=0.85, lumps=50, scale=0.5,
        parts=[Part("cinder", (-0.7, 0.25, 0.1), (0.2, 0.1, 0.1), (0, 0, 0), seed=71),
               Part("cinder", (-0.29, 0.27, 0.1), (0.2, 0.1, 0.1), (2, 0, 0), seed=72),
               Part("cinder", (-0.5, 0.25, 0.3), (0.2, 0.1, 0.1), (-3, 0, 0), seed=73),
               Part("cinder", (-0.55, 0.3, 0.5), (0.2, 0.1, 0.1), (8, 0, 0), seed=74),
               Part("coral", (0.65, -0.35, 0.11), (0.21, 0.13, 0.11), (35, 0, 0), seed=75),
               Part("coral", (0.6, -0.3, 0.33), (0.21, 0.13, 0.11), (22, 0, 0), seed=76),
               Part("coral", (1.2, 0.45, 0.13), (0.21, 0.13, 0.11), (-20, 0, 90), seed=77),
               Part("coral", (0.1, 0.72, 0.11), (0.21, 0.13, 0.11), (60, 0, 0), seed=78),
               Part("cinder", (-1.2, -0.5, 0.12), (0.2, 0.1, 0.1), (10, 18, 0), seed=79),
               Part("coral", (0.05, -0.2, 0.11), (0.21, 0.13, 0.11), (-10, 0, 0), seed=80),
               Part("cinder", (-0.3, -0.75, 0.1), (0.2, 0.1, 0.1), (75, 0, 90), seed=81),
               Part("cinder", (0.95, -0.7, 0.1), (0.2, 0.1, 0.1), (-55, 0, 0), seed=82),
               Part("wall", (-0.05, 0.3, 0.22), (0.32, 0.26, 0.06), (100, 0, 55), seed=83, paint=1)]),
    # R7. Two floors come down one on the other: slabs stacked and canted, broken stuff packed between them, rods
    # bristling out of their broken edges, a pink piece of wall caught under one.
    "rubble_7": lambda: Rubble(
        seed=261, mound=((1.3, 1.0, 0.7), -0.25), burial=0.9, lumps=80, scale=0.9,
        parts=[Part("slab", (0.0, 0.0, 0.5), (1.2, 0.9, 0.09), (8, -4, 3), seed=51),
               Part("slab", (0.25, -0.1, 0.84), (0.95, 0.75, 0.09), (-14, 7, -6), seed=52),
               Part("slab", (-0.55, 0.3, 1.02), (0.42, 0.32, 0.07), (32, -16, 12), seed=53),
               Part("wall", (1.05, 0.6, 0.28), (0.38, 0.28, 0.08), (55, 0, 72), seed=54, paint=0),
               Part("cinder", (-1.05, -0.7, 0.1), (0.2, 0.1, 0.1), (20, 0, 0), seed=55),
               Part("coral", (0.9, -0.8, 0.11), (0.21, 0.13, 0.11), (-30, 0, 0), seed=56)],
        rebar=[([(1.05, 0.2, 0.5), (1.35, 0.25, 0.52), (1.55, 0.3, 0.4), (1.62, 0.32, 0.15)], 0.01),
               ([(1.05, -0.3, 0.5), (1.4, -0.35, 0.5), (1.6, -0.42, 0.58)], 0.01),
               ([(-0.55, -0.4, 0.88), (-0.9, -0.45, 0.92), (-1.15, -0.5, 1.0), (-1.3, -0.48, 1.12)], 0.01),
               ([(-0.55, 0.0, 0.9), (-0.95, 0.05, 0.86), (-1.2, 0.1, 0.7)], 0.009),
               ([(-0.3, -0.75, 0.5), (-0.32, -1.1, 0.48), (-0.35, -1.25, 0.3), (-0.38, -1.3, 0.06)], 0.01)]),
    # R8. A small heap, knee high, a broken beam across it, one end on the ground and the other up in the air with its
    # rods out of the break; a yellow shard and two blocks at its foot.
    "rubble_8": lambda: Rubble(
        seed=271, mound=((0.95, 0.8, 0.72), -0.22), burial=0.7, lumps=70, scale=0.85,
        parts=[Part("beam", (0.05, 0.0, 0.55), (0.75, 0.13, 0.15), (20, 25, 3), seed=61, bites=2),
               Part("wall", (0.45, -0.45, 0.28), (0.3, 0.24, 0.07), (-40, 0, 48), seed=62, paint=3),
               Part("coral", (-0.6, 0.45, 0.11), (0.21, 0.13, 0.11), (15, 0, 0), seed=63),
               Part("cinder", (0.75, 0.35, 0.1), (0.2, 0.1, 0.1), (-25, 0, 90), seed=64)],
        rebar=[([(-0.5, -0.2, 0.85), (-0.72, -0.27, 0.95), (-0.85, -0.3, 0.9), (-0.92, -0.33, 0.75)], 0.009),
               ([(-0.5, -0.26, 0.78), (-0.75, -0.33, 0.8), (-0.88, -0.4, 0.7)], 0.009)]),
}

# How each is made: the material it is baked from, its game mesh's triangles, its pictures' size, and where it breaks
# when used up: the height of the break, how it falls away across x and y, and how many pieces lie round it.
SPEC = {
    "rock_1": {"material": "limestone", "triangles": 3000, "texture": 2048, "broken": (0.36, (0.05, -0.03), 6), "broken_triangles": 1600},
    "rock_2": {"material": "limestone", "triangles": 2600, "texture": 2048, "broken": (0.4, (-0.04, 0.06), 5), "broken_triangles": 1400},
    "rock_3": {"material": "limestone", "triangles": 3000, "texture": 2048, "broken": (0.3, (-0.08, 0.0), 6), "broken_triangles": 1600},
    "rock_4": {"material": "limestone", "triangles": 3200, "texture": 2048, "broken": (0.22, (0.03, 0.02), 7), "broken_triangles": 1800},
    "rock_5": {"material": "limestone", "triangles": 2400, "texture": 2048, "broken": (0.2, (0.05, 0.0), 5), "broken_triangles": 1300},
    "rock_6": {"material": "limestone", "triangles": 3600, "texture": 2048, "broken": (0.34, (0.0, 0.05), 5), "broken_triangles": 2000},
    "metal_rock_1": {"material": "ore", "triangles": 2400, "texture": 2048, "broken": (0.36, (0.06, 0.0), 6), "broken_triangles": 1400},
    "metal_rock_2": {"material": "ore", "triangles": 2400, "texture": 2048, "broken": (0.38, (-0.05, 0.03), 5), "broken_triangles": 1400},
    "metal_rock_3": {"material": "ore", "triangles": 2400, "texture": 2048, "broken": (0.3, (0.04, -0.04), 6), "broken_triangles": 1400},
    "rubble_1": {"material": "rubble", "triangles": 3250, "texture": 2048, "broken": (0.34, (0.04, 0.0), 6), "broken_triangles": 1800},
    "rubble_2": {"material": "rubble", "triangles": 3000, "texture": 2048, "broken": (0.3, (0.0, 0.04), 6), "broken_triangles": 1600},
    "rubble_3": {"material": "rubble", "triangles": 3250, "texture": 2048, "broken": (0.34, (0.03, -0.02), 7), "broken_triangles": 1800},
    "rubble_4": {"material": "rubble", "triangles": 3000, "texture": 2048, "broken": (0.2, (0.0, 0.0), 6), "broken_triangles": 1600},
    "rubble_5": {"material": "rubble", "triangles": 3150, "texture": 2048, "broken": (0.36, (0.0, 0.0), 6), "broken_triangles": 1700},
    "rubble_6": {"material": "rubble", "triangles": 3200, "texture": 2048, "broken": (0.08, (0.0, 0.0), 6), "broken_triangles": 1600},
    "rubble_7": {"material": "rubble", "triangles": 2900, "texture": 2048, "broken": (0.32, (0.0, 0.0), 6), "broken_triangles": 1600},
    "rubble_8": {"material": "rubble", "triangles": 2500, "texture": 1024, "broken": (0.28, (0.0, 0.0), 6), "broken_triangles": 1400},
}

DEPLETED = "_depleted"


def form_of(name):
    """The form of a rock, or of what is left of one, by its mesh's name."""
    if name.endswith(DEPLETED):
        whole = name[: -len(DEPLETED)]
        height, tilt, pieces = SPEC[whole]["broken"]
        form = VARIANTS[whole]()
        if isinstance(form, Rubble):
            return form.quarried(height)
        return Broken(form, height, pieces=pieces, seed=len(whole) * 7 + sum(map(ord, whole)), tilt=tilt)
    return VARIANTS[name]()

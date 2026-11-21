# A marina's dock kit (content/docks.ts, which keeps these numbers): a fixed timber dock on piles, as the docks of
# Miami's marinas are built, in modules 3 m long that a map lays end to end (tools/boat/marinas.ts). Each module's origin
# is its deck's top at its middle, x across it, y up, z along it. Its deck is boards laid across it on stringers, a
# fascia board down each side, a cap beam and its bent of piles under its -z end, going down into the bed, and a cleat
# on each side. The ramp is the walkway falling a quarter metre along its length, toward +z, with a handrail each side:
# the way down from the bank. The mooring pile stands at a finger's tip, 2 m over its deck, its top capped.
#
# Everything is on the street atlas (kit.py): the wood strip for the timber, the galvanised one for the cleats, the
# rails and the pile caps. The levels: boards with their gaps; then a plain deck; then flat, the small parts gone; then
# the masses alone.

import math

import kit
from kit import Mesh, box, cylinder, tube

LENGTH = 3.0  # a module's length
WALK, FINGER = 2.4, 1.0  # the walkway's and a finger's width
DECK = 0.3  # the deck's depth, boards and stringers, under its top
FALL = 0.25  # how far the ramp's deck falls along it
LEG, FOOT = 0.3, 6.7  # a bent pile's side, and how far under the deck it goes
PILE, TOP = 0.34, 2.0  # a mooring pile's width, and how far over the deck it stands
BOARD, GAP, THICK = 0.138, 0.012, 0.04  # a deck board's width, the gap between two, its thickness
FASCIA = 0.05  # the fascia board's thickness


def board(m, x0, x1, z0, z1, phase, move):
    """One deck board from x0 to x1 and z0 to z1, its top at 0, closed: the wood's grain runs along it, a board's own
    piece of the strip by `phase`."""
    box(m, (x0, -THICK, z0), (x1, 0.0, z1), "wood", phase=phase, move=move)


def cleat(m, x, z, move):
    """A galvanised horn cleat on the fascia's top at (x, z), along the module."""
    box(m, (x - 0.035, 0.0, z - 0.06), (x + 0.035, 0.035, z + 0.06), "galvanised", move=move)
    box(m, (x - 0.02, 0.035, z - 0.13), (x + 0.02, 0.06, z + 0.13), "galvanised", move=move)


def module(width, ramp=False):
    """A walkway or finger module, or the walkway's ramp."""
    m = Mesh()
    level = kit.LEVEL
    move = (lambda p: (p[0], p[1] - FALL * p[2] / LENGTH, p[2])) if ramp else (lambda p: p)
    half, inner = width / 2, width / 2 - FASCIA
    if level == 0:
        # Boards across it with their gaps, over a dark underside the gaps show.
        n = round(LENGTH / (BOARD + GAP))
        pitch = LENGTH / n
        for k in range(n):
            z0 = -LENGTH / 2 + k * pitch + GAP / 2
            board(m, -inner, inner, z0, z0 + pitch - GAP, (k * 1.37) % 4, move)
        box(m, (-inner, -THICK - 0.03, -LENGTH / 2), (inner, -THICK, LENGTH / 2), "rust", move=move)
    else:
        box(m, (-inner, -THICK if level < 3 else -DECK, -LENGTH / 2), (inner, 0, LENGTH / 2), "wood", move=move)
    if level < 3:
        # The fascia boards down each side, the stringers' faces.
        for side in (-1, 1):
            x = side * (half - FASCIA / 2)
            box(m, (x - FASCIA / 2, -DECK, -LENGTH / 2), (x + FASCIA / 2, 0.0, LENGTH / 2), "wood", phase=1.1 + side, move=move)
        # The cap beam and its piles under the -z end.
        rise = FALL / 2 if ramp else 0.0
        z = -LENGTH / 2 + 0.05 + LEG / 2
        box(m, (-half + 0.02, -DECK - 0.2 + rise, z - 0.11), (half - 0.02, -DECK + rise, z + 0.11), "wood", phase=2.3)
        xs = (0.0,) if width < 2 else (-(half - LEG / 2 - 0.05), half - LEG / 2 - 0.05)
        for x in xs:
            cylinder(m, (x, -FOOT, z), (x, -DECK - 0.2 + rise, z), LEG / 2, LEG / 2, 8, "wood", caps=(True, True), phase=x)
    if level < 2:
        for side in (-1, 1):
            cleat(m, side * (half - FASCIA), 0.0, move)
        if ramp:
            # A handrail each side: three posts and a top rail, galvanised.
            for side in (-1, 1):
                x = side * (half - 0.08)
                for z in (-1.35, 0.0, 1.35):
                    cylinder(m, move((x, 0.0, z)), move((x, 0.95, z)), 0.022, 0.022, 6, "galvanised", caps=(True, True))
                tube(m, [move((x, 0.95, -1.4)), move((x, 0.95, 1.4))], [0.025, 0.025], 6, "galvanised")
    return m


def mooring_pile():
    """A round timber pile from the bed to 2 m over the deck, its top under a galvanised cap."""
    m = Mesh()
    r = PILE / 2
    sides = 10
    cylinder(m, (0, -FOOT, 0), (0, TOP - 0.06, 0), r, r * 0.94, sides, "wood", caps=(True, True), phase=0.4)
    if kit.LEVEL < 2:
        cylinder(m, (0, TOP - 0.08, 0), (0, TOP - 0.04, 0), r * 1.02, r * 1.02, sides, "galvanised", caps=(True, True))
    tube(m, [(0, TOP - 0.06, 0), (0, TOP, 0)], [r * 0.96, r * 0.4], sides, "galvanised", caps=(True, True))
    return m


PIECES = {
    "dock_walk": lambda: module(WALK),
    "dock_ramp": lambda: module(WALK, ramp=True),
    "dock_finger": lambda: module(FINGER),
    "dock_pile": mooring_pile,
}
for name, fn in PIECES.items():
    counts = []
    for level in range(4):
        kit.LEVEL = level
        mesh = fn()
        if counts and mesh.triangles() > counts[-1] * 0.8:
            continue
        mesh.build(name if not counts else f"{name}_LOD{len(counts)}")
        counts.append(mesh.triangles())
    kit.LEVEL = 0
    print(f"dock: {name} {counts} triangles")

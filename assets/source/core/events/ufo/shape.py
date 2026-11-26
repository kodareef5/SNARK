"""The craft's numbers, shared by model.py (in Blender) and paint.py (outside it). Plain Python: no Blender.

Its hull is FlexUnit's disc (ref/flexunit.json, written by convert.py from the CC0 file): the cage of that model's turned
profile, scaled to the sky's hull (the hull its module gives the craft, shared/mapevent/parts.ts: 22 m across, its middle at the origin) and flattened to 6.4 m
through, then smoothed as Blender's subdivision would smooth it, with the rim, the band and the step under it kept
sharp. What is added to it is the game's: a channel the rim turns in, the belly's emitter and the ring that turns under
it, glowing channels down the hull, a crown ring and the lenses.

Game axes throughout: metres, +Y up, the axis of the turned hull along Y. `r` is the distance from that axis.
"""

import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
FLEX = json.loads((HERE / "ref/flexunit.json").read_text())
TAU = math.tau

# The sky's hull: an oblate spheroid 22 m across and 6.4 m through (shared/mapevent/parts.ts CraftSpec hull).
RADIUS = 11.0
HALF_HEIGHT = 3.2

# FlexUnit's rim, the widest ring of its cage, goes to RADIUS at y = 0. Above it the cage is stretched to put the top of
# its dome at 3.15 m, below it to put the lip of its belly at -2.45 m: the craft is a little flatter than FlexUnit's.
_cage = FLEX["profile"]
_rim = max(_cage, key=lambda p: p["r"])
_top = max((p for p in _cage if "Gray" in p["materials"]), key=lambda p: p["z"])
_low = min(_cage, key=lambda p: p["z"])
SCALE_R = RADIUS / _rim["r"]
SCALE_UP = 3.15 / (_top["z"] - _rim["z"])
SCALE_DOWN = 2.45 / (_rim["z"] - _low["z"])


def scaled(p):
    z = p["z"] - _rim["z"]
    return (p["r"] * SCALE_R, z * (SCALE_UP if z > 0 else SCALE_DOWN))


CAGE = [scaled(p) for p in _cage]
BELLY_EDGE = scaled(FLEX["off_the_walk"][0])

# The cage's rings by what they are, in its order from the lip of the belly up over the rim to the top of the antenna.
(LIP, LIP_OUT, STEP_LOW, STEP_HIGH, UNDER, UNDER_OUT, RIM, TOP_OUT, TOP, TOP_IN, BAND_LOW, BAND_IN_LOW, BAND_IN_HIGH,
 BAND_HIGH, DOME_LOW, DOME, DOME_HIGH, CROWN, MAST_LOW, MAST_IN, MAST_TIP) = CAGE

SECTORS = 16
SECTOR = TAU / SECTORS
# Columns of a sector, in degrees from its start: the first, 0.35 degrees wide, is a glowing channel on the hull's top.
# Windows fill the even sectors of the band from the second column's start to the last's.
COLUMNS = [0.0, 0.35, 4.25, 7.9, 11.55, 15.2, 18.85]
WINDOW = (4.25, 18.85)
# The rim turns in a channel at this distance from the axis; its inner face is a hair inside the hull's wall.
CHANNEL = 10.15
CHANNEL_WALL = 10.0
RIM_GAP = 0.015
# Around the rim: segments of light, each three columns of which the last is dark.
RIM_SEGMENTS = 48
# The belly: a lens of light, the dark ceiling of the recess round it, and the ring that turns under that ceiling.
LENS = 2.0
RING_IN, RING_OUT = 3.3, 4.7
RING_TOP, RING_LOW = -2.04, -2.3
RING_NODES = 12
# Light the glow channels and strips are, in metres across.
STRIP = 0.09
# The hull's tiling pictures: metres one picture spans along the profile, and pictures round the craft.
HULL_TILE = 2.4
HULL_AROUND = 16
TRIM_TILE = 1.2
TRIM_AROUND = 48


def chaikin(points, levels=4):
    """An open polyline smoothed by corner cutting, its ends kept: the quadratic B-spline of its points."""
    pts = list(points)
    for _ in range(levels):
        out = [pts[0]]
        for a, b in zip(pts, pts[1:]):
            out.append((0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]))
            out.append((0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]))
        out.append(pts[-1])
        pts = out
    return pts


def resample(points, count):
    """`count` + 1 points spaced evenly along a polyline, its ends kept."""
    lengths = [0.0]
    for a, b in zip(points, points[1:]):
        lengths.append(lengths[-1] + math.dist(a, b))
    total = lengths[-1]
    out = []
    j = 0
    for i in range(count + 1):
        s = total * i / count
        while j < len(points) - 2 and lengths[j + 1] < s:
            j += 1
        seg = lengths[j + 1] - lengths[j]
        t = 0.0 if seg <= 0 else (s - lengths[j]) / seg
        a, b = points[j], points[j + 1]
        out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out


def length(points):
    return sum(math.dist(a, b) for a, b in zip(points, points[1:]))


def cut(points, r):
    """The part of a polyline going outward that lies within `r` of the axis, ended at `r` exactly; and the rest."""
    for i, (a, b) in enumerate(zip(points, points[1:])):
        if (a[0] - r) * (b[0] - r) <= 0 and a[0] != b[0]:
            t = (r - a[0]) / (b[0] - a[0])
            at = (r, a[1] + (b[1] - a[1]) * t)
            return points[: i + 1] + [at], [at] + points[i + 1 :]
    raise ValueError(f"no crossing at {r}")


# The smoothed spans between the cage's sharp rings. The rim, the step under the hull and the band stay sharp.
UNDER_CURVE = chaikin([STEP_HIGH, UNDER, UNDER_OUT, RIM])
TOP_CURVE = chaikin([RIM, TOP_OUT, TOP, TOP_IN, BAND_LOW])
DOME_CURVE = chaikin([BAND_HIGH, DOME_LOW, DOME, DOME_HIGH, CROWN, (0.0, CROWN[1] + 0.02)])
LIP_CURVE = chaikin([LIP, LIP_OUT, STEP_LOW], 3)

# The hull's under side out to the channel and the rim's beyond it, in the order the profile is walked: outward under
# the craft, inward over it.
UNDER_HULL, UNDER_RIM = cut(UNDER_CURVE, CHANNEL)
_inner, _outer = cut(list(reversed(TOP_CURVE)), CHANNEL)
TOP_RIM = list(reversed(_outer))
TOP_HULL = list(reversed(_inner))


def layout():
    """What paint.py needs of the shape: nothing yet beyond the tiles, which both read from here."""
    return {"hull_tile": HULL_TILE, "trim_tile": TRIM_TILE}

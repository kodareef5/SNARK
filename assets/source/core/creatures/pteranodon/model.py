"""The pteranodon itself: the mesh that rig.py's skeleton moves, in the two materials asset.ts gives pictures.

Its second script (asset.ts: source.scripts). It finds the rig, drops the block-out, builds the animal in the glide (the
rest pose) and binds it. Positions are in the animal's frame, as in rig.py: metres, x to its left, y up, z forward,
x = 0 its midline, z = 0 the line through its shoulder joints, y = 0 the ground it stands on.

The animal is made of closed parts:
- the shell: tail, body, neck, head and upper beak as one surface. Its shape is a field (negative inside) and its
  rings are slices of the field by planes: upright across the body, fanning up into the neck, across the neck, fanning
  forward into the head, upright along the beak. The mouth is cut out of it under the gape line;
- the lower beak, the eyes, the crest; the arms, the wing fingers, the small hands; the legs and feet;
- each wing's membrane and front membrane: thin closed slabs whose rim is shared by their upper and under faces, each
  face shaded as one side of the skin.

`pteranodon` holds the body, head, legs, feet and hands, laid out once on the left side and mirrored to the right;
the layout is pinned in layout.json, as the dodo's is, since paint goes onto it. `pteranodon_wing` holds the
membranes, the arms and the wing fingers: each face of the membrane is laid out as the concept's top and underside
views show it (WING_UV), the arm and finger as strips beneath, the right wing taking the left's picture.

Each small part is pinned at one point to a larger one (attach), so the build's coarser levels keep it whole.
"""

import base64
import hashlib
import json
import math
import os

import bmesh
import bpy
import numpy as np

import rig

# Colour regions as rig.REGIONS numbers them, and what no dye reaches: eyes, claws, the inside of the mouth.
PATTERN_R, WASH_R, HORN_R, BAND_R, SKIN_R, BODY_R, BARE_R = 0, 1, 2, 3, 4, 5, 6
BODY_MAT, WING_MAT = "pteranodon", "pteranodon_wing"

# =====================================================================================================================
# Shapes
# =====================================================================================================================

# The body and tail: a centre line (y, z) from the tip of the tail to the front of the breast, each station's half
# width, half height above and below. Deep and broad at the shoulders, where the flight muscles wrap the wing roots;
# narrow at the hips; a short stub of a tail.
TORSO = {
    "path": [(0.668, -0.815), (0.676, -0.775), (0.690, -0.720), (0.706, -0.660), (0.718, -0.600), (0.733, -0.480),
             (0.742, -0.330), (0.745, -0.170), (0.745, -0.020), (0.752, 0.100), (0.775, 0.190), (0.800, 0.240)],
    "half_width": [0.003, 0.012, 0.026, 0.060, 0.092, 0.122, 0.152, 0.183, 0.203, 0.188, 0.135, 0.040],
    "half_up": [0.003, 0.011, 0.024, 0.055, 0.084, 0.108, 0.136, 0.162, 0.178, 0.168, 0.120, 0.040],
    "half_down": [0.003, 0.012, 0.030, 0.062, 0.088, 0.112, 0.142, 0.172, 0.198, 0.190, 0.135, 0.040],
}
# The neck: a centre line (y, z) from inside the chest to inside the skull, half width, and half depth (front and back).
NECK = {
    "path": [(0.790, 0.050), (0.872, 0.112), (0.952, 0.220), (1.060, 0.330), (1.178, 0.428), (1.285, 0.505),
             (1.340, 0.560)],
    "half_width": [0.140, 0.118, 0.098, 0.086, 0.078, 0.073, 0.068],
    "half_depth": [0.150, 0.128, 0.108, 0.093, 0.083, 0.077, 0.070],
}
# The skull and upper beak along z, back to front: centre height, half width, half height above and below, and how
# the section is drawn above and below (2 an ellipse, under 2 drawn to a ridge: the keel; over 2 squared off). Behind
# the corner of the mouth the head comes down over the root of the lower beak; ahead of it the mouth is cut away under
# the gape line, leaving the palate flat between the cutting edges.
HEAD = {
    "z":         [0.400, 0.450, 0.530, 0.610, 0.690, 0.750, 0.840, 0.980, 1.150, 1.300, 1.420, 1.495, 1.512],
    "y":         [1.372, 1.374, 1.370, 1.362, 1.354, 1.348, 1.342, 1.333, 1.322, 1.313, 1.306, 1.303, 1.303],
    "half_width": [0.020, 0.058, 0.079, 0.086, 0.081, 0.068, 0.058, 0.046, 0.032, 0.020, 0.0095, 0.0030, 0.0008],
    "half_up":   [0.030, 0.076, 0.094, 0.098, 0.090, 0.080, 0.068, 0.054, 0.038, 0.024, 0.0120, 0.0040, 0.0008],
    "half_down": [0.030, 0.082, 0.108, 0.110, 0.104, 0.064, 0.058, 0.046, 0.034, 0.023, 0.0130, 0.0045, 0.0008],
    "e_up":      [2.0, 2.0, 2.0, 2.0, 1.9, 1.75, 1.65, 1.6, 1.6, 1.6, 1.7, 1.8, 2.0],
    "e_down":    [2.0, 2.0, 2.2, 2.4, 2.6, 2.6, 2.6, 2.6, 2.6, 2.6, 2.4, 2.2, 2.0],
}
# The gape: the line the beaks meet on, from the corner of the mouth below the front of the eye to the tip, turned a
# little up at the end.
GAPE = {"corner": 0.720, "y": [(0.720, 1.2935), (1.100, 1.2960), (1.420, 1.2995), (1.512, 1.3025)]}
# The lower beak: stations (z, half width at the gape, depth below it) from its root inside the head behind the hinge
# to its tip, a little short of the upper beak's.
JAW = [(0.560, 0.050, 0.022), (0.620, 0.062, 0.032), (0.700, 0.064, 0.038), (0.760, 0.060, 0.038),
       (0.880, 0.050, 0.033), (1.020, 0.040, 0.027), (1.180, 0.027, 0.020), (1.320, 0.015, 0.012),
       (1.420, 0.005, 0.005), (1.452, 0.0008, 0.0008)]
# The crest: one flat blade from inside the skull, sweeping up and back, its base flaring into the cap. Centre line
# (y, z), half thickness, half depth (front to back) at each station.
CREST = {
    "path": [(1.395, 0.575), (1.440, 0.545), (1.500, 0.505), (1.634, 0.415), (1.775, 0.324), (1.888, 0.251),
             (1.935, 0.219), (1.948, 0.210)],
    "half_thickness": [0.036, 0.031, 0.025, 0.019, 0.0135, 0.0090, 0.0055, 0.0015],
    "half_depth": [0.128, 0.112, 0.094, 0.073, 0.054, 0.036, 0.020, 0.004],
    "band": (0.15, 0.27),  # the band across it near the tip, as fractions of its length from the tip
}
# The eye looks out and a little forward from under a slight brow.
EYE = {"centre": (0.0705, 1.371, 0.694), "radius": 0.0172, "socket": 0.0198, "look": (0.83, 0.02, 0.56)}
BROW = {"centre": (0.066, 1.396, 0.688), "radii": (0.022, 0.012, 0.030)}
# The flight muscles over each shoulder and the thighs' roots at the hips.
SHOULDER = {"centre": (0.150, 0.790, 0.010), "radii": (0.085, 0.080, 0.115)}
HIP = {"centre": (0.085, 0.712, -0.570), "radii": (0.055, 0.060, 0.075)}

# How the shell is sliced. P1 and P2 are the axes (along x) the fans turn about, as (y, z): above the back where the
# neck leaves it, and in front of the throat under the head.
P1 = (1.010, 0.020)
P2 = (1.205, 0.640)
AROUND = 24  # points round a ring; even, so the midline has a point at top and bottom
RINGS = 82

# The arm: radii along it from the shoulder to the knuckle, (distance along the bones from the shoulder joint, radius
# up and down, radius fore and aft); the hand ends in a knob at the knuckle, and the wing finger starts inside it.
ARM = [(-0.050, 0.060, 0.064), (0.000, 0.066, 0.072), (0.080, 0.062, 0.070), (0.180, 0.052, 0.060),
       (0.300, 0.044, 0.050), (0.330, 0.045, 0.051), (0.380, 0.040, 0.046), (0.600, 0.035, 0.042),
       (0.800, 0.032, 0.039), (0.840, 0.034, 0.041), (0.880, 0.031, 0.037), (1.150, 0.027, 0.032),
       (1.380, 0.027, 0.031), (1.420, 0.029, 0.033)]
FINGER = [(-0.030, 0.020, 0.024), (0.000, 0.026, 0.030), (0.150, 0.023, 0.027), (0.700, 0.019, 0.023),
          (1.300, 0.014, 0.018), (1.800, 0.009, 0.012), (2.060, 0.0045, 0.006), (2.160, 0.0008, 0.001)]
# The three small fingers of the hand, lying forward along the leading edge: heading from the fingers bone (degrees
# out, degrees down), length, half width, claw length.
HAND = [(-16.0, 0.0, 0.066, 0.0085, 0.030), (0.0, 2.0, 0.076, 0.0090, 0.032), (16.0, 4.0, 0.062, 0.0082, 0.028)]
# The leg: radii along it from the hip joint (distance along the bones, radius across, radius front to back).
LEG = [(-0.040, 0.050, 0.055), (0.000, 0.058, 0.064), (0.120, 0.050, 0.056), (0.240, 0.037, 0.041),
       (0.275, 0.033, 0.035), (0.400, 0.027, 0.029), (0.530, 0.022, 0.024), (0.565, 0.023, 0.023),
       (0.620, 0.027, 0.015), (0.664, 0.032, 0.012)]
# Four toes from the ball of the foot: heading (degrees, + to the animal's left for the left foot), length, root half
# width, claw length.
TOES = [(-20.0, 0.095, 0.0095, 0.040), (-6.0, 0.112, 0.0100, 0.044), (8.0, 0.106, 0.0098, 0.042),
        (22.0, 0.088, 0.0090, 0.038)]

# The membrane: a grid of columns from the root to the tip, each running from the leading edge to the trailing edge,
# with a column on each batten (the arm's joints). Its two faces stand MEMBRANE_HALF off its middle, less near the rim.
# SPAN_COLUMNS: (leading edge x, trailing edge x, columns to the next).
SPAN_COLUMNS = [(0.150, 0.200, 6), (0.454, 0.450, 8), (0.966, 0.970, 8), (1.524, 1.550, 8), (2.204, 2.200, 6),
                (2.764, 2.800, 5), (3.203, 3.230, 3), (3.481, 3.481, 0)]
CHORD_ROWS = 14
MEMBRANE_HALF = 0.004
ROOT_IN = 0.030
# How the membrane's weights are laid out (membrane_weights): where the battens take over going back across the chord
# (v0 to v1, as fractions of the chord, nearer the body and further out), how much at most (rib_max), how far out
# the body's own bones reach before the first batten (root_reach, a fraction of the span), how the change between two
# battens is eased across the span, and how many rounds of smoothing. Searched with rig.py's fold (ref/wing/).
MEMBRANE_FIT = {"v0": 0.0, "v1_inner": 0.188, "v1_outer": 0.819, "rib_max": 0.905, "root_reach": 0.0913,
                "span_ease": 0.0, "smooth": 4}
# The front membrane: columns from the shoulder to the wrist, rows from the arm to its free edge.
FRONT_COLUMNS, FRONT_ROWS = 10, 3

# The wing material's layout: each face of the membrane laid out as seen from above and from below, the left wing's
# picture in each case (the right wing takes it mirrored), metres to texture units, and where the arm and finger
# strips go.
WING_UV = {"scale": 0.2930, "upper": (0.0100, 0.6342), "under": (0.0100, 0.2584), "x": (0.140, 3.481),
           "z": (-1.085, 0.130), "arm": (0.0100, 0.0900, 0.36), "finger": (0.0100, 0.0100, 0.36)}

# The published layout of the body material. Paint goes onto it, so no piece's outline may move: a build whose faces
# it does not fit stops. PTERANODON_LAYOUT=new lays it out afresh and writes the file again.
LAYOUT_FILE = os.path.join(os.path.dirname(os.path.realpath(__file__)), "layout.json")
# How much texture each piece gets for its size, against the body's: the face and beak most, from the saddle.
DENSITY = [("head", 2.0), ("beak", 1.5), ("crest", 1.6), ("jaw", 1.4), ("eye", 3.0), ("neck", 1.25), ("torso", 1.0),
           ("leg", 1.1), ("toe", 1.8), ("hand", 1.8)]
# Where the beak's piece of texture begins, cut across the horn ahead of the face.
BEAK_FROM = 0.86


# =====================================================================================================================
# Fields
# =====================================================================================================================


def smin(a, b, k):
    """Smooth union of two fields, blending over about k metres."""
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1 - h) + a * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def ellipsoid(p, centre, radii):
    q = (p - np.asarray(centre, float)) / np.asarray(radii, float)
    k0 = np.linalg.norm(q, axis=1)
    k1 = np.linalg.norm(q / np.asarray(radii, float), axis=1)
    return k0 * (k0 - 1) / np.maximum(k1, 1e-9)


def mirror_x(p):
    """Points folded onto the left side, for shapes made once and mirrored."""
    q = p.copy()
    q[:, 0] = np.abs(q[:, 0])
    return q


def sweep_rows(path, columns, sub=6):
    """A dense centre line with its section values: rows of (y, z, values...), path given as (y, z)."""
    return np.array(rig._catmull([tuple(a) + tuple(v) for a, v in zip(path, zip(*columns))], sub))


def sweep_field(p, rows, chunk=6000):
    """A tube along a centre line in the midplane. rows: (y, z, half width, half up, half down, e up, e down). The
    section is a superellipse, `up` being the side of the tangent turned back (up for a forward line, the back of the
    neck for a rising one). Past either end it is closed square."""
    c = np.stack([np.zeros(len(rows)), rows[:, 0], rows[:, 1]], 1)
    a, ab = c[:-1], c[1:] - c[:-1]
    seg = np.einsum("ij,ij->i", ab, ab)
    out = np.empty(len(p))
    for s in range(0, len(p), chunk):
        q0 = p[s:s + chunk]
        t = np.clip(np.einsum("nij,ij->ni", q0[:, None, :] - a[None], ab) / seg[None], 0, 1)
        near = a[None] + t[..., None] * ab[None]
        d2 = np.einsum("nij,nij->ni", q0[:, None, :] - near, q0[:, None, :] - near)
        k = np.argmin(d2, axis=1)
        n = np.arange(len(q0))
        tk = t[n, k]
        tangent = ab[k] / np.sqrt(seg[k])[:, None]
        q = q0 - near[n, k]
        v = rows[k] + (rows[k + 1] - rows[k]) * tk[:, None]
        up = np.cross(tangent, np.array([1.0, 0.0, 0.0]))
        qa = np.abs(q[:, 0])
        qb = np.einsum("ij,ij->i", q, up)
        qt = np.einsum("ij,ij->i", q, tangent)
        w = np.maximum(v[:, 2], 1e-5)
        h = np.maximum(np.where(qb > 0, v[:, 3], v[:, 4]), 1e-5)
        e = np.where(qb > 0, v[:, 5], v[:, 6])
        kk = ((qa / w) ** e + (np.abs(qb) / h) ** e) ** (1.0 / e)
        sec = (kk - 1.0) * np.minimum(w, h)
        end = ((k == 0) & (tk <= 0)) | ((k == len(a) - 1) & (tk >= 1))
        out[s:s + chunk] = np.where(end, np.maximum(sec, np.abs(qt)), sec)
    return out


_TORSO = sweep_rows(TORSO["path"], [TORSO["half_width"], TORSO["half_up"], TORSO["half_down"],
                                    [2.0] * len(TORSO["path"]), [2.0] * len(TORSO["path"])])
_NECK = sweep_rows(NECK["path"], [NECK["half_width"], NECK["half_depth"], NECK["half_depth"],
                                  [2.0] * len(NECK["path"]), [2.0] * len(NECK["path"])])
_HEAD = sweep_rows(list(zip(HEAD["y"], HEAD["z"])), [HEAD["half_width"], HEAD["half_up"], HEAD["half_down"],
                                                      HEAD["e_up"], HEAD["e_down"]], sub=8)


def gape_y(z):
    return np.interp(z, [a for a, _ in GAPE["y"]], [b for _, b in GAPE["y"]])


def mouth_cut(p):
    """Negative in the mouth: under the gape line, ahead of its corner."""
    return np.maximum(p[:, 1] - gape_y(p[:, 2]), GAPE["corner"] - p[:, 2])


def head_field(p):
    f = sweep_field(p, _HEAD)
    m = mirror_x(p)
    f = smin(f, ellipsoid(m, BROW["centre"], BROW["radii"]), 0.010)
    socket = np.linalg.norm(m - np.array(EYE["centre"]), axis=1) - EYE["socket"]
    f = smax(f, -socket, 0.004)
    return smax(f, -mouth_cut(p), 0.0025)


def shell_field(p):
    f = sweep_field(p, _TORSO)
    f = smin(f, sweep_field(p, _NECK), 0.045)
    m = mirror_x(p)
    f = smin(f, ellipsoid(m, SHOULDER["centre"], SHOULDER["radii"]), 0.04)
    f = smin(f, ellipsoid(m, HIP["centre"], HIP["radii"]), 0.03)
    return smin(f, head_field(p), 0.03)


def gradient(field, p, h=2e-4):
    g = np.zeros_like(p)
    for k in range(3):
        d = np.zeros(3)
        d[k] = h
        g[:, k] = (field(p + d) - field(p - d)) / (2 * h)
    return g


def project(field, p, steps=6):
    """Moves points onto the field's zero level along its gradient."""
    p = p.copy()
    for _ in range(steps):
        f = field(p)
        g = gradient(field, p)
        p -= (f / np.maximum(np.einsum("ij,ij->i", g, g), 1e-12))[:, None] * g
    return p


def cast(field, origins, dirs, far=0.6, step=0.002):
    """For each ray from inside, the first point where the field crosses zero."""
    n = len(origins)
    hit = np.full(n, far)
    active = np.arange(n)
    t = 0.0
    while t < far and len(active):
        t += step
        f = field(origins[active] + dirs[active] * t)
        out = f > 0
        hit[active[out]] = t
        active = active[~out]
    lo, hi = np.maximum(hit - step, 0), hit.copy()
    for _ in range(18):
        mid = (lo + hi) / 2
        out = field(origins + dirs * mid[:, None]) > 0
        hi = np.where(out, mid, hi)
        lo = np.where(out, lo, mid)
    return origins + dirs * hi[:, None]


def outward(field, p):
    g = gradient(field, p)
    return g / np.linalg.norm(g, axis=1, keepdims=True)


# =====================================================================================================================
# Slicing the shell into rings
# =====================================================================================================================


def _neck_frame(s):
    """The neck's centre line at fraction s of its length: point and unit tangent, both (y, z)."""
    rows = sweep_rows(NECK["path"], [NECK["half_width"]], sub=12)
    pts = rows[:, :2]
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    acc = np.concatenate([[0], np.cumsum(seg)])
    at = s * acc[-1]
    i = min(int(np.searchsorted(acc, at)) - 1, len(seg) - 1)
    i = max(i, 0)
    t = (at - acc[i]) / seg[i]
    p = pts[i] + (pts[i + 1] - pts[i]) * t
    d = (pts[i + 1] - pts[i]) / seg[i]
    return p, d


def slicing_planes():
    """Candidate ring planes from the tail to the beak, finely spaced: (centre, up, normal), in the animal's frame.
    `up` is the direction of the ring's first point: the top midline, or the back of the neck."""
    out = []
    y1, z1 = P1
    y2, z2 = P2
    for z in np.linspace(TORSO["path"][0][1] + 0.003, z1, 150, endpoint=False):
        y = float(np.interp(z, [b for _, b in TORSO["path"]], [a for a, _ in TORSO["path"]]))
        out.append((np.array([0.0, y, z]), np.array([0.0, 1.0, 0.0]), np.array([0.0, 0.0, 1.0]), "torso"))
    # into the neck: about P1 from upright to across the neck where the fan meets it
    s1 = 0.30
    p, d = _neck_frame(s1)
    a1 = math.atan2(d[0], d[1])
    for a in np.linspace(0, a1, 60, endpoint=False):
        n = np.array([0.0, math.sin(a), math.cos(a)])
        e = np.array([0.0, -math.cos(a), math.sin(a)])
        out.append((np.array([0.0, y1, z1]) + e * 0.22, -e, n, "torso"))
    # across the neck
    for s in np.linspace(s1, 0.86, 70, endpoint=False):
        p, d = _neck_frame(s)
        up = np.array([0.0, d[1], -d[0]])
        out.append((np.array([0.0, p[0], p[1]]), up, np.array([0.0, d[0], d[1]]), "neck"))
    # into the head: about P2 from across the neck to upright
    p, d = _neck_frame(0.86)
    a2 = math.atan2(d[0], d[1])
    for a in np.linspace(a2, 0, 70, endpoint=False):
        n = np.array([0.0, math.sin(a), math.cos(a)])
        e = np.array([0.0, math.cos(a), -math.sin(a)])
        out.append((np.array([0.0, y2, z2]) + e * 0.13, e, n, "head"))
    for z in np.linspace(z2, HEAD["z"][-1] - 0.002, 160):
        y = float(np.interp(z, HEAD["z"], HEAD["y"]))
        out.append((np.array([0.0, y, z]), np.array([0.0, 1.0, 0.0]), np.array([0.0, 0.0, 1.0]), "head"))
    return out


def ring_points(field, planes, fine=140):
    """The section of the field in each plane: `fine` points from the top midline round the animal's left to the
    bottom midline. Each centre is first moved to the middle of its section along `up`."""
    th = np.linspace(0, math.pi, fine)
    ups = np.array([u for _, u, _, _ in planes])
    centres = np.array([c for c, _, _, _ in planes])
    for _ in range(2):
        ends = cast(field, np.concatenate([centres, centres]), np.concatenate([ups, -ups]))
        top = np.einsum("ij,ij->i", ends[:len(planes)] - centres, ups)
        bottom = np.einsum("ij,ij->i", ends[len(planes):] - centres, ups)
        centres = centres + ups * ((top + bottom) / 2)[:, None]
    dirs = np.cos(th)[None, :, None] * ups[:, None, :] + np.sin(th)[None, :, None] * np.array([1.0, 0.0, 0.0])
    origins = np.repeat(centres[:, None, :], fine, 1)
    hits = cast(field, origins.reshape(-1, 3), dirs.reshape(-1, 3))
    return hits.reshape(len(planes), fine, 3), centres


def resample(points, count):
    """`count` + 1 points spaced evenly along a polyline, ends kept."""
    seg = np.linalg.norm(np.diff(points, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    want = np.linspace(0, s[-1], count + 1)
    return np.stack([np.interp(want, s, points[:, k]) for k in range(3)], axis=1)


def ring_weight(c):
    """How closely rings are wanted: closest on the face, close on the neck, along the beak no closer than the body."""
    y, z = c[1], c[2]
    if y > 1.15 and z > 0.40:
        return 0.9 if z > 0.95 else 2.1
    if y > 0.92:
        return 1.35
    return 1.0


def shell_grid(field):
    """The shell's rings, picked from the candidate planes so they lie about evenly apart over the surface, closer
    where ring_weight asks: rows of AROUND // 2 + 1 points (top midline round the left to the bottom midline), the two
    poles, each row's centre and piece. Once the layout is published the rings stay in the planes it has."""
    half = AROUND // 2
    planes = slicing_planes()
    sections, centres = ring_points(field, planes)
    rings = [resample(r, half) for r in sections]
    pick = None if BODY_LAYOUT.fresh else BODY_LAYOUT.published().get("shell_rings")
    if pick is None:
        gap = np.array([np.mean(np.linalg.norm(b - a, axis=1)) for a, b in zip(rings, rings[1:])])
        weight = np.array([ring_weight(c) for c in centres])
        s = np.concatenate([[0], np.cumsum(gap * 0.5 * (weight[1:] + weight[:-1]))])
        pick = sorted(set(int(np.argmin(np.abs(s - t))) for t in np.linspace(0, s[-1], RINGS)))
    BODY_LAYOUT.extra["shell_rings"] = [int(i) for i in pick]
    rows = np.array([rings[i] for i in pick])
    back = cast(field, centres[pick[0]][None], -planes[pick[0]][2][None])[0]
    front = cast(field, centres[pick[-1]][None], planes[pick[-1]][2][None])[0]
    return rows, back, front, centres[pick], [planes[i][3] for i in pick]


def relax(field, rows, back, front, rounds=10, amount=0.35):
    """Evens the spacing of the grid over the surface, keeping it on the field and the midline on x = 0."""
    rows = rows.copy()
    n, m = rows.shape[:2]
    for _ in range(rounds):
        full = np.concatenate([rows, rows[:, -2:0:-1] * np.array([-1, 1, 1])], axis=1)
        k = full.shape[1]
        prev = np.concatenate([np.repeat(back[None, None], k, 1), full[:-1]], axis=0)
        nxt = np.concatenate([full[1:], np.repeat(front[None, None], k, 1)], axis=0)
        avg = (prev + nxt + np.roll(full, 1, axis=1) + np.roll(full, -1, axis=1)) / 4
        move = (avg - full)[:, :m].reshape(-1, 3)
        flat = rows.reshape(-1, 3)
        g = outward(field, flat)
        move -= np.einsum("ij,ij->i", move, g)[:, None] * g
        flat = project(field, flat + amount * move, 3)
        rows = flat.reshape(n, m, 3)
        rows[:, 0, 0] = 0
        rows[:, -1, 0] = 0
    return rows


# =====================================================================================================================
# Parts
# =====================================================================================================================


class Part:
    """A closed piece of the animal: points in its frame, faces of point indices with a colour region each, a
    material, the bones that move each point, edges drawn sharp, and where its texture is cut. A face may carry its
    own texture coordinates and its own normals at its corners; `island` names the piece of the texture it is on."""

    def __init__(self, name, material=BODY_MAT, region=BODY_R):
        self.name = name
        self.material = material
        self.region = region
        self.points = []
        self.faces = []
        self.regions = []
        self.uvs = []
        self.normals = []
        self.islands = []
        self.weights = []
        self.sharp = set()
        self.seams = set()

    def point(self, p, weights=None):
        self.points.append(tuple(float(x) for x in p))
        self.weights.append(weights)
        return len(self.points) - 1

    def face(self, idx, region=None, uv=None, island=None, normals=None):
        self.faces.append(tuple(int(i) for i in idx))
        self.regions.append(self.region if region is None else region)
        self.uvs.append(None if uv is None else [tuple(float(a) for a in c) for c in uv])
        self.normals.append(None if normals is None else [tuple(float(a) for a in c) for c in normals])
        self.islands.append(island or self.name)

    def weigh(self, fn):
        self.weights = [fn(np.array(p)) for p in self.points]

    def cut(self, a, b):
        if a != b:
            self.seams.add((min(a, b), max(a, b)))


def tube(part, rings, start=None, end=None, seam=None, uv=None, island=None):
    """Joins rings of points (each a closed loop of the same length) into a closed tube, each end closed on a point:
    `start` / `end` if given, else the ring's middle. With `seam` the texture is cut along that column. `uv`, given as
    (rings, k + 1, 2), lays the tube's texture out directly, the column after the last repeating the first."""
    idx = [[part.point(p) for p in ring] for ring in rings]
    k = len(rings[0])
    for i, (a, b) in enumerate(zip(idx, idx[1:])):
        for j in range(k):
            jj = (j + 1) % k
            q = None if uv is None else [uv[i][j], uv[i][j + 1], uv[i + 1][j + 1], uv[i + 1][j]]
            part.face((a[j], a[jj], b[jj], b[j]), uv=q, island=island)
    s = part.point(np.mean(rings[0], axis=0) if start is None else start)
    e = part.point(np.mean(rings[-1], axis=0) if end is None else end)
    for j in range(k):
        jj = (j + 1) % k
        qs = qe = None
        if uv is not None:
            c0 = np.mean(uv[0], axis=0) * 0 + np.array(uv[0][j]) + (np.array(uv[0][j + 1]) - np.array(uv[0][j])) / 2
            c1 = np.array(uv[-1][j]) + (np.array(uv[-1][j + 1]) - np.array(uv[-1][j])) / 2
            qs = [tuple(c0), uv[0][j + 1], uv[0][j]]
            qe = [tuple(c1), uv[-1][j], uv[-1][j + 1]]
        part.face((s, idx[0][jj], idx[0][j]), uv=qs, island=island)
        part.face((e, idx[-1][j], idx[-1][jj]), uv=qe, island=island)
    part.anchor = s
    if seam is not None:
        for a, b in zip(idx, idx[1:]):
            part.cut(a[seam], b[seam])
        part.cut(s, idx[0][seam])
        part.cut(e, idx[-1][seam])
    return idx, s, e


def _face(part, idx, region=None, uv=None, island=None, normals=None):
    """Adds a face, dropping repeated corners; nothing if fewer than three are left."""
    out, uvs, ns = [], [], []
    for k, i in enumerate(idx):
        if not out or out[-1] != i:
            out.append(i)
            uvs.append(None if uv is None else uv[k])
            ns.append(None if normals is None else normals[k])
    if len(out) > 1 and out[0] == out[-1]:
        out.pop()
        uvs.pop()
        ns.pop()
    if len(set(out)) >= 3:
        part.face(out, region, None if uv is None else uvs, island, None if normals is None else ns)


def pillow(part, outer, inner, island=None):
    """A closed thin solid from two grids of points (rows, cols, 3) with the same rim: outer's. Each side is a piece
    of the texture of its own."""
    rows, cols = outer.shape[:2]
    io = [[part.point(outer[i, j]) for j in range(cols)] for i in range(rows)]
    rim = lambda i, j: i in (0, rows - 1) or j in (0, cols - 1)
    ii = [[io[i][j] if rim(i, j) else part.point(inner[i, j]) for j in range(cols)] for i in range(rows)]
    for grid, flip, side in ((io, False, "_out"), (ii, True, "_in")):
        for i in range(rows - 1):
            for j in range(cols - 1):
                quad = (grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1])
                _face(part, quad[::-1] if flip else quad, island=(island or part.name) + side)
    return io, ii


def frame_along(points):
    """Unit tangents along a polyline, and a side vector at each point carried along it without twist."""
    pts = np.asarray(points, float)
    t = np.gradient(pts, axis=0)
    t /= np.linalg.norm(t, axis=1, keepdims=True)
    return t


def rings_along(points, radii, around, up_hint, phase=0.0):
    """Elliptical rings round a centre line: radii (a along `up`, b along the side), `around` points each, the first
    at `up` turned by `phase`. `up_hint` gives each ring's up before it is made square to the line."""
    pts = np.asarray(points, float)
    t = frame_along(pts)
    out = []
    for i, p in enumerate(pts):
        u = np.asarray(up_hint[i] if np.ndim(up_hint) == 2 else up_hint, float)
        u = u - t[i] * np.dot(u, t[i])
        u /= np.linalg.norm(u)
        s = np.cross(u, t[i])
        a, b = radii[i]
        ring = []
        for j in range(around):
            ang = 2 * math.pi * j / around + phase
            ring.append(p + u * (a * math.cos(ang)) + s * (b * math.sin(ang)))
        out.append(ring)
    return out


# =====================================================================================================================
# The shell
# =====================================================================================================================

def shell_part():
    rows, back, front, centres, pieces = shell_grid(shell_field)
    rows = relax(shell_field, rows, back, front)
    part = Part("shell")
    full = np.concatenate([rows, rows[:, -2:0:-1] * np.array([-1, 1, 1])], axis=1)
    idx, s, e = tube(part, list(full), back, front)
    part.grid = np.array(idx)
    part.centres = centres
    part.pieces = pieces
    part.poles = (s, e)
    return part


def shell_regions(c):
    """The colour region of a point of the shell, for the regions' guide: the horn of the beak and its cap over the
    skull; the eye streak; the mantle over the back narrowing into the nape line; the fuzz elsewhere; the mouth."""
    x, y, z = c
    if z > GAPE["corner"] - 0.004 and y < float(gape_y(z)) + 0.0015 and abs(x) < float(np.interp(z, HEAD["z"], HEAD["half_width"])) - 0.002:
        return BARE_R
    # the horn: ahead of a line just in front of the eye, rising over the top of the skull behind the crest's root
    if z > 0.40 and y > 1.18:
        edge = 0.732 + (y - 1.38) * 0.6
        if z > edge and y > 1.20:
            return HORN_R
        if y > 1.418 + (0.62 - z) * 0.35 and z > 0.47:
            return HORN_R
        # the streak through the eye, back to the nape
        if abs(x) > 0.035 and 1.352 < y < 1.392 + (z - 0.70) * 0.1 and z > 0.43:
            return PATTERN_R
    # the nape line up the back of the neck, from the mantle to the streak
    if y > 0.86 and abs(x) < 0.035 and z > 0.0 and z < 0.56:
        on_back = y - 0.84 > (z - 0.08) * 1.30
        if on_back:
            return PATTERN_R
    # the mantle over the back from the shoulders to the hips
    if -0.66 < z < 0.10 and y > 0.84 + 0.0 * z and abs(x) < 0.15:
        return PATTERN_R
    return BODY_R


# =====================================================================================================================
# Head parts
# =====================================================================================================================


def jaw_part():
    """The lower beak: its top flat under the gape line, its sides flush with the upper beak's cutting edges, rounded
    beneath. Its root lies inside the head, round the hinge."""
    part = Part("jaw", region=HORN_R)
    half = 6
    rings = []
    for z, w, depth in JAW:
        yg = float(gape_y(z)) - 0.0008
        ring = []
        # top midline, over the top's edge, down the side and round to the bottom midline (left half)
        for j in range(half + 1):
            a = j / half
            if a <= 0.25:
                s = a / 0.25
                ring.append((w * 0.92 * s, yg, z))
            else:
                s = (a - 0.25) / 0.75
                ang = s * math.pi / 2
                ring.append((w * math.cos(ang) * (1.0 - 0.08 * (1 - s)), yg - depth * math.sin(ang) ** 0.9, z))
        full = ring + [(-x, y, zz) for x, y, zz in reversed(ring[1:-1])]
        rings.append(full)
    back = (0.0, float(gape_y(JAW[0][0])) - JAW[0][2] / 2, JAW[0][0] - 0.012)
    idx, s, e = tube(part, rings, back, (0.0, float(gape_y(JAW[-1][0])) - 0.0005, JAW[-1][0] + 0.002))
    part.grid = np.array(idx)
    part.anchor = s
    for f, face in enumerate(part.faces):
        c = np.mean([part.points[v] for v in face], axis=0)
        top = all(abs(part.points[v][1] - (float(gape_y(part.points[v][2])) - 0.0008)) < 1e-4 for v in face)
        part.regions[f] = BARE_R if top else HORN_R
    return part


def crest_part():
    """The crest: one flat blade from inside the skull, sweeping up and back, rounded at the tip, with its band."""
    part = Part("crest", region=HORN_R)
    C = CREST
    rows = sweep_rows(C["path"], [C["half_thickness"], C["half_depth"]], sub=3)
    pts = np.stack([np.zeros(len(rows)), rows[:, 0], rows[:, 1]], 1)
    t = frame_along(pts)
    half = 8
    rings = []
    for i, p in enumerate(pts):
        th, dp = rows[i, 2], rows[i, 3]
        fwd = np.array([0.0, -t[i][2], t[i][1]])  # square to the blade's line, toward its front edge
        if fwd[2] < 0:
            fwd = -fwd
        ring = []
        for j in range(half + 1):
            ang = math.pi * j / half
            # a lens: thickest in the middle, thin at the front and back edges
            ring.append(p + fwd * (dp * math.cos(ang)) + np.array([1.0, 0, 0]) * (th * math.sin(ang) ** 0.8))
        full = ring + [q * np.array([-1, 1, 1]) for q in reversed(ring[1:-1])]
        rings.append(full)
    tip = pts[-1] + t[-1] * 0.002
    idx, s, e = tube(part, rings, pts[0] - t[0] * 0.01, tip)
    part.grid = np.array(idx)
    length = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))])
    frac = 1 - length / length[-1]  # 0 at the tip
    ring_of = {}
    for i, row in enumerate(idx):
        for v in row:
            ring_of[v] = i
    ring_of[s], ring_of[e] = 0, len(idx) - 1
    lo, hi = C["band"]
    for f, face in enumerate(part.faces):
        fr = np.mean([frac[ring_of[v]] for v in face])
        part.regions[f] = BAND_R if lo < fr < hi else HORN_R
    return part


def eye_part(sx):
    """An eyeball in its socket, looking out and a little forward."""
    part = Part("eye_l" if sx > 0 else "eye_r", region=BARE_R)
    c = np.array(EYE["centre"]) * np.array([sx, 1, 1])
    look = np.array(EYE["look"]) * np.array([sx, 1, 1])
    look /= np.linalg.norm(look)
    up = np.array([0.0, 1.0, 0.0])
    up -= look * np.dot(up, look)
    up /= np.linalg.norm(up)
    side = np.cross(up, look)
    r = EYE["radius"]
    rows, around = 7, 12
    rings = []
    for i in range(1, rows):
        a = math.pi * i / rows
        ring = []
        for j in range(around):
            b = 2 * math.pi * j / around
            ring.append(c + look * (r * math.cos(a)) + (up * math.cos(b) + side * math.sin(b)) * (r * math.sin(a)))
        rings.append(ring)
    idx, s, e = tube(part, rings, c + look * r, c - look * r, seam=around // 2)
    part.anchor = e
    return part


# =====================================================================================================================
# Wings
# =====================================================================================================================


def chain_points(names, side, start=0.0, end=0.0, step=0.04, knots=()):
    """Points along a chain of bones (left side's names), from `start` metres before its first joint to `end` past its
    last tail, about `step` apart, with points at every joint and at `knots` (distances along). Returns (points,
    distance along the chain from the first joint, the bone each point is on)."""
    joints = [np.array(rig._JOINT[n]) for n in names] + [np.array(rig._TAIL[names[-1]])]
    lengths = [np.linalg.norm(b - a) for a, b in zip(joints, joints[1:])]
    acc = np.concatenate([[0], np.cumsum(lengths)])
    total = acc[-1]
    marks = sorted(set([round(x, 5) for x in list(acc) + list(knots)] + [round(-start, 5), round(total + end, 5)]))
    marks = [m for m in marks if -start - 1e-9 <= m <= total + end + 1e-9]
    ds = []
    for a, b in zip(marks, marks[1:]):
        n = max(1, int(math.ceil((b - a) / step)))
        ds += [a + (b - a) * k / n for k in range(n)]
    ds.append(marks[-1])
    pts, on = [], []
    for d in ds:
        k = int(np.clip(np.searchsorted(acc, d, side="right") - 1, 0, len(lengths) - 1))
        t = (d - acc[k]) / lengths[k]
        p = joints[k] + (joints[k + 1] - joints[k]) * t
        pts.append(p * np.array([1 if side == "l" else -1, 1, 1]))
        on.append(names[k])
    return np.array(pts), np.array(ds), on


def _table(table, d, col):
    return float(np.interp(d, [r[0] for r in table], [r[col] for r in table]))


def strip_uv(rings, ds, origin, scale):
    """Texture coordinates for a tube laid out as a strip: along its length to the right, round it upward, each ring
    as wide as it is round, the column after the last repeating the first."""
    k = len(rings[0])
    circ = [sum(np.linalg.norm(np.asarray(r[(j + 1) % k]) - np.asarray(r[j])) for j in range(k)) for r in rings]
    vmid = origin[1] + max(circ) * scale / 2
    return [[(origin[0] + (ds[i] - ds[0]) * scale, vmid + (j / k - 0.5) * circ[i] * scale) for j in range(k + 1)]
            for i in range(len(rings))]


def chain_weights(ds, names, joints_at, blends, before=None):
    """Weights along a chain: each bone over its span, shared over `blends[k]` either side of joint k. `before` is a
    (bone, distance) the chain's start shares with, fading out by that distance."""
    out = []
    for d in ds:
        w = {}
        for k, n in enumerate(names):
            lo = joints_at[k]
            hi = joints_at[k + 1] if k + 1 < len(names) else 1e9
            rise = 1.0 if k == 0 else float(np.clip((d - lo) / (2 * blends[k - 1]) + 0.5, 0, 1))
            fall = 1.0 if k == len(names) - 1 else float(np.clip((hi - d) / (2 * blends[k]) + 0.5, 0, 1))
            v = min(rise, fall)
            if v > 0:
                w[n] = v
        if before is not None:
            bone, reach = before
            x = float(np.clip(1 - (d + 0.05) / (reach + 0.05), 0, 1)) * 0.5
            if x > 0:
                w = {n: v * (1 - x) for n, v in w.items()}
                w[bone] = w.get(bone, 0.0) + x
        out.append(w)
    return out


ARM_BONES = ["upper_arm_l", "forearm_l", "hand_l"]
FINGER_BONES = ["wing_1_l", "wing_2_l", "wing_3_l", "wing_4_l"]
LEG_BONES = ["thigh_l", "shin_l", "foot_l"]


def _joints_along(names):
    joints = [np.array(rig._JOINT[n]) for n in names] + [np.array(rig._TAIL[names[-1]])]
    return list(np.concatenate([[0], np.cumsum([np.linalg.norm(b - a) for a, b in zip(joints, joints[1:])])]))


def arm_part():
    """The arm from inside the shoulder to the knob of the knuckle: the leading edge of the wing, on the wing's
    material, laid out as a strip. Its texture is cut along the back, where the membrane goes in."""
    part = Part("arm_l", WING_MAT, BODY_R)
    at = _joints_along(ARM_BONES)
    pts, ds, _ = chain_points(ARM_BONES, "l", start=0.05, end=0.025, step=0.045,
                              knots=(at[1] - 0.03, at[1] + 0.03, at[2] - 0.03, at[2] + 0.03, at[3] - 0.03))
    around = 12
    radii = [(_table(ARM, d, 2), _table(ARM, d, 1)) for d in ds]
    rings = rings_along(pts, radii, around, (0.0, 0.0, -1.0))
    a = WING_UV["arm"]
    uv = strip_uv(rings, ds, (a[0], a[1]), a[2])
    end = pts[-1] + (pts[-1] - pts[-2]) / np.linalg.norm(pts[-1] - pts[-2]) * 0.018
    start = pts[0] - (pts[1] - pts[0]) / np.linalg.norm(pts[1] - pts[0]) * 0.01
    idx, s, e = tube(part, rings, start, end, seam=0, uv=uv, island="arm")
    w = chain_weights(ds, ARM_BONES, at, [0.035, 0.03], before=("chest", 0.07))
    for i, row in enumerate(idx):
        for v in row:
            part.weights[v] = dict(w[i])
    part.weights[s] = dict(w[0])
    part.weights[e] = {"hand_l": 1.0}
    part.anchor = s
    part.knuckle = e
    part.rings, part.ds = idx, ds
    return part


def finger_part():
    """The wing finger from inside the knuckle's knob to the tip, flattened in the wing's plane."""
    part = Part("finger_l", WING_MAT, BODY_R)
    at = _joints_along(FINGER_BONES)
    pts, ds, _ = chain_points(FINGER_BONES, "l", start=0.03, end=-0.012, step=0.07,
                              knots=(at[1] - 0.025, at[1] + 0.025, at[2] - 0.025, at[2] + 0.025, at[3] - 0.02,
                                     at[3] + 0.02, at[4] - 0.06))
    around = 8
    radii = [(_table(FINGER, d, 2), _table(FINGER, d, 1)) for d in ds]
    rings = rings_along(pts, radii, around, (0.0, 0.0, -1.0))
    f = WING_UV["finger"]
    uv = strip_uv(rings, ds, (f[0], f[1]), f[2])
    start = pts[0] - (pts[1] - pts[0]) / np.linalg.norm(pts[1] - pts[0]) * 0.012
    idx, s, e = tube(part, rings, start, np.array(rig._TAIL["wing_4_l"]), seam=0, uv=uv, island="finger")
    w = chain_weights(ds, FINGER_BONES, at, [0.025, 0.025, 0.02])
    for i, row in enumerate(idx):
        for v in row:
            part.weights[v] = dict(w[i])
    part.weights[s] = {"wing_1_l": 1.0}
    part.weights[e] = {"wing_4_l": 1.0}
    part.anchor = s
    part.ds = ds
    for f, face in enumerate(part.faces):
        if np.mean([part.points[v][0] for v in face]) > 0.80 * rig.TRAILING_EDGE[-1][0]:
            part.regions[f] = PATTERN_R
    return part


def _ring_of(idx):
    out = {}
    for i, row in enumerate(idx):
        for v in row:
            out[v] = i
    return out


def hand_part():
    """The three small clawed fingers at the bend of the wing, lying forward along the leading edge, curling down."""
    part = Part("hand_l", BODY_MAT, HORN_R)
    root = np.array(rig._JOINT["fingers_l"])
    d0 = np.array(rig._TAIL["fingers_l"]) - root
    d0 /= np.linalg.norm(d0)
    up = np.array([0.0, 1.0, 0.0])
    up -= d0 * np.dot(up, d0)
    up /= np.linalg.norm(up)
    side = np.cross(d0, up)
    for n, (out, down, length, hw, claw) in enumerate(HAND):
        a, b = math.radians(out), math.radians(down)
        d = d0 * math.cos(a) + side * math.sin(a)
        d = d * math.cos(b) - up * math.sin(b)
        d /= np.linalg.norm(d)
        steps = 7
        claw_at = length / (length + claw)
        line, radii = [root + up * 0.030 - d * 0.012 + side * (0.012 * (n - 1))], []
        for k in range(steps + 1):
            t = k / steps
            bend = math.radians(55) * max(0.0, (t - claw_at * 0.6) / (1 - claw_at * 0.6)) ** 1.8
            dd = d * math.cos(bend) - up * math.sin(bend)
            if k:
                line.append(line[-1] + dd * (length + claw) / steps)
            r = hw * (1.0 - 0.25 * t) if t <= claw_at else hw * 0.75 * (1 - (t - claw_at) / (1 - claw_at)) ** 0.9 + 0.0006
            radii.append((r * 0.95, r))
        rings = rings_along(line, radii, 6, up)
        first = len(part.faces)
        idx, s, e = tube(part, rings, line[0] - d * 0.006, line[-1] + (line[-1] - line[-2]) * 0.3, seam=3,
                         island=f"hand_{n}")
        ring = _ring_of(idx)
        claw_ring = int(claw_at * steps) + 1
        for f in range(first, len(part.faces)):
            rs = [ring[v] for v in part.faces[f] if v in ring]
            part.regions[f] = BARE_R if (rs and min(rs) >= claw_ring) or e in part.faces[f] else HORN_R
        for v in range(len(part.points)):
            if part.weights[v] is None:
                part.weights[v] = {"fingers_l": 1.0}
        if n == 1:
            part.anchor = s
    return part


def leg_part():
    """The leg from inside the hip to the ball of the foot: thigh, shin and the flattened foot."""
    part = Part("leg_l", BODY_MAT, BODY_R)
    at = _joints_along(LEG_BONES)
    pts, ds, _ = chain_points(LEG_BONES, "l", start=0.04, end=0.0, step=0.04,
                              knots=(at[1] - 0.025, at[1] + 0.025, at[2] - 0.02, at[2] + 0.02))
    around = 10
    radii = [(_table(LEG, d, 2), _table(LEG, d, 1)) for d in ds]
    rings = rings_along(pts, radii, around, (0.0, 1.0, 0.0))
    end = pts[-1] + (pts[-1] - pts[-2]) / np.linalg.norm(pts[-1] - pts[-2]) * 0.012
    start = pts[0] - (pts[1] - pts[0]) / np.linalg.norm(pts[1] - pts[0]) * 0.01
    idx, s, e = tube(part, rings, start, end, seam=around // 2, island="leg")
    w = chain_weights(ds, LEG_BONES, at, [0.03, 0.02], before=("pelvis", 0.06))
    for i, row in enumerate(idx):
        for v in row:
            part.weights[v] = dict(w[i])
    part.weights[s] = dict(w[0])
    part.weights[e] = {"foot_l": 0.6, "toes_l": 0.4}
    ring = _ring_of(idx)
    ring[s], ring[e] = 0, len(idx) - 1
    for f, face in enumerate(part.faces):
        d = np.mean([ds[ring[v]] for v in face])
        part.regions[f] = HORN_R if d > at[2] - 0.07 else BODY_R
    part.anchor = s
    part.ball = e
    return part


def toes_part():
    """Four long grasping toes from the ball of the foot, each ending in a long, strongly curved claw that hooks
    toward the sole (up, in the glide)."""
    part = Part("toes_l", BODY_MAT, HORN_R)
    root = np.array(rig._JOINT["toes_l"])
    d0 = np.array(rig._TAIL["toes_l"]) - root
    d0 /= np.linalg.norm(d0)
    sole = np.array([0.0, 1.0, 0.0])
    sole -= d0 * np.dot(sole, d0)
    sole /= np.linalg.norm(sole)
    side = np.cross(sole, d0)
    for n, (head, length, hw, claw) in enumerate(TOES):
        a = math.radians(head)
        d = d0 * math.cos(a) + side * math.sin(a)
        steps = 8
        claw_at = length / (length + claw)
        line, radii = [root + side * (0.013 * (n - 1.5)) - d * 0.010], []
        for k in range(steps + 1):
            t = k / steps
            bend = math.radians(18) * t + math.radians(80) * max(0.0, (t - claw_at) / (1 - claw_at)) ** 1.3
            dd = d * math.cos(bend) + sole * math.sin(bend)
            if k:
                line.append(line[-1] + dd * (length + claw) / steps)
            r = hw * (1.0 - 0.35 * t / claw_at) if t <= claw_at else hw * 0.65 * (1 - (t - claw_at) / (1 - claw_at)) ** 0.85 + 0.0005
            radii.append((r * 0.85, r))
        rings = rings_along(line, radii, 6, sole)
        first = len(part.faces)
        idx, s, e = tube(part, rings, line[0] - d * 0.006, line[-1] + (line[-1] - line[-2]) * 0.4, seam=3,
                         island=f"toe_{n}")
        ring = _ring_of(idx)
        claw_ring = int(claw_at * steps) + 1
        for f in range(first, len(part.faces)):
            rs = [ring[v] for v in part.faces[f] if v in ring]
            part.regions[f] = BARE_R if (rs and min(rs) >= claw_ring) or e in part.faces[f] else HORN_R
        for v in range(len(part.points)):
            if part.weights[v] is None:
                part.weights[v] = {"toes_l": 1.0}
        for v in idx[0] + [s]:
            part.weights[v] = {"toes_l": 0.6, "foot_l": 0.4}
        if n == 1:
            part.anchor = s
    return part


# ---- the membrane ---------------------------------------------------------------------------------------------------


def _on_line_at_x(points, xs):
    """Points on a polyline that runs in x, at each x."""
    pts = np.asarray(points, float)
    return np.stack([np.interp(xs, pts[:, 0], pts[:, k]) for k in range(3)], 1)


def leading_edge():
    names = ["upper_arm_l", "forearm_l", "hand_l", "wing_1_l", "wing_2_l", "wing_3_l", "wing_4_l"]
    return [rig._JOINT[n] for n in names] + [rig._TAIL["wing_4_l"]]


def membrane_columns():
    """Each column's leading edge x and trailing edge x, root to tip."""
    out = []
    for (lx0, tx0, n), (lx1, tx1, _) in zip(SPAN_COLUMNS, SPAN_COLUMNS[1:]):
        for c in range(n):
            f = c / n
            out.append((lx0 + (lx1 - lx0) * f, tx0 + (tx1 - tx0) * f))
    out.append(SPAN_COLUMNS[-1][:2])
    return out


def membrane_grid(field=None):
    """The left membrane's middle surface at rest: (columns, rows, 3), and each column's fraction of the span. A Coons
    patch between the leading edge (the arm and finger's line), the trailing edge, and the root, which runs inside the
    flank from the shoulder to the hip and down the outside of the thigh and shin to the ankle; the root's bow fades
    out by a third of the span. A little camber lifts the middle of each chord, as the air does in the glide."""
    cols = membrane_columns()
    lead = _on_line_at_x(leading_edge(), [c[0] for c in cols])
    dense = np.array(rig._catmull(rig.TRAILING_EDGE, 16))
    trail = _on_line_at_x(dense, [c[1] for c in cols])
    nv = CHORD_ROWS + 1
    root = np.array([tuple(p) for p in rig._resample(rig.WING_ROOT, nv)])
    # rig.py's root runs about a centimetre outside the flank; it is taken in to lie inside it, and inside the leg
    for j in range(nv):
        root[j][0] -= ROOT_IN * math.sin(math.pi * j / (nv - 1)) ** 0.4
    x0, x1 = lead[0][0], lead[-1][0]
    grid = np.zeros((len(cols), nv, 3))
    for i in range(len(cols)):
        u = (lead[i][0] - x0) / (x1 - x0)
        fade = 1.0 - np.clip(u / 0.30, 0, 1)
        fade = fade * fade * (3 - 2 * fade)
        chord = np.linalg.norm(trail[i] - lead[i])
        for j in range(nv):
            v = j / (nv - 1)
            base = (1 - v) * lead[i] + v * trail[i]
            bow = root[j] - ((1 - v) * root[0] + v * root[-1])
            lift = 0.02 * chord * math.sin(math.pi * v) * min(1.0, u / 0.12) * min(1.0, (1 - u) / 0.15)
            grid[i, j] = base + bow * fade + np.array([0.0, lift, 0.0])
    fracs = [(lead[i][0] - x0) / (x1 - x0) for i in range(len(cols))]
    return grid, fracs


def grid_normals(grid):
    du = np.gradient(grid, axis=0)
    dv = np.gradient(grid, axis=1)
    n = np.cross(du, dv)
    n /= np.maximum(np.linalg.norm(n, axis=2, keepdims=True), 1e-12)
    flip = n[..., 1:2] < 0
    return np.where(flip, -n, n)


def wing_uv(p, face):
    """Where a point of the left wing at rest lies on the wing material's picture of its upper or under face."""
    s = WING_UV["scale"]
    x0, x1 = WING_UV["x"]
    z0 = WING_UV["z"][0]
    x, z = abs(p[0]), p[2]
    if face == "upper":
        o = WING_UV["upper"]
        return (o[0] + (x1 - x) * s, o[1] + (z - z0) * s)
    o = WING_UV["under"]
    return (o[0] + (x - x0) * s, o[1] + (z - z0) * s)


def slab(part, grid, weights, island, thick_at):
    """A thin closed slab over a grid of middle points (columns, rows, 3): an upper face, an under face, and a rim they
    share (the first and last column and row). A column whose points are all one place is one point. Each face's
    corners carry the middle surface's normal, up or down, so each side is shaded as one side of the skin, and the
    texture each side has on the wing's picture."""
    nu, nv = grid.shape[:2]
    n = grid_normals(grid)
    up, dn = [], []
    for i in range(nu):
        if np.ptp(grid[i], axis=0).max() < 1e-7:
            v = part.point(grid[i, 0], dict(weights[i][0]))
            up.append([v] * nv)
            dn.append([v] * nv)
            continue
        ru, rd = [], []
        for j in range(nv):
            if i in (0, nu - 1) or j in (0, nv - 1):
                v = part.point(grid[i, j], dict(weights[i][j]))
                ru.append(v)
                rd.append(v)
            else:
                h = thick_at(i, j)
                ru.append(part.point(grid[i, j] + n[i, j] * h, dict(weights[i][j])))
                rd.append(part.point(grid[i, j] - n[i, j] * h, dict(weights[i][j])))
        up.append(ru)
        dn.append(rd)
    part.slab = (up, dn)
    for i in range(nu - 1):
        for j in range(nv - 1):
            cells = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
            _face(part, [up[a][b] for a, b in cells], uv=[wing_uv(grid[a, b], "upper") for a, b in cells],
                  island=island + "_upper", normals=[tuple(n[a, b]) for a, b in cells])
            cells = cells[::-1]
            _face(part, [dn[a][b] for a, b in cells], uv=[wing_uv(grid[a, b], "under") for a, b in cells],
                  island=island + "_under", normals=[tuple(-n[a, b]) for a, b in cells])
    return up, dn


def membrane_part(skin=()):
    """The left wing's membrane, a closed slab from the arm and finger to the trailing edge and the flank and leg.
    `skin` is the parts its root is grown into (the shell and the leg), whose weights the root takes."""
    part = Part("membrane_l", WING_MAT, SKIN_R)
    grid, fracs = membrane_grid()
    nu, nv = grid.shape[:2]
    weights = membrane_weights(grid, fracs, skin)

    def thick(i, j):
        k = min(i, nu - 1 - i, j, nv - 1 - j)
        return MEMBRANE_HALF * (0.55 if k == 1 else 1.0)

    slab(part, grid, weights, "membrane", thick)
    part.grid = grid
    part.fracs = fracs
    for f, face in enumerate(part.faces):
        c = np.mean([part.points[v] for v in face], axis=0)
        part.regions[f] = membrane_region(c)
    return part


def membrane_region(c):
    """For the regions' guide: dark tips on the outer fifth of the span, the wash by the body, the membrane."""
    x = abs(c[0])
    if x > 0.80 * rig.TRAILING_EDGE[-1][0]:
        return PATTERN_R
    if x < 0.15 + 0.40:
        return WASH_R
    return SKIN_R


def _knots(knots, t):
    """Weights {bone: w} from knots [(t, bone)], the two knots either side of t shared linearly."""
    if t <= knots[0][0]:
        return {knots[0][1]: 1.0}
    for (t0, a), (t1, b) in zip(knots, knots[1:]):
        if t <= t1:
            k = (t - t0) / max(t1 - t0, 1e-9)
            return {a: 1.0 - k, b: k} if a != b else {a: 1.0}
    return {knots[-1][1]: 1.0}


def _smooth(v):
    v = min(max(v, 0.0), 1.0)
    return v * v * (3 - 2 * v)


def _add(out, w, k):
    for b, x in w.items():
        out[b] = out.get(b, 0.0) + x * k


def lead_weights(p):
    """A point of the leading edge follows the arm or the wing finger exactly as their tubes' rings there do, so it
    stays inside them."""
    for names, blends, before in ((ARM_BONES, [0.035, 0.03], ("chest", 0.07)), (FINGER_BONES, [0.025, 0.025, 0.02], None)):
        at = _joints_along(names)
        joints = [np.array(rig._JOINT[n]) for n in names] + [np.array(rig._TAIL[names[-1]])]
        if p[0] > joints[-1][0] - 1e-6 and names is ARM_BONES:
            continue
        best, d = 1e9, 0.0
        for k in range(len(names)):
            a, b = joints[k], joints[k + 1]
            t = float(np.clip(np.dot(p - a, b - a) / np.dot(b - a, b - a), 0, 1))
            dd = np.linalg.norm(p - (a + (b - a) * t))
            if dd < best:
                best, d = dd, at[k] + t * np.linalg.norm(b - a)
        w = chain_weights([d], names, at, blends, before=before)[0]
        total = sum(w.values())
        return {n: x / total for n, x in w.items()}


def skin_weights_at(p, parts, most=4):
    """The weights of the skin of `parts` nearest p, the four nearest points blended by closeness."""
    pts = np.concatenate([np.array(q.points) for q in parts])
    ws = [w for q in parts for w in q.weights]
    d = np.linalg.norm(pts - p, axis=1)
    idx = np.argsort(d)[:most]
    share = 1.0 / np.maximum(d[idx], 1e-4)
    out = {}
    for i, x in zip(idx, share / share.sum()):
        _add(out, ws[int(i)], x)
    return out


def membrane_weights(grid, fracs, skin):
    """The membrane's weights, column by column (its span) and row by row (its chord), as MEMBRANE_FIT has them.

    The leading edge follows the arm and the wing finger as their tubes do, and the root the body and leg skin it is
    grown into. In between, each point blends the bone of the leading edge in front of it with the battens either side
    of it across the span (rig.py: web_1 at the elbow, web_2 at the wrist, web_3 on the wing finger, the finger's last
    bone at the tip; and nearest the body, the body's own bones). The battens take over going back across the chord,
    and the result is smoothed over the grid. MEMBRANE_FIT's numbers were searched together with rig.py's FOLD, TUCK
    and FINGER_ROLL so the folded skin lies in layers that do not cross one another or the body, with no fold tighter
    than the skin is thick (ref/wing/)."""
    F = MEMBRANE_FIT
    nu, nv = grid.shape[:2]
    left = rig._JOINT["upper_arm_l"][0]
    span = rig._TAIL["wing_4_l"][0] - left
    along = lambda name: (rig._JOINT[name][0] - left) / span
    reach = F["root_reach"]
    ribs = [(0.0, "root"), (reach, "web_1_l")] + ([(along("forearm_l"), "web_1_l")] if reach < along("forearm_l") else []) + \
           [(along("hand_l"), "web_2_l"), (along("wing_2_l"), "web_3_l"), (1.0, "wing_4_l")]
    lead = [lead_weights(grid[i, 0]) for i in range(nu)]
    root = [skin_weights_at(grid[0, j], skin) if skin else {"chest": 1.0} for j in range(nv)]
    body = [_knots([(0.0, "chest"), (0.35, "spine"), (0.7, "pelvis")], j / (nv - 1)) for j in range(nv)]
    W = {}
    for i in range(nu):
        u = fracs[i]
        for j in range(nv):
            v = j / (nv - 1)
            if i == nu - 1:
                W[i, j] = {"wing_4_l": 1.0}
            elif j == 0:
                W[i, j] = dict(lead[i])
            elif i == 0:
                W[i, j] = dict(root[j])
            else:
                knots = _knots(ribs, u)
                if F["span_ease"] and len(knots) == 2:
                    (a, wa), (b, wb) = knots.items()
                    wb = wb + F["span_ease"] * (_smooth(wb) - wb)
                    knots = {a: 1 - wb, b: wb}
                rib = {}
                for name, w in knots.items():
                    _add(rib, body[j] if name == "root" else {name: 1.0}, w)
                v1 = F["v1_inner"] if u < along("hand_l") + 0.17 else F["v1_outer"]
                v0 = F["v0"] * v1
                s = _smooth((v - v0) / max(v1 - v0, 1e-3)) * F["rib_max"]
                w = {}
                _add(w, lead[i], 1 - s)
                _add(w, rib, s)
                W[i, j] = w
    for _ in range(F["smooth"]):
        new = {}
        for (i, j), w in W.items():
            if j == 0 or i == 0 or i == nu - 1:
                new[i, j] = w
                continue
            near = [c for c in ((i + 1, j), (i - 1, j), (i, j + 1), (i, j - 1)) if c in W]
            acc = {}
            for c in near:
                _add(acc, W[c], 1.0 / len(near))
            o = {}
            _add(o, w, 0.5)
            _add(o, acc, 0.5)
            new[i, j] = o
        W = new
    return [[finish_weights([W[i, j]])[0] for j in range(nv)] for i in range(nu)]


FRONT_EDGE = [(0.140, 0.760, 0.060), (0.300, 0.792, 0.112), (0.500, 0.836, 0.122), (0.700, 0.866, 0.112),
              (0.850, 0.884, 0.080), (0.966, 0.898, 0.040)]


def front_part():
    """The narrow front membrane in the angle before the arm, from the shoulder to the wrist, braced by the pteroid."""
    part = Part("front_l", WING_MAT, SKIN_R)
    xs = np.linspace(0.15, 0.966, FRONT_COLUMNS + 1)
    back = _on_line_at_x([rig._JOINT[n] for n in ARM_BONES] + [rig._TAIL["hand_l"]], xs)
    front = _on_line_at_x(rig._catmull(FRONT_EDGE, 8), xs)
    front[0] = back[0] + np.array([-0.01, 0.02, 0.06])
    front[-1] = back[-1]
    rows = FRONT_ROWS + 1
    # rows run from the free edge back to the arm, as the membrane's run from the leading edge back
    grid = np.array([[front[i] + (back[i] - front[i]) * (j / (rows - 1)) for j in range(rows)] for i in range(len(xs))])
    names = ["upper_arm_l", "forearm_l", "pteroid_l"]
    weights = []
    for i in range(len(xs)):
        row = []
        for j in range(rows):
            p = grid[i, j]
            w = {nm: (1.6 if nm == "pteroid_l" else 1.0) / max(_segment_distance(p, *BONES[nm]), 0.01) ** 3 for nm in names}
            if p[0] < 0.26:
                w["chest"] = sum(w.values()) * (0.26 - p[0]) / 0.11
            t = sum(w.values())
            row.append({k: x / t for k, x in w.items()})
        weights.append(row)
    slab(part, grid, weights, "membrane", lambda i, j: MEMBRANE_HALF * 0.8)
    for f in range(len(part.faces)):
        part.regions[f] = WASH_R
    part.grid = grid
    return part


# =====================================================================================================================
# Weights
# =====================================================================================================================


def _segment_distance(p, a, b):
    ab = b - a
    t = np.clip(np.dot(p - a, ab) / max(np.dot(ab, ab), 1e-12), 0, 1)
    return float(np.linalg.norm(p - (a + ab * t)))


BONES = {b[0]: (np.array(b[2]), np.array(b[3])) for b in rig.all_bones()}
SPINE = ["tail", "pelvis", "spine", "chest", "neck_1", "neck_2", "neck_3", "neck_4", "skull"]
# How far either side of each joint along SPINE the skin shares the two bones.
SPINE_BLEND = [0.05, 0.09, 0.09, 0.06, 0.035, 0.035, 0.035, 0.04]


def spine_weights(centre):
    """Weights for a ring of the shell from where its centre lies along the spine: each bone's span, shared over
    SPINE_BLEND either side of each joint. The tail hangs behind the pelvis, so the chain runs from its tip, and the
    rump between the tail's joint and the pelvis's is shared."""
    chain = [BONES["tail"][1], BONES["tail"][0]] + [BONES[n][0] for n in SPINE[1:]] + [BONES["skull"][1]]
    lengths = [np.linalg.norm(b - a) for a, b in zip(chain, chain[1:])]
    best, at, s0 = 1e9, 0.0, 0.0
    for a, b, L in zip(chain, chain[1:], lengths):
        ab = b - a
        t = np.clip(np.dot(centre - a, ab) / np.dot(ab, ab), 0, 1)
        d = np.linalg.norm(centre - (a + ab * t))
        if d < best:
            best, at = d, s0 + t * L
        s0 += L
    marks = np.concatenate([[0], np.cumsum(lengths)])
    spans = [("tail", marks[0], (marks[1] + marks[2]) / 2), ("pelvis", (marks[1] + marks[2]) / 2, marks[3])]
    for k, n in enumerate(SPINE[2:]):
        spans.append((n, marks[3 + k], marks[4 + k] if 4 + k < len(marks) else 1e9))
    w = {}
    for k, (n, lo, hi) in enumerate(spans):
        rise = 1.0 if k == 0 else float(np.clip((at - lo) / (2 * SPINE_BLEND[k - 1]) + 0.5, 0, 1))
        fall = 1.0 if k == len(spans) - 1 else float(np.clip((hi - at) / (2 * SPINE_BLEND[k]) + 0.5, 0, 1))
        v = min(rise, fall)
        if v > 0:
            w[n] = v
    return w


def shell_weights(part):
    """The shell follows the spine ring by ring, with the arms, thighs and jaw pulling on the skin near them."""
    grid = part.grid
    n_rings = grid.shape[0]
    ring_of = _ring_of(grid)
    s, e = part.poles
    ring_of[s], ring_of[e] = 0, n_rings - 1
    spine = [spine_weights(c) for c in part.centres]
    out = []
    hinge = np.array(rig._JOINT["jaw"])
    for v, p in enumerate(np.array(part.points)):
        w = dict(spine[ring_of[v]])
        x, y, z = p
        side = "l" if x > 0 else "r"
        # the shoulders' skin goes a little with the upper arm
        d = np.linalg.norm(p - BONES["upper_arm_" + side][0])
        if d < 0.13 and abs(x) > 0.06:
            w["upper_arm_" + side] = 0.45 * (1 - d / 0.13) ** 2
        # the thighs pull the skin over the hips
        d = _segment_distance(p, *BONES["thigh_" + side])
        if d < 0.10 and abs(x) > 0.03 and y < 0.80:
            w["thigh_" + side] = 0.9 * (1 - d / 0.10) ** 2
        # the cheek under the gape behind the corner of the mouth stretches down with the lower beak
        if hinge[2] - 0.02 < z < GAPE["corner"] + 0.03 and y < float(gape_y(z)) + 0.01:
            below = np.clip((float(gape_y(z)) + 0.01 - y) / 0.04, 0, 1)
            ahead = np.clip((z - hinge[2] + 0.02) / 0.10, 0, 1)
            k = float(below * ahead)
            if k > 0:
                w = {n: x_ * (1 - k) for n, x_ in w.items()}
                w["jaw"] = w.get("jaw", 0.0) + k
        out.append(w)
    part.weights = out


def finish_weights(weights, most=4):
    out = []
    for w in weights:
        top = sorted(((n, x) for n, x in w.items() if x > 1e-4), key=lambda kv: -kv[1])[:most]
        total = sum(x for _, x in top)
        out.append({n: x / total for n, x in top})
    return out


def smooth_weights(part, rounds=4, amount=0.5, keep=None):
    """Spreads each point's weights a little over its neighbours, so a bend is shared by the rings near it."""
    nbr = [set() for _ in part.points]
    for f in part.faces:
        for a, b in zip(f, f[1:] + f[:1]):
            nbr[a].add(b)
            nbr[b].add(a)
    w = part.weights
    for _ in range(rounds):
        new = []
        for v, ws in enumerate(w):
            if keep is not None and keep(v):
                new.append(ws)
                continue
            acc = {}
            for u in nbr[v]:
                for n, x in w[u].items():
                    acc[n] = acc.get(n, 0.0) + x / len(nbr[v])
            names = set(ws) | set(acc)
            new.append({n: (1 - amount) * ws.get(n, 0.0) + amount * acc.get(n, 0.0) for n in names})
        w = new
    part.weights = w


# =====================================================================================================================
# Assembly
# =====================================================================================================================


def mirrored(part, name):
    """The part on the other side: points across x, faces turned so they still face out, weights to the other side's
    bones. Its texture is the first part's, mirrored."""
    out = Part(name, part.material, part.region)
    out.points = [(-x, y, z) for x, y, z in part.points]
    out.faces = [f[::-1] for f in part.faces]
    out.regions = list(part.regions)
    out.uvs = [None if uv is None else uv[::-1] for uv in part.uvs]
    out.normals = [None if ns is None else [(-a, b, c) for a, b, c in ns[::-1]] for ns in part.normals]
    out.islands = list(part.islands)
    out.weights = [{rig._mirror_name(n): x for n, x in w.items()} for w in part.weights]
    out.sharp = set(part.sharp)
    out.seams = set(part.seams)
    out.oriented = getattr(part, "oriented", False)
    return out


def face_outward(part):
    """Turns each closed piece of a part so its faces look out: its volume, measured by its faces, is positive."""
    group = list(range(len(part.points)))

    def find(i):
        while group[i] != i:
            group[i] = group[group[i]]
            i = group[i]
        return i

    for f in part.faces:
        for v in f[1:]:
            group[find(v)] = find(f[0])
    pts = np.array(part.points)
    volume = {}
    for f in part.faces:
        g = find(f[0])
        a = pts[f[0]]
        for b, c in zip(f[1:-1], f[2:]):
            volume[g] = volume.get(g, 0.0) + np.dot(a, np.cross(pts[b], pts[c])) / 6
    for k, f in enumerate(part.faces):
        if volume[find(f[0])] < 0:
            part.faces[k] = f[::-1]
            if part.uvs[k] is not None:
                part.uvs[k] = part.uvs[k][::-1]
            if part.normals[k] is not None:
                part.normals[k] = part.normals[k][::-1]


def split(part, f, seen):
    """A face's triangles, as corner numbers: a quad is cut on its shorter diagonal, the same way on both sides of the
    animal (lengths and ties are read from mirror-blind positions)."""
    if len(f) != 4:
        tris = [(0, k, k + 1) for k in range(1, len(f) - 1)]
        seen.update(frozenset(f[k] for k in t) for t in tris)
        return tris
    p = [np.array((abs(part.points[i][0]),) + part.points[i][1:]) for i in f]
    d02 = round(float(np.linalg.norm(p[0] - p[2])), 9)
    d13 = round(float(np.linalg.norm(p[1] - p[3])), 9)
    if d02 == d13:
        d02, d13 = min(tuple(p[0]), tuple(p[2])), min(tuple(p[1]), tuple(p[3]))
    first, second = [(0, 1, 2), (0, 2, 3)], [(0, 1, 3), (1, 2, 3)]
    if d02 >= d13:
        first, second = second, first
    if any(frozenset(f[k] for k in t) in seen for t in first):
        first = second
    seen.update(frozenset(f[k] for k in t) for t in first)
    return first


def shape(part):
    """A short fingerprint of a part's faces, so the published layout goes only onto the faces it was made for."""
    return hashlib.sha1(repr(part.faces).encode()).hexdigest()[:16]


class Layout:
    """The published texture layout of one material: for every face of the animal's left side, the piece of the texture
    it is on and its corners' texture coordinates, by part, pinned in a file. Paint goes onto it, so no piece's outline
    may move: a build whose faces it does not fit stops. Setting the environment variable `env` to "new" lays it out
    afresh and writes the file again, which means painting it again."""

    def __init__(self, path, material, env, what, density=()):
        self.path = path
        self.material = material
        self.env = env
        self.what = what
        self.density = density
        self.fresh = os.environ.get(env) == "new" or not os.path.exists(path)
        self.extra = {}
        self._published = None

    def published(self):
        if self._published is None:
            with open(self.path) as fh:
                self._published = json.load(fh)
        return self._published

    def pinned(self, part):
        """A part's faces in the published layout: {"shape", "faces": {face: (piece, [uv of each corner])}}, its left
        side only. None when the layout is being made afresh or the part is not in it."""
        if self.fresh:
            return None
        p = self.published()["parts"].get(part.name)
        if p is None:
            return None
        uv = np.frombuffer(base64.b64decode(p["uv"]), "<f4").reshape(-1, 2)
        faces, at = {}, 0
        for f, k in zip(p["face"], p["piece"]):
            n = len(part.faces[f])
            faces[f] = (p["pieces"][k], [(float(a), float(b)) for a, b in uv[at:at + n]])
            at += n
        return {"shape": p["shape"], "faces": faces}

    def refuse(self, why):
        raise RuntimeError(f"{why} the published texture layout ({self.path}), and paint is on it. Agree a new layout "
                           f"with the texture maker, then build with {self.env}=new to lay it out afresh.")

    def density_of(self, name):
        for key, d in self.density:
            if name.startswith(key):
                return d
        return 1.0

    def lay_out(self, obj):
        """Lays out the material's texture. Once published it is pinned: assemble has put every face of the left side
        where the file has it, and a face it has no place for stops the build. Laid out afresh, the left side is
        unwrapped with least stretch, each piece scaled to the texture it deserves (`density`), stood upright so the
        animal's up runs up the picture, and packed, and the layout is written. The right side takes the left side's
        texture, mirrored."""
        mesh = obj.data
        names = list(obj["islands"])
        mat = [m.name for m in mesh.materials].index(self.material)
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.context.scene.tool_settings.use_uv_select_sync = True
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_mode(type="FACE")
        bm = bmesh.from_edit_mesh(mesh)
        given = bm.faces.layers.int["given"]
        isl = bm.faces.layers.int["island"]
        if not self.fresh:
            loose = sorted({names[f[isl]] for f in bm.faces
                            if f.material_index == mat and f.calc_center_median().x > 0 and not f[given]})
            if loose:
                self.refuse(f"model: faces of {', '.join(loose)} have no place in")
        else:
            self.unwrap(mesh, names, mat)
        bm = bmesh.from_edit_mesh(mesh)
        uv = bm.loops.layers.uv.active

        def where(v, sign=1):
            return (round(sign * v.co.x, 6), round(v.co.y, 6), round(v.co.z, 6))

        lefts = {}
        for f in bm.faces:
            if f.material_index == mat and f.calc_center_median().x > 0:
                lefts[frozenset(where(v) for v in f.verts)] = f
        for f in bm.faces:
            if f.material_index != mat or f.calc_center_median().x >= 0:
                continue
            g = lefts.get(frozenset(where(v, -1) for v in f.verts))
            if g is None:
                raise RuntimeError(f"model: a face on the right has no mirror on the left, at {tuple(f.calc_center_median())}")
            at = {where(l.vert): tuple(l[uv].uv) for l in g.loops}
            for l in f.loops:
                l[uv].uv = at[where(l.vert, -1)]
        bmesh.update_edit_mesh(mesh)
        bpy.ops.object.mode_set(mode="OBJECT")
        if self.fresh:
            self.write(obj, mat)

    def unwrap(self, mesh, names, mat):
        """The left side's texture laid out afresh (lay_out)."""
        bm = bmesh.from_edit_mesh(mesh)
        isl = bm.faces.layers.int["island"]
        # cut the texture where two pieces meet
        for e in bm.edges:
            if len({f[isl] for f in e.link_faces}) > 1:
                e.seam = True

        def lefts(bm):
            given = bm.faces.layers.int["given"]
            return [f for f in bm.faces if f.material_index == mat and f.calc_center_median().x > 0 and not f[given]]

        chosen = set(lefts(bm))
        for f in bm.faces:
            f.select = f in chosen
        bm.select_flush_mode()
        bmesh.update_edit_mesh(mesh)
        bpy.ops.uv.unwrap(method="MINIMUM_STRETCH", margin=0.002, fill_holes=True, correct_aspect=True)
        bm = bmesh.from_edit_mesh(mesh)
        uv = bm.loops.layers.uv.active
        isl = bm.faces.layers.int["island"]
        left = lefts(bm)
        by_island = {}
        for f in left:
            by_island.setdefault(f[isl], []).append(f)
        ratios = {}
        for k, faces in by_island.items():
            area = sum(f.calc_area() for f in faces)
            uv_area = 0.0
            for f in faces:
                q = [np.array(tuple(l[uv].uv)) for l in f.loops]
                for a, b in zip(q[1:-1], q[2:]):
                    d1, d2 = a - q[0], b - q[0]
                    uv_area += abs(d1[0] * d2[1] - d1[1] * d2[0]) / 2
            ratios[k] = math.sqrt(uv_area / max(area, 1e-12))
        common = float(np.median(list(ratios.values())))
        for k, faces in by_island.items():
            loops = [l for f in faces for l in f.loops]
            weight, total = np.zeros(2), 0.0
            for f in faces:
                q = [np.array(tuple(l[uv].uv)) for l in f.loops]
                a = sum(abs((b - q[0])[0] * (c - q[0])[1] - (b - q[0])[1] * (c - q[0])[0]) / 2 for b, c in zip(q[1:-1], q[2:]))
                weight += np.mean(q, axis=0) * a
                total += a
            mid = weight / max(total, 1e-12)
            up = np.zeros(2)
            for f in faces:
                tri = f.loops[:3]
                p = [np.array(l.vert.co) for l in tri]
                q = [np.array(tuple(l[uv].uv)) for l in tri]
                m = np.array([q[1] - q[0], q[2] - q[0]])
                dz = np.array([p[1][2] - p[0][2], p[2][2] - p[0][2]])
                if abs(np.linalg.det(m)) > 1e-14:
                    up += np.linalg.solve(m, dz) * f.calc_area()
            angle = math.atan2(up[1], up[0]) - math.pi / 2 if np.linalg.norm(up) > 1e-12 else 0.0
            c, s = math.cos(-angle), math.sin(-angle)
            scale = common / max(ratios[k], 1e-12) * self.density_of(names[k])
            for l in loops:
                x, y = np.array(tuple(l[uv].uv)) - mid
                l[uv].uv = (mid[0] + scale * (c * x - s * y), mid[1] + scale * (s * x + c * y))
        chosen = set(left)
        for f in bm.faces:
            f.select = f in chosen
        bm.select_flush_mode()
        bmesh.update_edit_mesh(mesh)
        bpy.ops.uv.pack_islands(rotate=False, scale=True, margin_method="FRACTION", margin=0.006, shape_method="CONCAVE")

    def write(self, obj, mat):
        """Writes the layout: anything kept in `extra`, and the left side's faces by part: its fingerprint, the pieces,
        and for each face its piece and its corners' texture coordinates (32-bit floats in base64, the faces in
        order)."""
        mesh = obj.data
        names = list(obj["islands"])
        uv = mesh.uv_layers.active.data
        isl = mesh.attributes["island"].data
        got = {}
        for poly, (part, f, corners, mark) in zip(mesh.polygons, MADE[obj.name]):
            if poly.material_index != mat or poly.center.x <= 0:
                continue
            faces = got.setdefault(part, (mark, {}))[1]
            at = faces.setdefault(f, (names[isl[poly.index].value], {}))[1]
            for loop, k in zip(poly.loop_indices, corners):
                at[k] = tuple(uv[loop].uv)
        parts = {}
        for part, (mark, faces) in sorted(got.items()):
            order = sorted(faces)
            pieces = sorted({faces[f][0] for f in order})
            flat = [faces[f][1][k] for f in order for k in range(len(faces[f][1]))]
            parts[part] = {"shape": mark, "pieces": pieces, "face": order,
                           "piece": [pieces.index(faces[f][0]) for f in order],
                           "uv": base64.b64encode(np.array(flat, "<f4").tobytes()).decode()}
        with open(self.path, "w") as fh:
            json.dump(dict({"about": f"The pteranodon's published {self.what} texture layout, written by its script "
                                     "(Layout.lay_out) and read on every build. Paint goes onto it, so it is written "
                                     "again only when the texture maker agrees to a new layout."},
                           **self.extra, parts=parts), fh, separators=(",", ":"))
        print("model: wrote the texture layout to", self.path)


BODY_LAYOUT = Layout(LAYOUT_FILE, BODY_MAT, "PTERANODON_LAYOUT", "body", DENSITY)
# Each triangle assemble made, by object, in order: (part, face, its corners, the part's fingerprint).
MADE = {}


def assemble(parts, materials=(BODY_MAT, WING_MAT), name="pteranodon_model", layouts=(BODY_LAYOUT,)):
    """One mesh object from the parts, in triangles: regions and pieces as attributes, the texture coordinates the
    parts give and those of the published layouts, and the normals the slabs give their corners."""
    made = MADE[name] = []
    bm = bmesh.new()
    region = bm.faces.layers.int.new("region")
    island = bm.faces.layers.int.new("island")
    given = bm.faces.layers.int.new("given")
    uv_layer = bm.loops.layers.uv.new("UVMap")
    mats = list(materials)
    by_material = {lay.material: lay for lay in layouts}
    deform = bm.verts.layers.deform.verify()
    groups, names, corner_normals = {}, [], []
    for part in parts:
        if not getattr(part, "oriented", False):
            face_outward(part)
        mark = shape(part)
        lay = by_material.get(part.material)
        pin = lay.pinned(part) if lay is not None else None
        if pin is not None and pin["shape"] != mark:
            lay.refuse(f"model: the faces of {part.name} are not those of")
        seen = set()
        verts = [bm.verts.new(rig.to_blender(p)) for p in part.points]
        for v, w in zip(verts, finish_weights(part.weights)):
            for n, x in w.items():
                g = groups.setdefault(n, len(groups))
                v[deform][g] = x
        for fi, (f, r, uv, isl, ns) in enumerate(zip(part.faces, part.regions, part.uvs, part.islands, part.normals)):
            if pin is not None and fi in pin["faces"]:
                isl, uv = pin["faces"][fi]
            if isl not in names:
                names.append(isl)
            for corners in split(part, f, seen):
                made.append((part.name, fi, corners, mark))
                face = bm.faces.new([verts[f[k]] for k in corners])
                face[region] = r
                face[island] = names.index(isl)
                face.material_index = mats.index(part.material)
                face.smooth = True
                if uv is not None:
                    face[given] = 1
                    for loop, k in zip(face.loops, corners):
                        loop[uv_layer].uv = uv[k]
                corner_normals.append(None if ns is None else [rig.to_blender(ns[k]) for k in corners])
        bm.edges.ensure_lookup_table()
        for a, b in part.seams:
            e = bm.edges.get((verts[a], verts[b]))
            if e is not None:
                e.seam = True
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for m_name in mats:
        m = bpy.data.materials.get(m_name) or bpy.data.materials.new(m_name)
        mesh.materials.append(m)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    for n, g in sorted(groups.items(), key=lambda kv: kv[1]):
        obj.vertex_groups.new(name=n)
    obj["islands"] = names
    # Each slab's faces take the middle surface's normal on their side; everything else is shaded smooth.
    normals = [tuple(c.vector) for c in mesh.corner_normals]
    for poly, given_normals in zip(mesh.polygons, corner_normals):
        if given_normals is not None:
            for loop, n in zip(poly.loop_indices, given_normals):
                normals[loop] = tuple(n.normalized())
    mesh.normals_split_custom_set(normals)
    return obj


def attach(child, parent, at=None, midline=False):
    """Pins each closed piece of `child` to `parent` at one point: the child's point `at` (or, for each piece, its point
    nearest the parent) moves onto the parent's nearest point and takes its weights, so the two are one piece wherever
    the build's coarser levels are made. With `midline` both points lie on the animal's middle, keeping a midline part
    mirrored about it."""
    group = list(range(len(child.points)))

    def find(i):
        while group[i] != i:
            group[i] = group[group[i]]
            i = group[i]
        return i

    for f in child.faces:
        for v in f[1:]:
            group[find(v)] = find(f[0])
    cp = np.array(child.points)
    pp = np.array(parent.points)
    ok = np.abs(pp[:, 0]) < 1e-9 if midline else (pp[:, 0] * np.sign(cp[:, 0].mean()) >= 0)
    candidates = np.nonzero(ok)[0]
    pieces = {}
    for v in range(len(cp)):
        if at is not None and v not in (at if isinstance(at, (list, tuple, set)) else [at]):
            continue
        if midline and abs(cp[v, 0]) > 1e-9:
            continue
        pieces.setdefault(find(v), []).append(v)
    for vs in pieces.values():
        d = np.linalg.norm(cp[vs][:, None, :] - pp[candidates][None, :, :], axis=2)
        i, j = np.unravel_index(np.argmin(d), d.shape)
        v, u = vs[i], candidates[j]
        child.points[v] = parent.points[u]
        child.weights[v] = dict(parent.weights[u])


# =====================================================================================================================
# The animal
# =====================================================================================================================


def shell_layout(part):
    """The shell's regions (for the guide) and its pieces of texture: the body with the tail, the neck, the head with
    the beak, cut between rings."""
    ring = _ring_of(part.grid)
    s, e = part.poles
    ring[s], ring[e] = 0, len(part.grid) - 1
    for f, face in enumerate(part.faces):
        i = min(ring[v] for v in face)
        piece = part.pieces[min(i, len(part.pieces) - 1)]
        if piece == "head" and part.centres[min(i, len(part.centres) - 1)][2] > BEAK_FROM:
            piece = "beak"
        part.islands[f] = piece
        c = np.mean([part.points[v] for v in face], axis=0)
        part.regions[f] = shell_regions(c)


def build():
    r = rig.find()
    r.drop_blockout()
    shell = shell_part()
    shell_weights(shell)
    smooth_weights(shell, rounds=3, amount=0.4)
    shell_layout(shell)
    jaw = jaw_part()
    jaw.weigh(lambda p: {"jaw": 1.0})
    attach(jaw, shell, at=jaw.anchor, midline=True)
    crest = crest_part()
    crest.weigh(lambda p: {"skull": 1.0})
    attach(crest, shell, at=len(crest.points) - 2, midline=True)
    parts = [shell, jaw, crest]
    left = {}
    eye = eye_part(1.0)
    eye.weigh(lambda p: {"skull": 1.0})
    attach(eye, shell, at=eye.anchor)
    left["eye"] = eye
    arm = arm_part()
    attach(arm, shell, at=arm.anchor)
    finger = finger_part()
    attach(finger, arm, at=finger.anchor)
    hand = hand_part()
    attach(hand, arm)
    leg = leg_part()
    attach(leg, shell, at=leg.anchor)
    toes = toes_part()
    attach(toes, leg)
    membrane = membrane_part((shell, leg))
    front = front_part()
    for part in (membrane, front):
        part.oriented = True
    left.update(arm=arm, finger=finger, hand=hand, leg=leg, toes=toes, membrane=membrane, front=front)
    for part in left.values():
        parts += [part, mirrored(part, rig._mirror_name(part.name))]
    each = ", ".join(f"{p.name} {sum(len(f) - 2 for f in p.faces)}" for p in parts if not p.name.endswith("_r"))
    obj = assemble(parts)
    BODY_LAYOUT.lay_out(obj)
    r.bind(obj)
    # saddle.py fits the saddle to the shell, whose points come first
    obj["shell_points"] = len(shell.points)
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    print(f"model: {len(parts)} parts, {len(obj.data.vertices)} points, {tris} triangles ({each}; the right side as the left)")
    return obj


if __name__ == "__main__":
    build()

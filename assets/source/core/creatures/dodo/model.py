"""The dodo itself: the mesh that rig.py's skeleton moves, in the two materials asset.ts gives pictures.

The dodo's second script (asset.ts: source.scripts). It finds the rig, drops the block-out, builds the bird and binds
it. Every position is in the bird's frame, as in rig.py: metres, x to the bird's left, y up, z forward, the ground at
y = 0 and the midpoint between the feet at x = z = 0.

The bird is made of parts, each a closed surface:
- the shell: body, neck and head as one surface. Its shape is a field (negative inside), and its rings are slices of
  that field by planes that turn with the body: upright across the body, fanning up into the neck, level up the neck,
  fanning forward into the head;
- the beak, mouth and tongue, eyes and lids, brows, throat pouch, wings, legs and toes;
- feather cards in `dodo_cards`: thin closed leaves that break the outline (hood edge, mane, tufts, trousers, tail,
  wing fingers), each kind drawn from one rectangle of the cards' picture (ATLAS).

Each small part and card is pinned at one point to a larger one (attach), so the converter's coarser levels keep it
whole. The opaque material's texture is laid out once on the left side and mirrored to the right; paint goes onto
that layout, so it is pinned in layout.json and the shape is refined under it (lay_out). ref/bakes/bake.py and draw.py
bake what the texture maker paints to.
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

UP = np.array([0.0, 1.0, 0.0])
# Colour regions as rig.REGIONS numbers them, and the parts no dye reaches: eye, claws, mouth, tongue.
BODY_R, FACE_R, BEAK_R, BROW_R, HOOD_R, WING_R, BARE_R = 0, 1, 2, 3, 4, 5, 6

# =====================================================================================================================
# Shapes
# =====================================================================================================================

# The body: an egg along an axis tilted chest up, wider low down than high up and wider behind the legs than at the
# breast. `side` is the half width the egg would have at its widest if every section were as full as at u (u: -1 at
# the rump, +1 at the breast), so the half width at u is side(u) * sqrt(1 - u * u).
BODY = {
    "centre": (0.0, 0.250, 0.005), "tilt": 4.0, "half_length": 0.222, "top": 0.150, "bottom": 0.150, "pear": 0.06,
    "side": [(-1.0, 0.118), (-0.85, 0.146), (-0.6, 0.150), (-0.3, 0.145), (0.0, 0.135), (0.25, 0.118), (0.45, 0.095),
             (0.65, 0.078), (1.0, 0.074)],
}
# The neck: a centre line (y, z) from inside the body to inside the head, with its half width (across) and half depth.
NECK = {
    "path": [(0.300, 0.105), (0.360, 0.130), (0.415, 0.137), (0.460, 0.140), (0.505, 0.140), (0.550, 0.139),
             (0.585, 0.139)],
    "half_width": [0.084, 0.071, 0.060, 0.055, 0.053, 0.053, 0.052],
    "half_depth": [0.090, 0.077, 0.071, 0.070, 0.070, 0.068, 0.062],
}
# The head: the skull under the hood, the face in front of it, the snout that carries the beak, and the jowls at the
# corners of the mouth.
SKULL = {"centre": (0.0, 0.596, 0.143), "radii": (0.055, 0.053, 0.074), "pitch": 6.0}
FACE = {"centre": (0.0, 0.576, 0.184), "radii": (0.051, 0.043, 0.038)}
SNOUT = {"centre": (0.0, 0.578, 0.222), "radii": (0.024, 0.027, 0.030)}
JOWL = {"centre": (0.033, 0.543, 0.190), "radii": (0.016, 0.014, 0.018)}
# Where the throat meets the underside of the lower beak's root: its skin makes way as the beak opens.
CHIN = (0.0, 0.527, 0.207)
# The bag of skin under each eye (left).
BAG = {"centre": (0.047, 0.573, 0.181), "radii": (0.010, 0.0065, 0.013)}
# The eye looks out and forward. Its lids are lines through the eye's centre in the side view: the upper lid covers
# from `upper` degrees above the forward axis over the top, and the face covers below `lower`. A turn of the upper lid
# by rig.LIDS_SHUT brings it just past the lower. The upper lid is heavy: its shell runs from `lid` inner to outer
# radius.
EYE = {"centre": rig.EYE["centre"], "radius": 0.0125, "socket": 0.0176, "look": (0.70, 0.0, 0.71),
       "upper": 10.0, "lower": -30.0, "lid": (0.0128, 0.0171)}
# The hood's plush cap stands this far proud of the skull at its fullest.
HOOD_PLUSH = 0.0035
# The rise at the top of the rump that the tail grows from.
RUMP = {"centre": (0.0, 0.343, -0.160), "radii": (0.034, 0.026, 0.036)}

# How the shell is sliced. P1 and P2 are the axes (along x) the fans turn about, as (y, z): above the back where the
# neck leaves it, and in front of the throat under the jaw.
P1 = (0.440, 0.025)
P2 = (0.512, 0.240)
AROUND = 34  # points round a ring; even, so the midline has a point at top and bottom
RINGS = 42

# The upper beak: stations from inside the face to the hook, each the top (culmen) and bottom (cutting edge) of the
# side view as (y, z), with the half width. The palate is hollowed up between the cutting edges by `hollow` of the
# depth, less towards the hook.
BEAK = [
    ((0.598, 0.186), (0.552, 0.186), 0.025),
    ((0.609, 0.205), (0.548, 0.205), 0.0255),
    ((0.6105, 0.224), (0.547, 0.224), 0.025),
    ((0.6105, 0.244), (0.546, 0.244), 0.024),
    ((0.608, 0.264), (0.545, 0.264), 0.023),
    ((0.603, 0.284), (0.545, 0.285), 0.0215),
    ((0.595, 0.303), (0.544, 0.304), 0.0195),
    ((0.582, 0.327), (0.541, 0.313), 0.0172),
    ((0.560, 0.343), (0.534, 0.319), 0.0145),
    ((0.538, 0.349), (0.526, 0.322), 0.0118),
    ((0.519, 0.346), (0.515, 0.326), 0.0088),
    ((0.507, 0.340), (0.506, 0.328), 0.0058),
]
BEAK_TIP = (0.4985, 0.3335)
BEAK_LAP = 0.0015  # how far the upper beak's edges come down over the lower beak's, where the palate is hollowed
# The lower beak: stations (z, top, bottom, half width), a slab from inside the jowl to under the hook, as wide as
# the upper beak's cutting edges, so the closed bill meets on a seam. Its root, buried in the throat, rises to the
# hinge, so it does not swing back far into the throat as the beak opens.
JAW = [(0.178, 0.548, 0.537, 0.0225), (0.200, 0.5475, 0.531, 0.0232), (0.230, 0.5465, 0.5215, 0.0222),
       (0.260, 0.5455, 0.5225, 0.0206), (0.285, 0.5445, 0.5245, 0.0182), (0.302, 0.5435, 0.5275, 0.0152),
       (0.313, 0.5425, 0.5310, 0.0118), (0.320, 0.5412, 0.5345, 0.0076)]
JAW_TIP = (0.538, 0.3245)
# The tongue lies in the floor of the lower beak.
TONGUE = [(0.192, 0.5455, 0.0085), (0.215, 0.5465, 0.0095), (0.245, 0.5465, 0.0085), (0.268, 0.5455, 0.0060)]
# The brow shelf: a heavy ridge (left side) from the beak's root back over the eye, its section half height and depth.
BROW = {"path": [(0.012, 0.6050, 0.2165), (0.026, 0.6070, 0.212), (0.041, 0.6075, 0.199), (0.0505, 0.6050, 0.181),
                 (0.0515, 0.6005, 0.160), (0.0475, 0.5950, 0.138)],
        "half_height": [0.0070, 0.0095, 0.0125, 0.0132, 0.0120, 0.0080],
        "half_depth": [0.0060, 0.0085, 0.0112, 0.0120, 0.0108, 0.0068]}
# The throat pouch: lying on the front of the neck from under the chin, half widths down its length (y).
POUCH = {"y": [0.548, 0.535, 0.520, 0.505, 0.490, 0.475, 0.462, 0.452], "half_width": [0.020, 0.026, 0.027, 0.026,
         0.023, 0.018, 0.011, 0.002], "proud": 0.0035}
# The folded wing (left): its outline on the flank in the side view, (z, top y, bottom y) from shoulder to hand, and
# how far it stands off the flank.
WING = {"outline": [(0.088, 0.332, 0.322), (0.074, 0.349, 0.293), (0.050, 0.356, 0.268), (0.020, 0.352, 0.256),
                    (-0.012, 0.343, 0.250), (-0.040, 0.330, 0.250), (-0.058, 0.316, 0.255), (-0.070, 0.302, 0.263),
                    (-0.077, 0.288, 0.275)],
        "proud": 0.013, "lift": 0.0015, "sink": 0.001,
        # the hollow under it, in the side view: centre and half sizes (y, z), and its depth
        "pocket": {"centre": (0.292, 0.000), "radii": (0.085, 0.120), "depth": 0.003}}
# The plug round the shoulder joint: half length along the upper wing, half thickness across, half height.
SHOULDER = (0.026, 0.011, 0.021)
# Four flight feathers stacked like the fingers of a hand at the back of the wing, each lapping over the one below:
# root (z, y) on the wing, direction (degrees below backward), length and half width.
FINGERS = [((-0.050, 0.296), 4.0, 0.050, 0.0118), ((-0.052, 0.285), 8.0, 0.052, 0.0120),
           ((-0.052, 0.274), 12.0, 0.049, 0.0118), ((-0.050, 0.263), 16.0, 0.044, 0.0112)]
# The leg (left): a centre line (x, y, z) from inside the body down the shin and shank to the pad, half width and
# depth.
LEG = [((0.0635, 0.182, 0.026), 0.0245, 0.0265), ((0.0618, 0.152, 0.014), 0.0225, 0.0245),
       ((0.0595, 0.122, 0.004), 0.0198, 0.0222), ((0.0580, 0.095, 0.0025), 0.0182, 0.0206),
       ((0.0573, 0.065, 0.0030), 0.0178, 0.0200), ((0.0568, 0.040, 0.0045), 0.0186, 0.0206),
       ((0.0563, 0.024, 0.0070), 0.0205, 0.0225), ((0.0560, 0.012, 0.0090), 0.0195, 0.0215)]
# Toes from the ball of the foot: heading (degrees, + to the bird's left for the left foot), length, root half width.
TOES = [(-24.0, 0.088, 0.0100), (4.0, 0.098, 0.0105), (30.0, 0.084, 0.0100), (188.0, 0.060, 0.0094)]
BALL = (0.0565, 0.011, 0.010)
# The tail: seven broad feathers from the top of the rump, fanned open to the side view, from the lowest reaching back
# to the highest standing up. Each leans a little out to one side or the other, so they lie in layers and the fan has
# some breadth from behind, and turns its face that way: (pitch, degrees up from straight back as seen from the side;
# lean, degrees out to the bird's left as seen from behind; length; half width at the tip). Their tips curl over the
# fan's rim, the upper ones forward over the back and the lower ones down, by TAIL_CURL of the way to a quarter turn.
TAIL_ROOT = (0.0, 0.355, -0.138)
TAIL_CURL = 0.55
TAIL = [(4.0, 0.0, 0.118, 0.0240), (18.0, 6.0, 0.128, 0.0250), (32.0, -6.0, 0.134, 0.0255),
        (46.0, 18.0, 0.136, 0.0255), (60.0, -18.0, 0.132, 0.0250), (74.0, 30.0, 0.126, 0.0245),
        (88.0, -30.0, 0.116, 0.0240)]
TAIL_TURN = 30.0  # degrees each leaning feather turns its face from the side towards the back

# The hood's ragged edge (left): small tufts rooted just under the cap along its own edge on the shell, behind the
# face from the face's lower corner up to the back of the brow, hanging forward over the skin: how far back of the
# edge they root, how far over the skin they reach, how far their tips stand off, and where the edge goes under the
# brow (z).
HOOD_EDGE = {"behind": 0.003, "over": 0.010, "lift": 0.0018, "brow": 0.157, "columns": 9}
# The hood comes down the nape as a wedge, as the concept's back view has it: its half width (x) at each height (y),
# to its point. Higher up the hood's whole piece of the shell is hood. The region map draws it (ref/bakes/draw.py):
# the rest of the hood's piece down the nape is neck feathers.
NAPE_WEDGE = [(0.478, 0.0), (0.490, 0.028), (0.500, 0.039), (0.510, 0.043), (0.520, 0.045), (0.530, 0.049),
              (0.540, 0.051)]
# The nape mane: layers down the back of the neck, each (root y, tip y, how far round the neck from the back midline
# in degrees at the root and at the tips, columns). They hang over the hood's wedge down the nape by a centimetre or
# more and end below its point, so their lank tips break its outline; the first is rooted under the crown. Its tips
# stand MANE_LIFT off, its roots sink MANE_SINK under the cap, every other one deeper, so they do not come out of it
# on one line.
MANE = [(0.618, 0.545, 62.0, 62.0, 7), (0.580, 0.505, 62.0, 56.0, 7), (0.540, 0.468, 56.0, 22.0, 7),
        (0.505, 0.452, 32.0, 6.0, 5)]
MANE_LIFT = 0.0085
MANE_SINK = (0.003, 0.006)
# The trousers: long loose feathers hanging over the top of each leg (left), in two rings round the leg. Each ring:
# rays fanned round the leg from `from` and `down` degrees below level find the roots on the body; the tips hang to
# `tip_y` at `tip_radius` from the leg, bellying `belly` out on the way.
TROUSERS = {"leg": (0.060, 0.006), "rings": [
    {"from": 0.205, "down": 38.0, "around": 14, "tip_radius": 0.036, "tip_y": 0.096, "belly": 0.010},
    {"from": 0.170, "down": 62.0, "around": 10, "tip_radius": 0.027, "tip_y": 0.104, "belly": 0.006}]}
# Tufts: clusters of loose feather tips scattered over the body where its outline runs in the side and front views
# (back, rump, breast, belly, flanks), so the outline is soft and ragged as the concept's is; fewer away from it.
# Each is rooted under the skin and lies the way the feathers do, its tip standing off the body.
TUFTS = {"count": 30, "spacing": 0.032, "length": (0.026, 0.036), "width": (0.020, 0.028), "lift": (0.004, 0.011),
         "sink": 0.0015}
# The cards' picture: a rectangle (u0, v0, u1, v1) for each kind of card, shared by every card of that kind.
ATLAS = {
    "tail": (0.00, 0.00, 0.25, 0.58), "finger": (0.25, 0.00, 0.38, 0.30), "forehead": (0.25, 0.30, 0.38, 0.42),
    "mane": (0.38, 0.00, 0.70, 0.42), "hood": (0.00, 0.58, 1.00, 0.68),
    "body": (0.00, 0.68, 1.00, 0.84), "trousers": (0.00, 0.84, 1.00, 1.00),
}
# The published layout of the opaque texture: for every face of the left side, the piece of the texture it is on and
# its corners' texture coordinates. Paint goes onto it, so no piece's outline may move: a build whose faces it does not
# fit stops. DODO_LAYOUT=new lays the texture out afresh and writes the file again, which means painting it again.
LAYOUT_FILE = os.path.join(os.path.dirname(os.path.realpath(__file__)), "layout.json")
FRESH = os.environ.get("DODO_LAYOUT") == "new"
# How much texture each piece of the opaque material gets for its size, against the body's: the face and beak most,
# the hidden sides of things least. By the start of a piece's name.
DENSITY = [("shell_face", 2.6), ("shell_hood", 1.4), ("shell_body", 1.0), ("beak_palate", 0.8), ("beak", 2.2),
           ("jaw_floor", 0.7), ("jaw", 1.9), ("tongue", 1.0), ("eye", 3.2), ("lid_l_out", 2.6), ("lid_l_in", 0.4),
           ("brow", 1.5), ("pouch_out", 1.6), ("pouch_in", 0.3), ("wing_l_out", 1.0), ("wing_l_in", 0.7),
           ("leg", 1.05), ("toe", 1.3), ("shoulder", 0.5)]

# =====================================================================================================================
# The field
# =====================================================================================================================


def dot(q, v):
    return np.einsum("ij,j->i", q, np.asarray(v, float))


def smin(a, b, k):
    """Smooth union of two fields, blending over about k metres."""
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1 - h) + a * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def _pitch_matrix(degrees):
    """Bird-frame rotation about x, + lifting the front, as the matrix that takes a world offset to the turned frame."""
    a = math.radians(degrees)
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]], float)


def ellipsoid(p, centre, radii, pitch=0.0):
    q = p - np.asarray(centre, float)
    if pitch:
        q = np.einsum("ij,jk->ik", q, _pitch_matrix(pitch))
    r = np.asarray(radii, float)
    k0 = np.linalg.norm(q / r, axis=1)
    k1 = np.linalg.norm(q / (r * r), axis=1)
    return k0 * (k0 - 1) / np.maximum(k1, 1e-9)


def _table(points, u):
    return np.interp(u, [a for a, _ in points], [b for _, b in points])


def body_field(p):
    B = BODY
    t = math.radians(B["tilt"])
    axis = (0.0, math.sin(t), math.cos(t))
    up = (0.0, math.cos(t), -math.sin(t))
    q = p - np.asarray(B["centre"])
    L = B["half_length"]
    u = dot(q, axis)
    v = dot(q, up)
    un = np.clip(u / L, -1, 1)
    h = np.where(v > 0, B["top"], B["bottom"])
    s = np.sqrt(np.maximum(1 - un * un, 0.02))
    nu = np.clip(v / (h * s), -1, 1)
    side = _table(B["side"], un) * (1 - B["pear"] * nu)
    k0 = np.sqrt((q[:, 0] / side) ** 2 + (v / h) ** 2 + (u / L) ** 2)
    k1 = np.sqrt((q[:, 0] / side ** 2) ** 2 + (v / h ** 2) ** 2 + (u / L ** 2) ** 2)
    return k0 * (k0 - 1) / np.maximum(k1, 1e-9)


def _dense(points, sub=4):
    return np.array(rig._catmull([tuple(x) for x in points], sub))


def sweep_field(p, path, half_width, half_depth):
    """A tube along `path` (bird points) whose section is an ellipse: half_width across x, half_depth in the plane of
    the path. Past either end it is closed square."""
    rows = _dense([tuple(a) + (w, d) for a, w, d in zip(path, half_width, half_depth)])
    c, w, d = rows[:, :3], rows[:, 3], rows[:, 4]
    a, ab = c[:-1], c[1:] - c[:-1]
    seg = np.einsum("ij,ij->i", ab, ab)
    t = np.clip(np.einsum("nij,ij->ni", p[:, None, :] - a[None], ab) / seg[None], 0, 1)
    near = a[None] + t[..., None] * ab[None]
    k = np.argmin(np.einsum("nij,nij->ni", p[:, None, :] - near, p[:, None, :] - near), axis=1)
    n = np.arange(len(p))
    tk = t[n, k]
    tangent = ab[k] / np.sqrt(seg[k])[:, None]
    q = p - near[n, k]
    ww = w[k] + (w[k + 1] - w[k]) * tk
    dd = d[k] + (d[k + 1] - d[k]) * tk
    depth = np.cross(tangent, np.array([1.0, 0.0, 0.0]))
    qa = q[:, 0]
    qb = np.einsum("ij,ij->i", q, depth)
    qt = np.einsum("ij,ij->i", q, tangent)
    k0 = np.sqrt((qa / ww) ** 2 + (qb / dd) ** 2)
    k1 = np.sqrt((qa / ww ** 2) ** 2 + (qb / dd ** 2) ** 2)
    sec = k0 * (k0 - 1) / np.maximum(k1, 1e-9)
    end = ((k == 0) & (tk <= 0)) | ((k == len(a) - 1) & (tk >= 1))
    return np.where(end, np.maximum(sec, np.abs(qt)), sec)


def _eye_frame():
    """Unit normals of the planes through the eye's x axis at the lower lid and just short of the upper lid's reach
    when shut: a point is above a plane where its offset from the eye has a positive dot with the normal."""
    def normal(deg):
        a = math.radians(deg)
        return np.array([0.0, math.cos(a), -math.sin(a)])
    return normal(EYE["lower"]), normal(EYE["lower"] + 150.0)


def socket_field(p, sx):
    """The hollow the eye and its upper lid sit in, above the lower lid's line: close round the eyeball where the eye
    is open, wide enough for the heavy lid where the lid rests."""
    e = np.array([EYE["centre"][0] * sx, EYE["centre"][1], EYE["centre"][2]])
    q = p - e
    na, nb = _eye_frame()
    phi = np.degrees(np.arctan2(q[:, 1], q[:, 2]))
    open_ = np.clip((phi - (EYE["upper"] - 10.0)) / 14.0, 0, 1)
    radius = EYE["radius"] + 0.0012 + (EYE["socket"] - EYE["radius"] - 0.0012) * open_ * open_ * (3 - 2 * open_)
    ball = np.linalg.norm(q, axis=1) - radius
    return np.maximum(ball, np.maximum(-dot(q, na), dot(q, nb)))


def lower_lid_field(p, sx):
    """The lower lid: skin wrapped round the bottom of the eyeball, up to the lower lid's line."""
    e = np.array([EYE["centre"][0] * sx, EYE["centre"][1], EYE["centre"][2]])
    q = p - e
    na, _ = _eye_frame()
    return np.maximum(np.linalg.norm(q, axis=1) - (EYE["radius"] + 0.0017), dot(q, na))


def plush(p):
    """How far the hood's plush cap stands off the skull: over the crown and the back of the head, fading at the brow,
    behind the face and down the nape."""
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    crown = np.clip((y - 0.590) / 0.025, 0, 1)
    behind = np.clip((0.150 - z) / 0.03, 0, 1) * np.clip((y - 0.50) / 0.05, 0, 1)
    return HOOD_PLUSH * np.maximum(crown, behind) * np.clip((z + 0.02) / 0.06, 0, 1)


def pocket(p):
    """How deep the flank is let in under each folded wing, so the flank can move under it through the walk without
    coming through it: deepest in the middle of the wing, nothing past its edge."""
    P = WING["pocket"]
    r = np.sqrt(((p[:, 1] - P["centre"][0]) / P["radii"][0]) ** 2 + ((p[:, 2] - P["centre"][1]) / P["radii"][1]) ** 2)
    return P["depth"] * np.clip(1 - r * r, 0, 1) ** 2 * np.clip((np.abs(p[:, 0]) - 0.05) / 0.03, 0, 1)


def flank_field(p):
    """The shell as it would be with no pockets: what the wings are laid on."""
    return shell_field(p, pockets=False)


def shell_field(p, pockets=True):
    """The body, neck and head as one field: below zero inside."""
    p = np.atleast_2d(np.asarray(p, float))
    f = body_field(p)
    f = smin(f, sweep_field(p, [(0.0,) + tuple(x) for x in NECK["path"]], NECK["half_width"], NECK["half_depth"]), 0.035)
    f = smin(f, ellipsoid(p, RUMP["centre"], RUMP["radii"]), 0.03)
    head = ellipsoid(p, SKULL["centre"], SKULL["radii"], SKULL["pitch"])
    head = smin(head, ellipsoid(p, FACE["centre"], FACE["radii"]), 0.02)
    head = smin(head, ellipsoid(p, SNOUT["centre"], SNOUT["radii"]), 0.015)
    for sx in (1.0, -1.0):
        c = JOWL["centre"]
        head = smin(head, ellipsoid(p, (c[0] * sx, c[1], c[2]), JOWL["radii"]), 0.012)
        c = BAG["centre"]
        head = smin(head, ellipsoid(p, (c[0] * sx, c[1], c[2]), BAG["radii"]), 0.006)
    f = smin(f, head, 0.025)
    f = f - plush(p)
    for sx in (1.0, -1.0):
        f = smin(f, lower_lid_field(p, sx), 0.003)
        f = smax(f, -socket_field(p, sx), 0.004)
    if pockets:
        f = f + pocket(p)
    return f


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


def cast(field, origins, dirs, far=0.4, step=0.003):
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
    for _ in range(20):
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


def slicing_planes():
    """Candidate ring planes from the rump to the snout, finely spaced: (centre, up, normal). `up` is the direction
    of the ring's first point, the top or back midline."""
    out = []
    y1, z1 = P1
    y2, z2 = P2
    neck_y = [p[0] for p in NECK["path"]]
    neck_z = [p[1] for p in NECK["path"]]
    tip = cast(shell_field, np.array([[0.0, 0.25, -0.1]]), np.array([[0.0, 0.0, -1.0]]))[0]
    for z in np.linspace(tip[2] + 0.004, z1, 70, endpoint=False):
        out.append((np.array([0.0, 0.26, z]), np.array([0.0, 1.0, 0.0]), np.array([0.0, 0.0, 1.0])))
    for a in np.linspace(0, math.pi / 2, 90, endpoint=False):
        n = np.array([0.0, math.sin(a), math.cos(a)])
        e = np.array([0.0, -math.cos(a), math.sin(a)])
        rho = 0.185 + (0.105 - 0.185) * (a / (math.pi / 2)) ** 1.3
        out.append((np.array([0.0, y1, z1]) + e * rho, -e, n))
    for y in np.linspace(y1, y2, 30, endpoint=False):
        out.append((np.array([0.0, y, float(np.interp(y, neck_y, neck_z))]), np.array([0.0, 0.0, -1.0]), np.array([0.0, 1.0, 0.0])))
    rho0 = z2 - float(np.interp(y2, neck_y, neck_z))
    for b in np.linspace(0, math.pi / 2, 110, endpoint=False):
        n = np.array([0.0, math.cos(b), math.sin(b)])
        e = np.array([0.0, math.sin(b), -math.cos(b)])
        out.append((np.array([0.0, y2, z2]) + e * (rho0 + (0.066 - rho0) * b / (math.pi / 2)), e, n))
    for z in np.linspace(z2, 0.252, 7):
        out.append((np.array([0.0, y2 + 0.066, z]), np.array([0.0, 1.0, 0.0]), np.array([0.0, 0.0, 1.0])))
    return out


def ring_points(field, planes, fine=120):
    """The section of the field in each plane (through its centre, spanned by its `up` and x): `fine` points from the
    top midline round the bird's left to the bottom midline. Each centre is first moved to the middle of its section
    along `up`, so the rays leave from well inside."""
    th = np.linspace(0, math.pi, fine)
    ups = np.array([u for _, u, _ in planes])
    centres = np.array([c for c, _, _ in planes])
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
    """How closely rings are wanted at a ring centre: closest on the head, close on the neck and at the rump."""
    y, z = c[1], c[2]
    if y > 0.53:
        return 2.1
    if y > 0.40:
        return 1.5
    if z < -0.17:
        return 1.4
    return 1.0


def shell_grid(field):
    """The shell's rings, picked from the candidate planes so they lie about evenly apart over the surface, closer
    where ring_weight asks. Rows of AROUND // 2 + 1 points (top midline round the left to bottom midline), the two
    poles, and each row's centre. Once the layout is published the rings stay in the planes it has, so a change of
    shape moves only the points near it, and the paint stays where it was put."""
    half = AROUND // 2
    planes = slicing_planes()
    sections, centres = ring_points(field, planes)
    rings = [resample(r, half) for r in sections]
    pick = None if FRESH else published().get("shell_rings")
    if pick is None:
        gap = np.array([np.mean(np.linalg.norm(b - a, axis=1)) for a, b in zip(rings, rings[1:])])
        weight = np.array([ring_weight(c) for c in centres])
        s = np.concatenate([[0], np.cumsum(gap * 0.5 * (weight[1:] + weight[:-1]))])
        pick = sorted(set(int(np.argmin(np.abs(s - t))) for t in np.linspace(0, s[-1], RINGS)))
    SHELL_RINGS[:] = pick
    rows = np.array([rings[i] for i in pick])
    back = cast(field, centres[pick[0]][None], -planes[pick[0]][2][None])[0]
    front = cast(field, centres[pick[-1]][None], planes[pick[-1]][2][None])[0]
    return rows, back, front, centres[pick]


def relax(field, rows, back, front, rounds=12, amount=0.4):
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
    """A closed piece of the bird: bird-frame points, faces of point indices with a colour region each, a material,
    the bones that move each point, edges to be drawn sharp and edges where its texture is cut. A face may carry its own
    texture coordinates (cards do); the others are unwrapped. `island` names the piece of the texture a face is on."""

    def __init__(self, name, material="dodo", region=BODY_R):
        self.name = name
        self.material = material
        self.region = region
        self.points = []
        self.faces = []
        self.regions = []
        self.uvs = []
        self.islands = []
        self.weights = []
        self.sharp = set()
        self.seams = set()
        self.soft = False  # a card on the body, shaded with the body's normals

    def point(self, p, weights=None):
        self.points.append(tuple(float(x) for x in p))
        self.weights.append(weights)
        return len(self.points) - 1

    def face(self, idx, region=None, uv=None, island=None):
        self.faces.append(tuple(int(i) for i in idx))
        self.regions.append(self.region if region is None else region)
        self.uvs.append(None if uv is None else [tuple(float(a) for a in c) for c in uv])
        self.islands.append(island or self.name)

    def weigh(self, fn):
        """Sets every point's bone weights from fn(point) -> {bone: weight}."""
        self.weights = [fn(np.array(p)) for p in self.points]

    def cut(self, a, b):
        if a != b:
            self.seams.add((min(a, b), max(a, b)))


def tube(part, rings, start=None, end=None, seam=None):
    """Joins rings of points (lists of equal length, each a closed loop) into a closed tube. Each end is closed on a
    point: `start` / `end` if given, else the ring's middle. With `seam`, the texture is cut along that column from end
    to end, so the tube unwraps flat."""
    idx = [[part.point(p) for p in ring] for ring in rings]
    k = len(rings[0])
    for a, b in zip(idx, idx[1:]):
        for j in range(k):
            jj = (j + 1) % k
            part.face((a[j], a[jj], b[jj], b[j]))
    s = part.point(np.mean(rings[0], axis=0) if start is None else start)
    e = part.point(np.mean(rings[-1], axis=0) if end is None else end)
    for j in range(k):
        jj = (j + 1) % k
        part.face((s, idx[0][jj], idx[0][j]))
        part.face((e, idx[-1][j], idx[-1][jj]))
    part.anchor = s
    if seam is not None:
        for a, b in zip(idx, idx[1:]):
            part.cut(a[seam], b[seam])
        part.cut(s, idx[0][seam])
        part.cut(e, idx[-1][seam])
    return idx, s, e


def section(centre, up, side, profile):
    """Points of a section: `profile` (a along side, b along up) about `centre`."""
    c, u, s = (np.asarray(x, float) for x in (centre, up, side))
    return [c + s * a + u * b for a, b in profile]


def mirrored_profile(half):
    """A closed profile from its left half, which runs from the top midline (a = 0) to the bottom midline (a = 0)."""
    return list(half) + [(-a, b) for a, b in reversed(half[1:-1])]


def _face(part, idx, region=None, uv=None, island=None):
    """Adds a face, dropping repeated corners; nothing if fewer than three are left."""
    out, uvs = [], []
    for k, i in enumerate(idx):
        if not out or out[-1] != i:
            out.append(i)
            uvs.append(None if uv is None else uv[k])
    if len(out) > 1 and out[0] == out[-1]:
        out.pop()
        uvs.pop()
    if len(set(out)) >= 3:
        part.face(out, region, None if uv is None else uvs, island)


def pillow(part, outer, inner, region=None, uv=None, wrap=False):
    """A closed thin solid from two grids of points with the same rim: `outer` and `inner` are (rows, cols, 3). The rim
    is outer's; inner's rim is not used. A row whose points all lie at one place is one point. With `wrap` the columns
    go round, and the rim is the first and last rows. The rim's edges are drawn sharp and cut in the texture, so each
    side is shaded and painted as itself; `uv` (rows, cols (+1 if wrapped), 2) gives both sides the same picture."""
    rows, cols = outer.shape[:2]
    io = []
    for i in range(rows):
        if np.ptp(outer[i], axis=0).max() < 1e-7:
            v = part.point(outer[i, 0])
            io.append([v] * cols)
        else:
            io.append([part.point(outer[i, j]) for j in range(cols)])

    def rim(i, j):
        return i in (0, rows - 1) or (not wrap and j in (0, cols - 1))

    ii = [[io[i][j] if rim(i, j) else part.point(inner[i, j]) for j in range(cols)] for i in range(rows)]
    for grid, flip, side in ((io, False, "_out"), (ii, True, "_in")):
        for i in range(rows - 1):
            for j in range(cols - 1 + (1 if wrap else 0)):
                jj = (j + 1) % cols
                quad = (grid[i][j], grid[i + 1][j], grid[i + 1][jj], grid[i][jj])
                q_uv = None if uv is None else [uv[i, j], uv[i + 1, j], uv[i + 1, j + 1], uv[i, j + 1]]
                if flip:
                    quad = quad[::-1]
                    q_uv = None if q_uv is None else q_uv[::-1]
                _face(part, quad, region, q_uv, part.name + side)
    edge = [io[0][j] for j in range(cols)] + ([io[0][0]] if wrap else [])
    if wrap:
        edge2 = [io[rows - 1][j] for j in range(cols)] + [io[rows - 1][0]]
        loops = [edge, edge2]
    else:
        loops = [[io[0][j] for j in range(cols)] + [io[i][cols - 1] for i in range(1, rows)] +
                 [io[rows - 1][j] for j in range(cols - 2, -1, -1)] + [io[i][0] for i in range(rows - 1, -1, -1)]]
    for loop in loops:
        for a, b in zip(loop, loop[1:]):
            if a != b:
                part.sharp.add((min(a, b), max(a, b)))
                part.cut(a, b)
    return io, ii


def shell_part():
    rows, back, front, centres = shell_grid(shell_field)
    rows = relax(shell_field, rows, back, front)
    part = Part("shell")
    full = np.concatenate([rows, rows[:, -2:0:-1] * np.array([-1, 1, 1])], axis=1)
    idx, _, _ = tube(part, list(full), back, front)
    part.grid = np.array(idx)
    part.centres = centres
    return part


# ---- beak, mouth -------------------------------------------------------------------------------------------------


def beak_profile(w, h, hollow, lap=0.0):
    """Left half of an upper beak section, top midline to the palate's midline: a narrow ridge, full sides, a cutting
    edge at the bottom, `lap` lower, and the palate hollowed up between the edges."""
    return [(0.0, h), (0.30 * w, 0.93 * h), (0.60 * w, 0.76 * h), (0.83 * w, 0.48 * h), (0.96 * w, 0.12 * h),
            (1.00 * w, -0.28 * h), (0.97 * w, -0.66 * h - 0.5 * lap), (0.91 * w, -0.93 * h - lap),
            (0.80 * w, -1.0 * h - lap), (0.55 * w, -h + 0.6 * hollow), (0.0, -h + hollow)]


def upper_beak():
    part = Part("beak", region=BEAK_R)
    rings = []
    n = len(BEAK)
    for i, ((ty, tz), (by, bz), w) in enumerate(BEAK):
        top = np.array([0.0, ty, tz])
        bot = np.array([0.0, by, bz])
        up = (top - bot) / np.linalg.norm(top - bot)
        h = np.linalg.norm(top - bot) / 2
        hollow = 2 * h * 0.30 * max(0.0, 1 - i / (n - 3))
        lap = BEAK_LAP * min(1.0, hollow / (2 * h * 0.30))
        rings.append(section((top + bot) / 2, up, (1, 0, 0), mirrored_profile(beak_profile(w, h, hollow, lap))))
    tube(part, rings, end=np.array([0.0, BEAK_TIP[0], BEAK_TIP[1]]))
    # the palate, between the cutting edges (profile points 8 to 12), is the inside of the mouth
    k = len(rings[0])
    for r in range(n - 4):
        for j in (8, 9, 10, 11):
            part.regions[r * k + j] = BARE_R
            part.islands[r * k + j] = "beak_palate"
    cut_islands(part)
    part.weigh(lambda p: {"skull": 1.0})
    return part


def lower_beak():
    part = Part("jaw", region=BEAK_R)
    rings = []
    for z, top, bottom, w in JAW:
        h = (top - bottom) / 2
        c = (0.0, (top + bottom) / 2, z)
        half = [(0.0, h - 0.0045), (0.50 * w, h - 0.0025), (0.88 * w, h), (0.99 * w, 0.60 * h), (1.0 * w, -0.05 * h),
                (0.90 * w, -0.62 * h), (0.58 * w, -0.94 * h), (0.0, -h)]
        rings.append(section(c, (0, 1, 0), (1, 0, 0), mirrored_profile(half)))
    tube(part, rings, end=np.array([0.0, JAW_TIP[0], JAW_TIP[1]]))
    # the floor, between the cutting edges (profile points 12, 13, 0, 1, 2), is the inside of the mouth
    k = len(rings[0])
    for r in range(len(rings) - 1):
        for j in (0, 1, 12, 13):
            part.regions[r * k + j] = BARE_R
            part.islands[r * k + j] = "jaw_floor"
    cut_islands(part)
    # the root's end, behind the hinge inside the head, stays with the skull
    part.weigh(lambda p: {"jaw": float(np.clip((p[2] - 0.185) / 0.03, 0.0, 1.0)),
                          "skull": float(np.clip((0.215 - p[2]) / 0.03, 0.0, 1.0))})
    return part


def tongue():
    part = Part("tongue", region=BARE_R)
    rings = []
    for z, y, w in TONGUE:
        half = [(0.0, 0.0028), (0.7 * w, 0.0020), (w, 0.0), (0.7 * w, -0.0025), (0.0, -0.0030)]
        rings.append(section((0.0, y, z), (0, 1, 0), (1, 0, 0), mirrored_profile(half)))
    tube(part, rings, end=np.array([0.0, TONGUE[-1][1], TONGUE[-1][0] + 0.010]))
    part.weigh(lambda p: {"jaw": 1.0})
    return part


# ---- eyes, brows, throat ----------------------------------------------------------------------------------------


def _basis(look):
    v = np.asarray(look, float)
    v /= np.linalg.norm(v)
    a = np.cross(v, (0.0, 1.0, 0.0))
    a /= np.linalg.norm(a)
    return v, a, np.cross(a, v)


def eyeball(sx):
    """A ball round its look direction. Its texture is a disc: the iris at the middle, the back of the ball round the
    rim."""
    part = Part("eye_" + ("l" if sx > 0 else "r"), region=BARE_R)
    e = np.array(EYE["centre"]) * (sx, 1, 1)
    v, a, b = _basis(np.array(EYE["look"]) * (sx, 1, 1))
    r = EYE["radius"]
    lats = np.linspace(20, 160, 6)
    lons = np.linspace(0, 2 * math.pi, 10, endpoint=False)
    rings = [[e + r * (math.cos(math.radians(t)) * v + math.sin(math.radians(t)) * (math.cos(p) * a + math.sin(p) * b))
              for p in lons] for t in lats]
    tube(part, rings, e + r * v, e - r * v)

    def disc(lat, lon):
        return (0.5 + 0.5 * lat / 180 * math.cos(lon), 0.5 + 0.5 * lat / 180 * math.sin(lon))

    k = len(lons)
    step = 2 * math.pi / k
    f = 0
    for i in range(len(lats) - 1):
        for j in range(k):
            part.uvs[f] = [disc(lats[i], j * step), disc(lats[i], (j + 1) * step), disc(lats[i + 1], (j + 1) * step),
                           disc(lats[i + 1], j * step)]
            f += 1
    for j in range(k):
        part.uvs[f] = [disc(0, 0), disc(lats[0], (j + 1) * step), disc(lats[0], j * step)]
        part.uvs[f + 1] = [disc(180, (j + 0.5) * step), disc(lats[-1], j * step), disc(lats[-1], (j + 1) * step)]
        f += 2
    part.weigh(lambda p: {"skull": 1.0})
    return part


def upper_lid(sx):
    """A shell over the top of the eyeball, between its line `upper` degrees above the forward axis and half a turn
    round over the top, from the eye's outer pole to past its middle. It turns on lid_l or lid_r."""
    side = "l" if sx > 0 else "r"
    part = Part("lid_" + side, region=FACE_R)
    e = np.array(EYE["centre"]) * (sx, 1, 1)
    r_in, r_out = EYE["lid"]
    phis = np.radians(EYE["upper"] + np.linspace(0, 180, 7))
    psis = np.radians(np.linspace(0, 115, 6))

    def at(r, phi, psi):
        return e + r * np.array([math.cos(psi) * sx, math.sin(psi) * math.sin(phi), math.sin(psi) * math.cos(phi)])

    outer = np.array([[at(r_out, ph, ps) for ph in phis] for ps in psis])
    inner = np.array([[at(r_in, ph, ps) for ph in phis] for ps in psis])
    pillow(part, outer, inner)
    part.weigh(lambda p: {"lid_" + side: 1.0})
    return part


def brow(sx):
    part = Part("brow_" + ("l" if sx > 0 else "r"), region=BROW_R)
    path = [np.array(p) * (sx, 1, 1) for p in BROW["path"]]
    rings = []
    for i, c in enumerate(path):
        t = path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]
        t /= np.linalg.norm(t)
        out = np.cross((0.0, 1.0, 0.0), t) * sx
        out /= np.linalg.norm(out)
        up = np.cross(t, out) * sx
        h, d = BROW["half_height"][i], BROW["half_depth"][i]
        # a shelf: a rounded top, a flat underside that juts out over the eye
        half = [(0.0, 1.0), (0.55, 0.90), (0.90, 0.55), (1.08, 0.05), (1.0, -0.45), (0.65, -0.80), (0.1, -0.92),
                (-0.5, -0.75), (-0.85, -0.3), (-0.8, 0.45)]
        rings.append([c + out * a * d + up * b * h for a, b in half])
    # round the ends off: a smaller ring a little past each end, then the end's point
    ends = []
    for ring, nb_ring in ((rings[0], rings[1]), (rings[-1], rings[-2])):
        c0, c1 = np.mean(ring, axis=0), np.mean(nb_ring, axis=0)
        step = (c0 - c1) / np.linalg.norm(c0 - c1)
        ends.append([c0 + step * 0.004 + (v - c0) * 0.62 for v in ring])
        ends.append(c0 + step * 0.0065)
    tube(part, [ends[0]] + rings + [ends[2]], start=ends[1], end=ends[3], seam=8)
    part.weigh(lambda p: {"skull": 1.0})
    return part


def swell(p):
    """How much of a point of the pouch puffs with the throat: most down its middle and well clear of its edge."""
    y, x = p[1], abs(p[0])
    ys, ws = POUCH["y"], POUCH["half_width"]
    w = float(np.interp(y, ys[::-1], ws[::-1]))
    along = np.clip((ys[0] - y) / 0.02, 0, 1) * np.clip((y - ys[-1]) / 0.03, 0, 1)
    return float(along * max(0.0, 1 - (x / max(w, 1e-4)) ** 2))


def pouch():
    """The throat pouch: a pillow lying on the front of the neck, its rim sunk a little into the neck."""
    part = Part("pouch", region=BROW_R)
    ys = np.array(POUCH["y"])
    cols = 7
    outer = np.zeros((len(ys), cols, 3))
    inner = np.zeros((len(ys), cols, 3))
    flip = np.array([-1.0, 1.0, 1.0])
    for i, (y, w) in enumerate(zip(ys, POUCH["half_width"])):
        # the left half, then the right as its exact mirror
        xs = np.linspace(0, w, cols // 2 + 1)
        hits = cast(shell_field, np.array([[x, y, 0.13] for x in xs]), np.array([[0.0, 0.0, 1.0]] * len(xs)))
        hits[0, 0] = 0.0
        n = outward(shell_field, hits)
        n[0, 0] = 0.0
        bulge = np.sqrt(np.maximum(0, 1 - (xs / max(w, 1e-4)) ** 2)) * min(1.0, (ys[0] - y) / 0.01 + 0.3, (y - ys[-1]) / 0.02)
        o = hits + n * (POUCH["proud"] * bulge - 0.0015)[:, None]
        q = hits - n * 0.003
        outer[i] = np.concatenate([o[:0:-1] * flip, o])
        inner[i] = np.concatenate([q[:0:-1] * flip, q])
    pillow(part, outer, inner)
    return part


# ---- wings ------------------------------------------------------------------------------------------------------


def wing(sx):
    """The folded wing: a pillow lying on the flank, its rim sunk into it and its middle standing proud, so its edge
    laps over the flank feathers."""
    side = "l" if sx > 0 else "r"
    part = Part("wing_" + side)
    cols = 6
    rows = len(WING["outline"])
    outer = np.zeros((rows, cols, 3))
    inner = np.zeros((rows, cols, 3))
    for i, (z, top, bottom) in enumerate(WING["outline"]):
        ys = np.linspace(top, bottom, cols)
        origins = np.array([[0.0, y, z] for y in ys])
        hits = cast(flank_field, origins, np.array([[sx, 0.0, 0.0]] * cols))
        n = outward(flank_field, hits)
        along = i / (rows - 1)
        across = np.linspace(0, 1, cols)
        # thickest high on the wing and towards the shoulder; the top edge stands up, the bottom lies flatter
        lift = (1 - np.abs(2 * across - 1) ** 3) * (0.55 + 0.45 * math.sin(math.pi * min(1.0, along * 1.4)))
        lift *= np.where(across < 0.5, 1.0, 0.8)
        outer[i] = hits + n * (WING["proud"] * lift + WING["lift"] * (1 - lift))[:, None]
        inner[i] = hits - n * WING["sink"]
    pillow(part, outer, inner)
    bones = [b + side for b in ("wing_upper_", "wing_lower_", "wing_hand_")]
    part.weigh(lambda p: near_bones(p, bones, extra={"chest": 0.15} if p[2] > 0.06 else None))
    return part


def shoulder(sx):
    """A plug of feathered flesh round the shoulder joint, buried at rest, that turns with the upper wing and fills the
    root as the wing is flung out."""
    side = "l" if sx > 0 else "r"
    part = Part("shoulder_" + side)
    head, tail = (np.array(p) * (sx, 1, 1) for p in BONES["wing_upper_" + side])
    along = (tail - head) / np.linalg.norm(tail - head)
    across = np.array([sx, 0.0, 0.0])
    up = np.cross(along, across) * sx
    rings = []
    a, b, c = SHOULDER
    for t in np.linspace(-0.85, 0.85, 5):
        s = math.sqrt(1 - t * t)
        rings.append([head + along * a * t + across * b * s * math.cos(q) + up * c * s * math.sin(q)
                      for q in np.linspace(0, 2 * math.pi, 8, endpoint=False)])
    tube(part, rings, head - along * a, head + along * a, seam=4)
    part.weigh(lambda p: {"wing_upper_" + side: 1.0})
    return part


def fingers(sx):
    """The four cream flight feathers stacked at the back of the wing, each a thin leaf lying just off the flank, the
    higher over the lower."""
    side = "l" if sx > 0 else "r"
    part = Part("fingers_" + side, material="dodo_cards", region=WING_R)
    for layer, ((z, y), angle, length, w) in enumerate(FINGERS):
        a = math.radians(angle)
        d = np.array([0.0, -math.sin(a), -math.cos(a)])
        root = np.array([0.0, y, z])
        rows, cols = 4, 3
        outer = np.zeros((rows, cols, 3))
        inner = np.zeros((rows, cols, 3))
        for i in range(rows):
            t = i / (rows - 1)
            c = root + d * length * t
            hit = cast(flank_field, np.array([[0.0, c[1], c[2]]]), np.array([[sx, 0.0, 0.0]]))[0]
            n = outward(flank_field, hit[None])[0]
            across = np.cross(n, d)
            across /= np.linalg.norm(across)
            half = w * (0.75 + 0.25 * math.sin(math.pi * min(1.0, 0.15 + t * 0.8))) * (0.7 if i == rows - 1 else 1.0)
            base = hit + n * (0.009 + 0.005 * t + 0.0014 * (len(FINGERS) - 1 - layer))
            for j, s in enumerate(np.linspace(-1, 1, cols)):
                outer[i, j] = base + across * half * s
                inner[i, j] = base + across * half * s - n * 0.0012
        pillow(part, outer, inner, uv=atlas_uv("finger", rows, cols, root_top=False))
    part.weigh(lambda p: {"wing_hand_" + side: 1.0})
    return part


# ---- legs and feet ------------------------------------------------------------------------------------------------


def leg(sx):
    side = "l" if sx > 0 else "r"
    part = Part("leg_" + side, region=BROW_R)
    rings = []
    k = 12
    for i, (c, w, d) in enumerate(LEG):
        c = np.array(c) * (sx, 1, 1)
        prev = np.array(LEG[max(i - 1, 0)][0]) * (sx, 1, 1)
        nxt = np.array(LEG[min(i + 1, len(LEG) - 1)][0]) * (sx, 1, 1)
        t = (prev - nxt) / np.linalg.norm(prev - nxt)
        a = np.cross(t, (0.0, 0.0, 1.0))
        a /= np.linalg.norm(a)
        b = np.cross(a, t)
        prof = []
        for j in range(k):
            th = 2 * math.pi * j / k
            # plates down the front make the shank a little squarer in front
            sq = 1.0 + 0.06 * max(0.0, math.cos(th)) ** 2
            prof.append(c + a * w * math.sin(th) + b * d * math.cos(th) * sq)
        rings.append(prof)
    tube(part, rings, end=np.array(BALL) * (sx, 1, 1) + np.array([0.0, -0.007, 0.0]), seam=k // 2)
    part.weigh(lambda p: near_bones(p, ["thigh_" + side, "shin_" + side, "shank_" + side, "toes_" + side]))
    return part


def toes(sx):
    """Three toes forward and one back, full and rounded, with knuckles, each ending in a dark claw curling to the
    ground."""
    side = "l" if sx > 0 else "r"
    part = Part("toes_" + side, region=BROW_R)
    ball = np.array(BALL) * (sx, 1, 1)
    for heading, length, r0 in TOES:
        h = math.radians(heading) * sx
        d = np.array([math.sin(h), 0.0, math.cos(h)])
        a = np.cross(d, (0.0, 1.0, 0.0))
        a /= np.linalg.norm(a)
        stations = [(0.00, 1.06, 0.0), (0.30, 1.00, 0.0012), (0.58, 0.92, 0.0010), (0.82, 0.76, 0.0)]
        rings = []
        for t, s, bump in stations:
            r = r0 * s + bump
            c = ball + d * length * t
            c[1] = r * 0.62 + 0.0012 + 0.004 * max(0.0, 0.3 - t)
            prof = []
            for j in range(6):
                th = 2 * math.pi * j / 6
                # flatter underneath, where the pads are
                prof.append(c + a * r * math.sin(th) + UP * r * math.cos(th) * (0.85 if math.cos(th) > 0 else 0.6))
            rings.append(prof)
        # the claw: narrows from the last station, arching down to its point on the ground
        claw = []
        for t, s, lift in ((0.95, 0.44, 0.0058), (1.08, 0.22, 0.0046)):
            c = ball + d * length * t
            c[1] = lift
            claw.append([c + a * r0 * s * math.sin(2 * math.pi * j / 6) + UP * r0 * s * 0.9 * math.cos(2 * math.pi * j / 6)
                         for j in range(6)])
        tip = ball + d * length * 1.20
        tip[1] = 0.0008
        first = len(part.faces)
        tube(part, rings + claw, start=ball + np.array([0.0, 0.004, 0.0]) - d * 0.004, end=tip, seam=3)
        for f in range(first, len(part.faces)):
            part.islands[f] = f"toe{len(TOES)}_{heading:+.0f}"
        # the claw: the quads past its root ring and the triangles at its point
        quads = (len(rings) + len(claw) - 1) * 6
        for f in range(first + len(rings) * 6, first + quads):
            part.regions[f] = BARE_R
        for j in range(6):
            part.regions[first + quads + 2 * j + 1] = BARE_R
    part.weigh(lambda p: {"toes_" + side: 1.0})
    return part


# ---- tail ---------------------------------------------------------------------------------------------------------


def _slerp(a, b, t):
    a = a / np.linalg.norm(a)
    b = b / np.linalg.norm(b)
    om = math.acos(max(-1.0, min(1.0, float(np.dot(a, b)))))
    if om < 1e-6:
        return a
    return (math.sin((1 - t) * om) * a + math.sin(t * om) * b) / math.sin(om)


def tail():
    """Seven broad feathers fanned from the rump, back to up, their tips curling over the fan's rim."""
    part = Part("tail", material="dodo_cards", region=BODY_R)
    root = np.array(TAIL_ROOT)
    middle = (TAIL[0][0] + TAIL[-1][0]) / 2
    for pitch, lean, length, w in TAIL:
        p, s = math.radians(pitch), math.radians(lean)
        d0 = np.array([math.sin(s), math.cos(s) * math.sin(p), -math.cos(s) * math.cos(p)])
        q = p + math.radians(90.0 if pitch >= middle else -90.0)
        turn_to = np.array([math.sin(s), math.cos(s) * math.sin(q), -math.cos(s) * math.cos(q)])
        curl = TAIL_CURL * (0.3 + 0.7 * min(1.0, abs(pitch - middle) / (middle - TAIL[0][0])))
        # the vane lies along the fan, turned a little to face the way the feather leans
        up = np.array([0.0, math.cos(p), math.sin(p)])
        out = np.array([math.cos(s), -math.sin(s) * math.sin(p), math.sin(s) * math.cos(p)])
        b = math.radians(TAIL_TURN) * float(np.sign(lean))
        across0 = up * math.cos(b) + out * math.sin(b)
        across0 -= d0 * np.dot(across0, d0)
        across0 /= np.linalg.norm(across0)
        rows, cols = 6, 3
        heads = [_slerp(d0, turn_to, curl * (i / (rows - 1)) ** 2.5) for i in range(rows)]
        centre = [root.copy()]
        for i in range(rows - 1):
            step = (heads[i] + heads[i + 1]) / 2
            centre.append(centre[-1] + step / np.linalg.norm(step) * length / (rows - 1))
        outer = np.zeros((rows, cols, 3))
        inner = np.zeros((rows, cols, 3))
        for i in range(rows):
            t = i / (rows - 1)
            across = across0 - heads[i] * np.dot(across0, heads[i])
            across /= np.linalg.norm(across)
            n = np.cross(heads[i], across)
            half = w * (0.38 + 0.62 * math.sin(math.pi / 2 * min(1.0, t * 1.35))) * (0.55 if i == rows - 1 else 1.0)
            for j, k in enumerate(np.linspace(-1, 1, cols)):
                # a little cupped, the shaft standing proud
                outer[i, j] = centre[i] + across * half * k + n * (0.0012 * (1 - k * k) - 0.002 * k * k)
                inner[i, j] = centre[i] + across * half * k - n * (0.0004 - 0.002 * k * k)
        pillow(part, outer, inner, uv=atlas_uv("tail", rows, cols, root_top=False))
    part.weigh(lambda p: near_bones(p, ["tail_1", "tail_2"], extra={"pelvis": 0.3} if p[1] < 0.37 else None))
    return part


# ---- feather cards ------------------------------------------------------------------------------------------------


def on_shell(origins, dirs, field=None):
    """Points of the shell hit from inside, and its outward normals there."""
    field = field or shell_field
    hits = cast(field, np.asarray(origins, float), np.asarray(dirs, float))
    return hits, outward(field, hits)


def atlas_uv(name, rows, cols, root_top=True):
    """Texture coordinates for a card's grid in its rectangle of the cards' picture: columns across the rectangle;
    rows from the root at the top to the tip at the bottom, or the other way up."""
    u0, v0, u1, v1 = ATLAS[name]
    uv = np.zeros((rows, cols, 2))
    for i in range(rows):
        t = i / (rows - 1)
        for j in range(cols):
            uv[i, j] = (u0 + (u1 - u0) * j / (cols - 1), v1 - (v1 - v0) * t if root_top else v0 + (v1 - v0) * t)
    return uv


def fringe(part, base, normals, hang, length, lift, atlas, thick=0.0006, wrap=False, sink=0.0015, rows=3):
    """A strip of feather tips: rooted along `base` (points on the shell) a little under the surface, hanging
    `length` along `hang` (a direction a point, along the surface) and lifting `lift` off it at the tips."""
    base, normals, hang = (np.asarray(a, float) for a in (base, normals, hang))
    cols = len(base)
    outer = np.zeros((rows, cols, 3))
    inner = np.zeros((rows, cols, 3))
    ls = np.broadcast_to(np.asarray(length, float), (cols,))
    for i in range(rows):
        t = i / (rows - 1)
        p = base + hang * (ls * t)[:, None] + normals * (lift * t ** 1.5 - sink * (1 - t))
        outer[i] = p
        inner[i] = p - normals * thick
    uv = atlas_uv(atlas, rows, cols + (1 if wrap else 0))
    pillow(part, outer, inner, uv=uv, wrap=wrap)


def along_surface(normals, d):
    """Direction `d` laid along the surface: without its part along each normal, unit length."""
    d = np.broadcast_to(np.asarray(d, float), normals.shape)
    d = d - normals * np.einsum("ij,ij->i", normals, d)[:, None]
    return d / np.linalg.norm(d, axis=1, keepdims=True)


def hood_fringe(shell):
    """The ragged edge of the hood round the face (left side): tufts rooted just under the cap along the edge between
    the shell's hood and face pieces, from the face's lower corner up to where the edge goes under the brow, lying
    forward over the bare skin."""
    part = Part("hood_edge_l", material="dodo_cards", region=HOOD_R)
    grid = shell.grid
    k = grid.shape[1]
    pts = np.array(shell.points)
    line, across = [], []
    for i in range(grid.shape[0] - 1):
        for j in range(1, k // 2):
            if shell.islands[i * k + j - 1] == "shell_hood" and shell.islands[i * k + j] == "shell_face":
                if pts[grid[i, j]][2] <= HOOD_EDGE["brow"]:
                    line.append(pts[grid[i, j]])
                    across.append(pts[grid[i, j + 1]] - pts[grid[i, j - 1]])
    line, across = np.array(line), np.array(across)
    cols = HOOD_EDGE["columns"]
    s_ = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(line, axis=0), axis=1))])
    want = np.linspace(0, s_[-1], cols)
    base = np.stack([np.interp(want, s_, line[:, c]) for c in range(3)], axis=1)
    hang = np.stack([np.interp(want, s_, across[:, c]) for c in range(3)], axis=1)
    base = project(shell_field, base)
    n = outward(shell_field, base)
    hang = along_surface(n, hang)
    fringe(part, base - hang * HOOD_EDGE["behind"], n, hang, HOOD_EDGE["behind"] + HOOD_EDGE["over"],
           HOOD_EDGE["lift"], "hood")
    return part


def forehead_point():
    """The hood's blunt point between the brows, over the root of the beak."""
    part = Part("forehead", material="dodo_cards", region=HOOD_R)
    xs = np.linspace(-0.011, 0.011, 4)
    base, n = on_shell([[x, 0.600, 0.16] for x in xs], [[0.0, 0.55, 1.0]] * 4)
    hang = along_surface(n, (0.0, -0.6, 1.0))
    fringe(part, base, n, hang, np.array([0.006, 0.012, 0.012, 0.006]), 0.0015, "forehead")
    return part


def mane():
    """The lank mane down the back of the neck: layers of longer feathers, each a strip of columns round the back of
    the neck, longest down the middle."""
    part = Part("mane", material="dodo_cards", region=HOOD_R)
    for top, bottom, around, narrow, cols in MANE:
        spread = np.linspace(-1, 1, cols)
        rows = 3
        outer = np.zeros((rows, cols, 3))
        inner = np.zeros((rows, cols, 3))
        for i in range(rows):
            t = i / (rows - 1)
            a = np.radians(spread * (around + (narrow - around) * t))
            rays = np.stack([np.sin(a), np.zeros(cols), -np.cos(a)], axis=1)
            # longest down the middle
            y = top + (bottom - top) * t - (1 - spread ** 2) * 0.008 * t
            hits, n = on_shell(np.stack([np.zeros(cols), y, np.full(cols, 0.14)], axis=1), rays)
            sink = np.where(np.arange(cols) % 2, MANE_SINK[1], MANE_SINK[0]) * (1 - t)
            outer[i] = hits + n * (MANE_LIFT * t ** 1.2 - sink)[:, None]
            inner[i] = outer[i] - n * 0.0006
        pillow(part, outer, inner, uv=atlas_uv("mane", rows, cols))
    return part


def trousers(shell):
    """Long loose feathers hanging over the top of the left leg like a shaggy trouser leg: an outer ring rooted on the
    flank above the leg, an inner ring under the body, both bellying out and hanging to the top of the scaly leg. Their
    roots move with the body they grow from and their tips with the leg they hang round."""
    part = Part("trousers_l", material="dodo_cards", region=BODY_R)
    hang = {}
    lx, lz = TROUSERS["leg"]
    for ring in TROUSERS["rings"]:
        k = ring["around"]
        angles = np.linspace(0, 2 * math.pi, k, endpoint=False)
        out = np.array([[math.sin(a), 0.0, math.cos(a)] for a in angles])
        d = math.radians(ring["down"])
        rays = out * math.cos(d) + np.array([0.0, -math.sin(d), 0.0])
        base, n = on_shell(np.repeat([[lx, ring["from"], lz]], k, 0), rays)
        tip = np.array([lx, ring["tip_y"], lz]) + out * ring["tip_radius"]
        rows = 3
        outer = np.zeros((rows, k, 3))
        inner = np.zeros((rows, k, 3))
        for i in range(rows):
            t = i / (rows - 1)
            p = base * (1 - t) + tip * t - n * 0.002 * (1 - t) + out * ring["belly"] * math.sin(math.pi * t)
            outer[i] = p
            inner[i] = p - out * 0.0006
        for grid in pillow(part, outer, inner, uv=atlas_uv("trousers", rows, k + 1), wrap=True):
            for i, row in enumerate(grid):
                for v in row:
                    hang[v] = i / (rows - 1)
    transfer_weights(part, shell)
    for v, t in hang.items():
        leg = near_bones(np.array(part.points[v]), ["thigh_l", "shin_l"])
        body = part.weights[v]
        part.weights[v] = {n: (1 - t) * body.get(n, 0.0) + t * leg.get(n, 0.0) for n in set(body) | set(leg)}
    return part


def tuft(part, root, n, hang, length, width, lift, variant):
    """One cluster of feather tips: a leaf rooted just under the skin and lying along `hang`, its tip `lift` off the
    body; both sides drawn from a quarter of the body strip's picture."""
    across = np.cross(n, hang)
    across /= np.linalg.norm(across)
    outline = [(-0.36, 0.0), (-0.50, 0.40), (-0.40, 0.80), (-0.12, 1.0), (0.12, 1.0), (0.40, 0.80), (0.50, 0.40),
               (0.36, 0.0)]
    u0, v0, u1, v1 = ATLAS["body"]
    q0, q1 = u0 + (u1 - u0) * variant / 4, u0 + (u1 - u0) * (variant + 1) / 4

    def at(a, t, rise):
        return root + hang * (t * length) + across * (a * width) + n * (lift * t ** 1.5 - TUFTS["sink"] * (1 - t) + rise)

    def uv(a, t):
        return (q0 + (q1 - q0) * (a + 0.5), v1 - (v1 - v0) * t)

    rim = [part.point(at(a, t, 0.0)) for a, t in outline]
    front = part.point(at(0.0, 0.5, 0.0008))
    back = part.point(at(0.0, 0.5, -0.0008))
    m = len(rim)
    for i in range(m):
        j = (i + 1) % m
        (a0, t0), (a1, t1) = outline[i], outline[j]
        part.face((front, rim[i], rim[j]), uv=[uv(0.0, 0.5), uv(a0, t0), uv(a1, t1)], island=part.name + "_out")
        part.face((back, rim[j], rim[i]), uv=[uv(0.0, 0.5), uv(a1, t1), uv(a0, t0)], island=part.name + "_in")
        part.sharp.add((min(rim[i], rim[j]), max(rim[i], rim[j])))
        part.cut(rim[i], rim[j])


def tufts(shell):
    """Tufts over the left side of the body, chosen from the shell's points: most where the surface turns edge-on to
    the side or the front view, where the outline runs; none on the head, under the folded wing, round the legs or
    the tail's root, under the pouch or the mane."""
    part = Part("tufts_l", material="dodo_cards", region=BODY_R)
    pts = np.array(shell.points)
    keep = (pts[:, 0] > 0.012) & (pts[:, 1] > 0.15) & (pts[:, 1] < 0.47)
    keep &= ~((pts[:, 2] > 0.17) & (pts[:, 1] > 0.42))
    keep &= ~((pts[:, 2] < 0.10) & (pts[:, 1] > 0.43) & (pts[:, 0] < 0.05))
    keep &= np.linalg.norm(pts - np.array(TAIL_ROOT), axis=1) > 0.05
    keep &= pocket(pts) < 0.0012
    keep &= ~((pts[:, 1] < 0.20) & (np.hypot(pts[:, 0] - TROUSERS["leg"][0], pts[:, 2] - TROUSERS["leg"][1]) < 0.06))
    idx = np.nonzero(keep)[0]
    n = outward(shell_field, pts[idx])
    rim = np.maximum(1 - np.abs(n[:, 0]), 1 - np.abs(n[:, 2])) ** 3
    # a fixed order of tie-breaks, so every build picks the same
    order = np.argsort(-(rim + 0.08 * np.sin(idx * 12.9898) ** 2))
    chosen = []
    for k in order:
        p = pts[idx[k]]
        gap = TUFTS["spacing"] * (1.5 - 0.7 * rim[k])
        if all(np.linalg.norm(p - pts[idx[c]]) > gap for c in chosen):
            chosen.append(k)
        if len(chosen) >= TUFTS["count"]:
            break
    flow = np.array([0.0, -1.0, -0.6])
    for c, k in enumerate(chosen):
        p, nk = pts[idx[k]], n[k]
        hang = flow - nk * np.dot(flow, nk)
        hang /= np.linalg.norm(hang)
        f = (math.sin(c * 2.399) + 1) / 2  # the golden angle spreads sizes evenly over the tufts
        g = (math.sin(c * 1.618 + 1) + 1) / 2
        length = TUFTS["length"][0] + (TUFTS["length"][1] - TUFTS["length"][0]) * f
        width = TUFTS["width"][0] + (TUFTS["width"][1] - TUFTS["width"][0]) * g
        lift = TUFTS["lift"][0] + (TUFTS["lift"][1] - TUFTS["lift"][0]) * rim[k]
        tuft(part, p - hang * length * 0.15, nk, hang, length, width, lift, c % 4)
    return part


# =====================================================================================================================
# Regions and weights
# =====================================================================================================================


def beak_half_width(z):
    """The upper beak's half width at z, from its stations."""
    zs = [(t[1] + b[1]) / 2 for t, b, _ in BEAK]
    return float(np.interp(z, zs, [w for _, _, w in BEAK]))


def in_sheath(c):
    """Whether a point of the shell lies inside the upper beak's sheath, 2 mm in from its sides and its top: the back of
    the mouth, never seen but through the open beak."""
    x, y, z = c
    if z <= 0.205 or y <= 0.543:
        return False
    w = beak_half_width(z)
    if abs(x) >= w - 0.002:
        return False
    top = float(np.interp(z, [t[1] for t, _, _ in BEAK], [t[0] for t, _, _ in BEAK]))
    bottom = float(np.interp(z, [b[1] for _, b, _ in BEAK], [b[0] for _, b, _ in BEAK]))
    half = beak_profile(1.0, 1.0, 0.0)[:6]  # the top of the section, from the ridge to the widest point
    rise = float(np.interp(abs(x) / w, [a for a, _ in half], [b for _, b in half]))
    return y < (top + bottom) / 2 + (top - bottom) / 2 * rise - 0.002


def shell_regions(c):
    """The colour region of a point of the shell: the bare face, the hood with its mane down the nape, or body."""
    x, y, z = c
    if in_sheath(c):
        return BARE_R
    edge =0.136 + (0.600 - y) * 0.36  # the hood's edge behind the face
    if y < 0.604 and z > 0.13 and abs(x) > 0.008:
        low = 0.563 - (z - 0.152) * 0.86  # the neck feathers' edge under the face
        if z > edge and y > low:
            return FACE_R
    if y > 0.600:
        return HOOD_R
    if y >= 0.563 and z < edge:
        return HOOD_R
    if 0.475 < y < 0.563 and z < 0.150 - (0.563 - y) * 0.784:
        return HOOD_R
    if 0.440 < y <= 0.475 and abs(x) < 0.032 * (y - 0.440) / 0.035 and z < 0.11:
        return HOOD_R
    return BODY_R


def shell_layout(part):
    """Gives the shell its regions on whole quads of its grid, in rectangles of rings and columns, so each region's
    edge runs straight along the grid: the face is a span of columns on the rings it crosses; the hood covers the head
    from the top and back midline down to the face, behind the face down to the jaw, and down the nape as a strip.
    shell_regions says roughly where; the rectangles are fitted to it. Each region is a piece of the texture of its
    own, cut along its edge. Once the layout is published, each face stays on the piece it has there, and takes that
    piece's region; what lies inside the beak's sheath is the back of the mouth."""
    grid = part.grid
    n, k = grid.shape
    half = k // 2
    pts = np.array(part.points)
    cls = np.zeros((n - 1, half), int)
    for i in range(n - 1):
        for j in range(half):
            c = (pts[grid[i, j]] + pts[grid[i, j + 1]] + pts[grid[i + 1, j]] + pts[grid[i + 1, j + 1]]) / 4
            cls[i, j] = shell_regions(c)
    has_face = [i for i in range(n - 1) if (cls[i] == FACE_R).sum() >= 2]
    f0, f1 = min(has_face), max(has_face)
    j0 = int(np.median([np.nonzero(cls[i] == FACE_R)[0].min() for i in has_face]))
    j1 = int(np.median([np.nonzero(cls[i] == FACE_R)[0].max() for i in has_face]))
    hood_hi = np.array([np.nonzero(cls[i] == HOOD_R)[0].max() if (cls[i] == HOOD_R).any() else -1 for i in range(n - 1)])
    has_hood = [i for i in range(n - 1) if hood_hi[i] >= 0]
    m0 = min(has_hood)
    behind = [i for i in range(m0, f0) if hood_hi[i] >= (j1 + 3) // 2]
    c0 = min(behind) if behind else f0
    jm = max(1, int(np.median(hood_hi[m0:c0]))) if c0 > m0 else 1
    out = np.full((n - 1, half), BODY_R)
    for i in range(n - 1):
        for j in range(half):
            if cls[i, j] == BARE_R:
                out[i, j] = BARE_R
            elif f0 <= i and j0 <= j <= j1 and i <= f1 + 2:
                out[i, j] = FACE_R
            elif (i >= f0 and j < j0) or (c0 <= i < f0 and j <= j1) or (m0 <= i < c0 and j <= jm):
                out[i, j] = HOOD_R
    names = {BODY_R: "shell_body", FACE_R: "shell_face", HOOD_R: "shell_hood", BARE_R: "shell_face"}
    region = {"shell_body": BODY_R, "shell_face": FACE_R, "shell_hood": HOOD_R}
    piece, mirror = {}, {}
    for i in range(n - 1):
        for j in range(k):
            jj = j if j < half else k - 1 - j
            piece[i * k + j] = names[int(out[i, jj])]
            mirror[i * k + j] = i * k + (k - 1 - j)
    caps = (n - 1) * k
    for j in range(k):
        jj = j if j < half else k - 1 - j
        for f, row in ((caps + 2 * j, 0), (caps + 2 * j + 1, n - 2)):
            piece[f] = names[int(out[row, jj])]
            mirror[f] = caps + 2 * (k - 1 - j) + (f - caps) % 2
    pin = pinned(part)
    for f in piece:
        if pin is not None:
            piece[f] = pin["faces"][f if f in pin["faces"] else mirror[f]][0]
        part.islands[f] = piece[f]
        centre = np.mean([part.points[v] for v in part.faces[f]], axis=0)
        part.regions[f] = BARE_R if piece[f] == "shell_face" and in_sheath(centre) else region[piece[f]]
    cut_islands(part)


def cut_islands(part):
    """Cuts the texture where faces of two pieces of it meet."""
    owner = {}
    for f, face in enumerate(part.faces):
        for a, b in zip(face, face[1:] + face[:1]):
            owner.setdefault((min(a, b), max(a, b)), []).append(part.islands[f])
    for e, isl in owner.items():
        if len(set(isl)) > 1:
            part.seams.add(e)


def transfer_weights(part, shell, extra=None):
    """Each point of a card takes the weights of the nearest point of the shell, and `extra(point)` on top."""
    src = np.array(shell.points)
    out = []
    for p in part.points:
        p = np.array(p)
        i = int(np.argmin(np.einsum("ij,ij->i", src - p, src - p)))
        w = dict(shell.weights[i])
        if extra:
            for n, x in extra(p).items():
                w[n] = w.get(n, 0.0) + x
        out.append(w)
    part.weights = out


def _segment_distance(p, a, b):
    ab = b - a
    t = np.clip(np.dot(p - a, ab) / max(np.dot(ab, ab), 1e-12), 0, 1)
    return np.linalg.norm(p - (a + ab * t))


BONES = {b[0]: (np.array(b[2]), np.array(b[3])) for b in rig.all_bones()}


def near_bones(p, names, power=4, extra=None):
    """Weights by nearness to the named bones."""
    w = {n: 1.0 / max(_segment_distance(p, *BONES[n]), 0.004) ** power for n in names}
    total = sum(w.values())
    w = {n: x / total for n, x in w.items()}
    if extra:
        for n, x in extra.items():
            w[n] = w.get(n, 0.0) + x
    return w


SPINE = ["pelvis", "belly", "chest", "neck_1", "neck_2", "neck_3", "neck_4", "skull"]


def spine_weights(centre):
    """Weights for a ring of the shell from where its centre lies along the spine: each bone's span, blended over a
    short way either side of each joint."""
    chain = [BONES[n][0] for n in SPINE] + [BONES["skull"][1]]
    best, at = 1e9, 0.0
    lengths = [np.linalg.norm(b - a) for a, b in zip(chain, chain[1:])]
    s0 = 0.0
    for a, b, L in zip(chain, chain[1:], lengths):
        ab = b - a
        t = np.clip(np.dot(centre - a, ab) / np.dot(ab, ab), 0, 1)
        d = np.linalg.norm(centre - (a + ab * t))
        if d < best:
            best, at = d, s0 + t * L
        s0 += L
    joints = np.concatenate([[0], np.cumsum(lengths)])
    w = {}
    blend = 0.022
    for k, n in enumerate(SPINE):
        lo, hi = joints[k], joints[k + 1]
        rise = 1.0 if k == 0 else np.clip((at - lo) / blend + 0.5, 0, 1)
        fall = 1.0 if k == len(SPINE) - 1 else np.clip((hi - at) / blend + 0.5, 0, 1)
        v = min(rise, fall)
        if v > 0:
            w[n] = v
    return w


def shell_weights(part):
    """The shell follows the spine ring by ring, with the legs, wings, tail and jaw pulling on the skin near them."""
    grid = part.grid
    n_rings, k = grid.shape
    ring_of = {}
    for i in range(n_rings):
        for v in grid[i]:
            ring_of[v] = i
    spine = [spine_weights(c) for c in part.centres]
    pts = np.array(part.points)
    out = []
    for v, p in enumerate(pts):
        i = ring_of.get(v, 0 if v == len(pts) - 2 else n_rings - 1)
        w = dict(spine[i])
        x, y, z = p
        side = "l" if x > 0 else "r"
        # the thighs pull the skin over the hips
        d = _segment_distance(p, *BONES["thigh_" + side])
        if y < 0.27 and abs(x) > 0.02:
            w["thigh_" + side] = 0.9 * max(0.0, 1 - d / 0.07) ** 2
        # the wing's root pulls the skin of the shoulder
        d = np.linalg.norm(p - BONES["wing_upper_" + side][0])
        if d < 0.05:
            w["wing_upper_" + side] = 0.35 * (1 - d / 0.05) ** 2
        # the rump under the tail
        d = np.linalg.norm(p - np.array(TAIL_ROOT))
        if d < 0.05 and y > 0.30:
            w["tail_1"] = 0.8 * (1 - d / 0.05) ** 2
        # the jowls and chin open with the jaw
        d = np.linalg.norm((p - np.array(JOWL["centre"]) * (np.sign(x) or 1, 1, 1)) / (1.0, 1.0, 1.3))
        if y < 0.56 and z > 0.16 and d < 0.03:
            w["jaw"] = 1.2 * (1 - d / 0.03) ** 2
        # and the skin under the chin, round the root of the lower beak, which swings back into it as it opens
        d = np.linalg.norm((p - np.array(CHIN)) / (1.2, 0.8, 1.0))
        if d < 0.03:
            w["jaw"] = max(w.get("jaw", 0.0), 1.2 * (1 - d / 0.03) ** 2)
        out.append(w)
    part.weights = out


def finish_weights(weights, most=4):
    out = []
    for w in weights:
        top = sorted(((n, x) for n, x in w.items() if x > 1e-4), key=lambda kv: -kv[1])[:most]
        total = sum(x for _, x in top)
        out.append({n: x / total for n, x in top})
    return out


def smooth_weights(part, rounds=6, amount=0.5):
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


def mirror_name(name):
    return rig._mirror_name(name)


def mirrored(part, name):
    """The part on the other side: points across x, faces turned so they still face out, weights to the other side's
    bones. Its texture is the first part's, mirrored."""
    out = Part(name, part.material, part.region)
    out.points = [(-x, y, z) for x, y, z in part.points]
    out.faces = [f[::-1] for f in part.faces]
    out.regions = list(part.regions)
    out.uvs = [None if uv is None else uv[::-1] for uv in part.uvs]
    out.islands = list(part.islands)
    out.weights = [{mirror_name(n): x for n, x in w.items()} for w in part.weights]
    out.sharp = set(part.sharp)
    out.seams = set(part.seams)
    out.soft = part.soft
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


def split(part, f, seen):
    """A face's triangles, as corner numbers: a quad is cut on its shorter diagonal, so no triangle lies across the
    texture the wrong way round, and the same way on both sides of the bird (lengths and ties are read from mirror-
    blind positions)."""
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
    # where a thin card's two sides meet at a corner, the shorter cut would make a triangle the other side has
    if any(frozenset(f[k] for k in t) in seen for t in first):
        first = second
    seen.update(frozenset(f[k] for k in t) for t in first)
    return first


def shape(part):
    """A short fingerprint of a part's faces, so the published layout goes only onto the faces it was made for."""
    return hashlib.sha1(repr(part.faces).encode()).hexdigest()[:16]


_PUBLISHED = {}
# The candidate planes (slicing_planes) the shell's rings lie in, as shell_grid picked them.
SHELL_RINGS = []


def published():
    """The published layout as layout.json holds it."""
    if not _PUBLISHED:
        with open(LAYOUT_FILE) as fh:
            _PUBLISHED.update(json.load(fh))
    return _PUBLISHED


def pinned(part):
    """A part's faces in the published layout: {"shape": its fingerprint, "faces": {face: (piece, [texture coordinate
    of each corner])}}, its left side only. None when the layout is being made afresh or the part is not in it."""
    if FRESH:
        return None
    p = published()["parts"].get(part.name)
    if p is None:
        return None
    uv = np.frombuffer(base64.b64decode(p["uv"]), "<f4").reshape(-1, 2)
    faces, at = {}, 0
    for f, k in zip(p["face"], p["piece"]):
        n = len(part.faces[f])
        faces[f] = (p["pieces"][k], [(float(a), float(b)) for a, b in uv[at:at + n]])
        at += n
    return {"shape": p["shape"], "faces": faces}


# Each face assemble made, in order: (part, face, its corners, the part's fingerprint); write_layout reads it.
MADE = []


def assemble(parts):
    """One mesh object from the parts, in triangles: face regions and islands as attributes, the texture coordinates
    of the cards and of the published layout, sharp edges and texture cuts."""
    MADE.clear()
    bm = bmesh.new()
    region = bm.faces.layers.int.new("region")
    island = bm.faces.layers.int.new("island")
    given = bm.faces.layers.int.new("given")
    uv_layer = bm.loops.layers.uv.new("UVMap")
    mats = list(rig.MATERIALS)
    deform = bm.verts.layers.deform.verify()
    groups = {}
    names = []
    soft = {}
    for part in parts:
        face_outward(part)
        mark = shape(part)
        pin = pinned(part)
        if pin is not None and pin["shape"] != mark:
            raise RuntimeError(f"model: the faces of {part.name} are not those the published texture layout "
                               f"({LAYOUT_FILE}) was made for, and paint is on it. Agree a new layout with the texture "
                               "maker, then build with DODO_LAYOUT=new to lay it out afresh.")
        seen = set()
        verts = [bm.verts.new(rig.to_blender(p)) for p in part.points]
        if part.soft:
            body = outward(flank_field, np.array(part.points))
            for v, nv in zip(verts, body):
                soft[v] = tuple(rig.to_blender(nv))
        for v, w in zip(verts, finish_weights(part.weights)):
            for n, x in w.items():
                g = groups.setdefault(n, len(groups))
                v[deform][g] = x
        for fi, (f, r, uv, isl) in enumerate(zip(part.faces, part.regions, part.uvs, part.islands)):
            if pin is not None and fi in pin["faces"]:
                isl, uv = pin["faces"][fi]
            if isl not in names:
                names.append(isl)
            for corners in split(part, f, seen):
                MADE.append((part.name, fi, corners, mark))
                face = bm.faces.new([verts[f[k]] for k in corners])
                face[region] = r
                face[island] = names.index(isl)
                face.material_index = mats.index(part.material)
                face.smooth = True
                if uv is not None:
                    face[given] = 1
                    for loop, k in zip(face.loops, corners):
                        loop[uv_layer].uv = uv[k]
        bm.edges.ensure_lookup_table()
        for pairs, flag in ((part.sharp, "smooth"), (part.seams, "seam")):
            for a, b in pairs:
                e = bm.edges.get((verts[a], verts[b]))
                if e is not None:
                    if flag == "smooth":
                        e.smooth = False
                    else:
                        e.seam = True
    bm.verts.index_update()
    soft_normals = [None] * len(bm.verts)
    for v, n in soft.items():
        soft_normals[v.index] = n
    mesh = bpy.data.meshes.new("dodo")
    bm.to_mesh(mesh)
    bm.free()
    for name in mats:
        mesh.materials.append(bpy.data.materials.get(name) or bpy.data.materials.new(name))
    obj = bpy.data.objects.new("dodo_model", mesh)
    bpy.context.scene.collection.objects.link(obj)
    for n, g in sorted(groups.items(), key=lambda kv: kv[1]):
        obj.vertex_groups.new(name=n)
    obj["islands"] = names
    if soft:
        # Cards lying on the body take the body's normal, so they are lit as the plumage they sit in. Each face takes
        # it turned to its own side: the game turns a face's normal round when its back is seen, so either side of a
        # card, seen from outside, is lit as the body.
        normals = [tuple(c.vector) for c in mesh.corner_normals]
        for poly in mesh.polygons:
            for li in poly.loop_indices:
                n = soft_normals[mesh.loops[li].vertex_index]
                if n is not None:
                    normals[li] = n if poly.normal.dot(n) >= 0 else tuple(-x for x in n)
        mesh.normals_split_custom_set(normals)
    return obj


def _island_density(name):
    for key, d in DENSITY:
        if name.startswith(key):
            return d
    return 1.0


def lay_out(obj):
    """Lays out the opaque material's texture. Once published it is pinned: assemble has put every face of the bird's
    left side where layout.json has it, and a face it has no place for stops the build. Laid out afresh
    (DODO_LAYOUT=new), the left side is unwrapped with least stretch (a part that brings its own coordinates keeps
    them); each piece is scaled to the texture it deserves for how closely it is looked at (DENSITY), stood upright so
    the bird's up runs up the picture, and packed, and the layout is written to layout.json. The right side takes the
    left side's texture, mirrored."""
    mesh = obj.data
    names = list(obj["islands"])
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.context.scene.tool_settings.use_uv_select_sync = True
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_mode(type="FACE")
    bm = bmesh.from_edit_mesh(mesh)
    opaque = list(rig.MATERIALS).index("dodo")
    given = bm.faces.layers.int["given"]
    isl = bm.faces.layers.int["island"]
    if not FRESH:
        loose = sorted({names[f[isl]] for f in bm.faces
                        if f.material_index == opaque and f.calc_center_median().x > 0 and not f[given]})
        if loose:
            raise RuntimeError(f"model: the published texture layout ({LAYOUT_FILE}) has no place for faces of "
                               f"{', '.join(loose)}, and paint is on it. Agree a new layout with the texture maker, "
                               "then build with DODO_LAYOUT=new to lay it out afresh.")
    else:
        _unwrap(mesh, names, opaque)
    bm = bmesh.from_edit_mesh(mesh)
    uv = bm.loops.layers.uv.active

    def where(v, sign=1):
        return (round(sign * v.co.x, 6), round(v.co.y, 6), round(v.co.z, 6))

    lefts = {}
    for f in bm.faces:
        if f.material_index == opaque and f.calc_center_median().x > 0:
            lefts[frozenset(where(v) for v in f.verts)] = f
    for f in bm.faces:
        if f.material_index != opaque or f.calc_center_median().x >= 0:
            continue
        g = lefts.get(frozenset(where(v, -1) for v in f.verts))
        if g is None:
            raise RuntimeError(f"model: a face on the right has no mirror on the left, at {tuple(f.calc_center_median())}")
        at = {where(l.vert): tuple(l[uv].uv) for l in g.loops}
        for l in f.loops:
            l[uv].uv = at[where(l.vert, -1)]
    bmesh.update_edit_mesh(mesh)
    bpy.ops.object.mode_set(mode="OBJECT")
    if FRESH:
        write_layout(obj)


def _unwrap(mesh, names, opaque):
    """The left side's texture laid out afresh (lay_out)."""
    bm = bmesh.from_edit_mesh(mesh)
    given = bm.faces.layers.int["given"]
    for f in bm.faces:
        f.select = f.material_index == opaque and f.calc_center_median().x > 0 and not f[given]
    bm.select_flush_mode()
    bmesh.update_edit_mesh(mesh)
    bpy.ops.uv.unwrap(method="MINIMUM_STRETCH", margin=0.002, fill_holes=True, correct_aspect=True)
    bm = bmesh.from_edit_mesh(mesh)
    uv = bm.loops.layers.uv.active
    isl = bm.faces.layers.int["island"]
    left = [f for f in bm.faces if f.material_index == opaque and f.calc_center_median().x > 0]
    by_island = {}
    for f in left:
        by_island.setdefault(f[isl], []).append(f)
    # each piece's texture to the size of its surface, times its density, turned upright
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
        weight = np.zeros(2)
        total = 0.0
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
        scale = common / max(ratios[k], 1e-12) * _island_density(names[k])
        for l in loops:
            x, y = np.array(tuple(l[uv].uv)) - mid
            l[uv].uv = (mid[0] + scale * (c * x - s * y), mid[1] + scale * (s * x + c * y))
    for f in bm.faces:
        f.select = f in set(left)
    bm.select_flush_mode()
    bmesh.update_edit_mesh(mesh)
    bpy.ops.uv.pack_islands(rotate=False, scale=True, margin_method="FRACTION", margin=0.005, shape_method="CONCAVE")


def write_layout(obj):
    """Writes the layout to LAYOUT_FILE: the planes of the shell's rings, and the left side's opaque faces by part:
    its fingerprint, the pieces, and for each face its piece and its corners' texture coordinates (32-bit floats in
    base64, the faces in order)."""
    mesh = obj.data
    names = list(obj["islands"])
    opaque = list(rig.MATERIALS).index("dodo")
    uv = mesh.uv_layers.active.data
    isl = mesh.attributes["island"].data
    got = {}
    for poly, (part, f, corners, mark) in zip(mesh.polygons, MADE):
        if poly.material_index != opaque or poly.center.x <= 0:
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
    with open(LAYOUT_FILE, "w") as fh:
        json.dump({"about": "The dodo's published texture layout, written by model.py (lay_out) and read by it on "
                            "every build. Paint goes onto it, so it is written again only when the texture maker "
                            "agrees to a new layout.", "shell_rings": list(SHELL_RINGS), "parts": parts}, fh,
                  separators=(",", ":"))
    print("model: wrote the texture layout to", LAYOUT_FILE)


def attach(child, parent, midline=False, by_anchor=False):
    """Pins each closed piece of `child` to `parent` at one point: the child's point nearest the parent moves onto the
    parent's point and takes its weights. The two are then one piece wherever the levels of detail are made, so a thin
    card or a small part never ends as a sliver of its own. With `midline`, both points lie on the bird's middle, which
    keeps a part mirrored about it, and a tube is pinned by its first end (inside the head for the beaks)."""
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
    side = np.sign(cp[:, 0].mean()) if not midline else 0.0
    ok = np.abs(pp[:, 0]) < 1e-9 if midline else (pp[:, 0] * side >= 0)
    candidates = np.nonzero(ok)[0]
    pieces = {}
    only = getattr(child, "anchor", None) if midline or by_anchor else None
    for v in range(len(cp)):
        if (midline and abs(cp[v, 0]) > 1e-9) or (only is not None and v != only):
            continue
        pieces.setdefault(find(v), []).append(v)
    for vs in pieces.values():
        d = np.linalg.norm(cp[vs][:, None, :] - pp[candidates][None, :, :], axis=2)
        i, j = np.unravel_index(np.argmin(d), d.shape)
        v, u = vs[i], candidates[j]
        child.points[v] = parent.points[u]
        child.weights[v] = dict(parent.weights[u])


def build():
    r = rig.find()
    r.drop_blockout()
    shell = shell_part()
    shell_weights(shell)
    smooth_weights(shell)
    shell_layout(shell)
    beak, jaw, tongue_ = upper_beak(), lower_beak(), tongue()
    attach(beak, shell, midline=True)
    attach(tongue_, jaw, midline=True)
    # the jaw's back end, buried in the head behind the hinge, is pinned to the head
    attach(jaw, shell, midline=True)
    throat = pouch()
    # the pouch follows the neck skin it lies on; its middle swells a little with the throat
    transfer_weights(throat, shell, lambda p: {"throat": 0.25 * swell(p)})
    attach(throat, shell, midline=True)
    parts = [shell, beak, jaw, tongue_, throat]
    left = {}
    for make in (eyeball, upper_lid, brow, wing, shoulder, fingers, leg, toes):
        left[make.__name__] = make(1.0)
    attach(left["brow"], shell)
    leg_l = left["leg"]
    leg_l.weights[-1] = {"toes_l": 1.0}  # the pad under the ball of the foot, where the toes are pinned
    attach(left["toes"], leg_l)
    # the leg's top end, hidden inside the body, is pinned to the body, so the coarsest levels keep the legs
    attach(leg_l, shell, by_anchor=True)
    attach(left["shoulder"], left["wing"])
    attach(left["fingers"], left["wing"])
    for part in left.values():
        parts += [part, mirrored(part, mirror_name(part.name))]
    feathers_tail = tail()
    attach(feathers_tail, shell)
    head = forehead_point()
    head.weigh(lambda p: {"skull": 1.0})
    # The mane and the hood's edge lie on the skin they hang over and move with it, so a turn of the head does not
    # swing their lower ends into the neck. The hood bone that lifts the mane turns with the skull, so it carries the
    # mane's upper part, less and less down to its lowest feathers, which lie with the neck alone.
    feathers = mane()
    transfer_weights(feathers, shell, lambda p: {"hood": float(np.interp(p[1], (0.49, 0.57), (0.0, 0.9)))})
    for card in (head, feathers):
        attach(card, shell)
        card.soft = True
    parts += [feathers_tail, head, feathers]
    edge = hood_fringe(shell)
    transfer_weights(edge, shell)
    legs = trousers(shell)
    loose = tufts(shell)
    transfer_weights(loose, shell)
    for card in (edge, legs, loose):
        attach(card, shell)
        card.soft = True
    for card in (edge, legs, loose):
        parts += [card, mirrored(card, mirror_name(card.name))]
    obj = assemble(parts)
    lay_out(obj)
    r.bind(obj)
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    print(f"model: {len(parts)} parts, {len(obj.data.vertices)} points, {tris} triangles")
    return obj


if __name__ == "__main__":
    build()

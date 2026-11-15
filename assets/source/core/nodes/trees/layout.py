# Where each part of a tree finds itself in its pictures, shared by the model and the texture guides. Rectangles are
# (u0, v0, u1, v1) in fractions of the picture, v down from its top row.

import os

HERE = os.path.dirname(os.path.abspath(__file__))


def picture_dir(name):
    """The folder of a material's pictures. STANDIN=oak_leaves,... reads those from tex/_placeholder/ while their real
    pictures are being made."""
    if name in os.environ.get("STANDIN", "").split(","):
        return os.path.join(HERE, "tex", "_placeholder", name)
    return os.path.join(HERE, "tex", name)

# A frond atlas holds three fronds side by side, each drawn straight up its slot with its midrib down the middle, its
# foot at the bottom row and its tip at the top. `length` and `half` are the metres the slot's height and half its
# width cover, so the picture lands on the frond at its true size.
FRONDS = {
    "royal_frond": {"slots": 3, "length": 4.2, "half": 0.80, "bare": 0.42},
    "coconut_frond": {"slots": 3, "length": 5.0, "half": 0.95, "bare": 0.85},
}


def frond_slot(atlas, k):
    n = FRONDS[atlas]["slots"]
    return (k / n, 0.0, (k + 1) / n, 1.0)


# palm_parts: the opaque parts of both palms. A band wraps left to right on itself, so it can go round a stem once.
PARTS = {
    "crownshaft": (0.0, 0.0, 0.5, 0.5),  # the royal palm's glossy green sheath, foot at the bottom; a band
    "sheath": (0.5, 0.0, 1.0, 0.5),  # the coconut palm's fibrous frond bases, foot at the bottom; a band
    "cut": (0.0, 0.5, 0.5, 1.0),  # a palm trunk cut across by a hatchet: a disc of fibres in a ring of bark
    "nut": (0.5, 0.5, 0.75, 0.75),  # coconut husk in three bands, green, yellow and brown, each round a nut
    "root": (0.75, 0.5, 1.0, 0.75),  # a palm's thin roots, along them; a band
    "stalk": (0.5, 0.75, 1.0, 1.0),  # flower and fruit stalks, along them; a band
}

# Metres one picture of a tiling bark spans, along the trunk.
SPANS = {"royal_bark": 2.0, "coconut_bark": 1.6, "oak_bark": 2.0, "fig_bark": 2.0, "mangrove_bark": 2.0}

# A leaf atlas, 2048 pixels square. Its top left quarter is four cells of 512 pixels, each a cluster of leaves on its
# twig seen from above, the twig entering at the middle of the cell's bottom edge; `cluster` is the metres a cell spans.
# Its top right quarter is two strips of 512 by 1024 pixels, what the kind hangs or grows on its limbs. Its bottom half
# is the crown's mass: leaves over leaves as the outside of a crown shows them, no sky through it, `mass` metres across.
LEAVES = {
    "oak_leaves": {"cluster": 0.9, "mass": 4.8},
    "fig_leaves": {"cluster": 1.2, "mass": 6.4},
    "mangrove_leaves": {"cluster": 0.8, "mass": 4.0},
}
CLUSTERS = (0, 1, 2, 3)
MASS = (0.0, 0.5, 1.0, 1.0)


def leaf_cell(k):
    """Cluster cell k: 0 and 1 across the top row of the top left quarter, 2 and 3 across its second row."""
    i, j = k % 2, k // 2
    return (i / 4, j / 4, (i + 1) / 4, (j + 1) / 4)


# The strips. The oak's: a beard of Spanish moss hanging from the top edge, 0.6 m wide and 1.2 m long; a tuft of fern
# standing on the bottom edge, 0.5 m wide and 1 m tall. The fig's: two curtains of thin aerial roots hanging from the
# top edge, 1 m wide and 2 m long, one dense and one sparse. The mangrove's: two sprays of leaves at a twig's end seen
# from above, the twig entering at the middle of the bottom edge, 0.45 m wide and 0.9 m long.
STRIPS = ((0.5, 0.0, 0.75, 0.5), (0.75, 0.0, 1.0, 0.5))
OAK_MOSS, OAK_FERN = STRIPS
MOSS_SIZE = (0.6, 1.2)
FERN_SIZE = (0.5, 1.0)
FIG_ROOTS = STRIPS
ROOTS_SIZE = (1.0, 2.0)
SPRAYS = STRIPS
SPRAY_SIZE = (0.45, 0.9)

# ruins: what the figs and the banyan have swallowed, each laid once, not repeated. A column's four faces each wear
# the column strip, top row at its top; a pole and a post go round once, top row at their tops; the sign's blade wears
# its front on the left half of its region and its back on the right; the car's body goes round it from the middle of
# its underside (u0) by its right side, its roof and its left side, front (v0) to back (v1).
RUINS = {
    "column": (0.0, 0.0, 0.25, 1.0),  # a square portico column 0.45 m wide, 4.5 m tall, its capital the top 0.6 m
    "pole": (0.25, 0.0, 0.5, 1.0),  # a round concrete utility pole 0.3 m across, 6 m tall
    "post": (0.5, 0.0, 0.625, 1.0),  # a rusted steel sign post 0.08 m across, 3.5 m tall
    "sign": (0.625, 0.0, 1.0, 0.375),  # a rusted street sign blade 0.75 m by 0.45 m, front and back
    "car": (0.625, 0.375, 1.0, 1.0),  # a small rusted car's body, 5 m round and 4 m long
}
RUIN_SIZE = {"column": (0.45, 4.5), "pole": (0.94, 6.0), "post": (0.25, 3.5), "sign": (0.75, 0.45), "car": (5.0, 4.0)}

# The hacked tops of the broadleaf stumps: one disc each in a picture of four quarters, as palm_parts' cut is laid.
CUTS = {"fig": (0.0, 0.0, 0.5, 0.5), "oak": (0.5, 0.0, 1.0, 0.5), "mangrove": (0.0, 0.5, 0.5, 1.0), "banyan": (0.5, 0.5, 1.0, 1.0)}

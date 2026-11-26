"""Metre scales and colours for the shared swatches and instrument details."""

COLORS = {
    "wood": (98, 62, 38),
    "hide": (132, 82, 43),
    "flax": (184, 148, 96),
    "stone": (91, 88, 85),
    "bronze": (156, 112, 54),
    "iron": (62, 66, 67),
    "rubber": (38, 40, 37),
    "amber": (211, 151, 46),
    "spy_lens": (47, 116, 106),
    "hand_lens": (97, 163, 148),
    "dial": (190, 169, 118),
    "receiver": (72, 79, 66),
    "navigator": (141, 179, 155),
    "north": (172, 65, 48),
    "route": (45, 77, 68),
}

# These metre repeats match the material entries in asset.ts.
TILES = {
    "wood": (256, 0.12),
    "hide": (256, 0.12),
    "bronze": (256, 0.14),
    "iron": (128, 0.10),
    "rubber": (128, 0.085),
    "amber": (128, 0.10),
}

DETAIL_SIZE = 512
DETAIL_CELLS = 4

# A cell gives its column, row from the bottom, metre span, and finish.
DETAILS = {
    "dial": (0, 0, 0.120, "dial"),
    "navigator": (1, 0, 0.112, "navigator"),
    "receiver": (2, 0, 0.132, "receiver"),
    "stamp": (3, 0, 0.232, "stone"),
    "spy_lens": (0, 1, 0.108, "spy_lens"),
    "hand_lens": (1, 1, 0.134, "hand_lens"),
    "objective_rim": (2, 1, 0.146, "bronze"),
    "eyecup": (3, 1, 0.080, "rubber"),
    "flax": (0, 2, 0.076, "flax"),
    "stone": (1, 2, 0.216, "stone"),
    "talk_button": (2, 2, 0.066, "amber"),
    "dark_screw": (3, 2, 0.060, "iron"),
}

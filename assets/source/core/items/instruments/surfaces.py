"""Instrument atlas cells, their metric chart widths and distant colours."""

SIZE = 1024

# Columns count from the left, rows count from the bottom, and spans are in metres.
ATLASES = {
    "workshop": (2, 0.48, {
        "wood": (0, 0, (98, 62, 38)),
        "hide": (1, 0, (132, 82, 43)),
        "flax": (0, 1, (184, 148, 96)),
        "stone": (1, 1, (91, 88, 85)),
    }),
    "hardware": (2, 0.48, {
        "bronze": (0, 0, (156, 112, 54)),
        "iron": (1, 0, (62, 66, 67)),
        "rubber": (0, 1, (38, 40, 37)),
        "amber": (1, 1, (211, 151, 46)),
    }),
    "optics": (3, 0.22, {
        "spy_lens": (0, 0, (47, 116, 106)),
        "hand_lens": (1, 0, (97, 163, 148)),
        "dial": (2, 0, (190, 169, 118)),
        "receiver": (0, 1, (72, 79, 66)),
        "navigator": (1, 1, (141, 179, 155)),
        "stamp": (2, 1, (91, 88, 85)),
        "north": (0, 2, (172, 65, 48)),
        "route": (1, 2, (45, 77, 68)),
        "glint": (2, 2, (163, 210, 192)),
    }),
}

SURFACES = {
    key: (atlas, cells, span, column, row, rgb)
    for atlas, (cells, span, finishes) in ATLASES.items()
    for key, (column, row, rgb) in finishes.items()
}

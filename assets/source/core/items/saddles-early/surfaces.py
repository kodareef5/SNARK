"""Atlas cells and their colours, in sRGB."""

SIZE = 2048
SPAN = 3.45

# Cells are arranged left to right from the bottom row.
ATLASES = {
    "tack_hide": (2, (
        ("trail", "leather", (140, 93, 57)),
        ("russet", "leather", (130, 72, 39)),
        ("oxblood", "leather", (100, 55, 56)),
        ("chestnut", "leather", (99, 60, 38)),
    )),
    "tack_pad": (2, (
        ("trail_weave", "weave", (119, 99, 69)),
        ("olive", "weave", (77, 91, 72)),
        ("rawhide", "suede", (135, 99, 58)),
        ("flax", "cord", (183, 152, 101)),
    )),
    "tack_fittings": (3, (
        ("wood", "wood", (143, 100, 53)),
        ("dark_wood", "wood", (84, 59, 39)),
        ("iron", "iron", (94, 99, 97)),
        ("brass", "brass", (150, 113, 60)),
        ("chitin", "chitin", (205, 184, 139)),
        ("cord", "cord", (190, 165, 119)),
    )),
}

SURFACES = {
    name: (atlas, columns, index % columns, index // columns)
    for atlas, (columns, finishes) in ATLASES.items()
    for index, (name, _, _) in enumerate(finishes)
}

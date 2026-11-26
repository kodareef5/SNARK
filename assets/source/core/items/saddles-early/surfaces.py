"""Repeating swatches, their width in metres, and their colours in sRGB."""

from typing import NamedTuple


class Swatch(NamedTuple):
    grain: str
    color: tuple[int, int, int]
    size: int
    span: float
    sewn: bool = False


SWATCHES = {
    "trail": Swatch("leather", (128, 83, 52), 128, 0.22, True),
    "russet": Swatch("leather", (128, 72, 40), 128, 0.22, True),
    "oxblood": Swatch("leather", (100, 55, 56), 128, 0.22, True),
    "chestnut": Swatch("leather", (99, 60, 38), 128, 0.22, True),
    "trail_weave": Swatch("weave", (119, 99, 69), 256, 0.36, True),
    "olive": Swatch("weave", (77, 91, 72), 256, 0.36, True),
    "rawhide": Swatch("suede", (135, 99, 58), 256, 0.36, True),
    "wood": Swatch("wood", (149, 108, 62), 128, 0.16),
    "dark_wood": Swatch("wood", (84, 59, 39), 128, 0.16),
    "iron": Swatch("iron", (94, 99, 97), 128, 0.16),
    "brass": Swatch("brass", (150, 113, 60), 128, 0.16),
    "chitin": Swatch("chitin", (202, 181, 136), 128, 0.16),
}

SEAM_START = 0.014
SEAM_LINE = 0.032
SEAM_MARGIN = 0.027
CLEAN_START = 0.052
CLEAN_GUTTER = 0.008

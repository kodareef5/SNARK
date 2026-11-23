"""The air freight machines' shared swatch atlases. Rectangles count sixteenths of the picture from its upper left.

`hull` is every surface that only reflects light; `lamp` is every lens that glows. Both model.py (in Blender) and
paint.py (outside it) read this file, so the layout and the pictures cannot drift apart.
"""

HULL_SIDE = 2048
LAMP_SIDE = 256
GRID = 16

HULL = {
    # Large composite and metal surfaces.
    "panel": (0, 0, 4, 4),
    "panel_b": (4, 0, 4, 4),
    "panel_d": (8, 0, 4, 4),
    "steel": (12, 0, 4, 4),
    "carbon": (0, 4, 2, 2),
    "hex": (2, 4, 2, 2),
    "grip": (4, 4, 2, 2),
    "vent": (6, 4, 2, 2),
    "chassis": (8, 4, 2, 2),
    "rim": (10, 4, 2, 2),
    "tread": (12, 4, 2, 2),
    "mesh": (14, 4, 2, 2),
    "lens": (0, 6, 2, 2),
    "hazard": (2, 6, 4, 1),
    "amber": (2, 7, 1, 1),
    "red": (3, 7, 1, 1),
    "chrome": (4, 7, 1, 1),
    "rubber": (5, 7, 1, 1),
    "seam": (6, 6, 1, 1),
    "glass": (7, 6, 1, 1),
    "inside": (6, 7, 1, 1),
    "cable": (7, 7, 1, 1),
    "bay_1": (8, 6, 1, 1),
    "bay_2": (9, 6, 1, 1),
    "bay_3": (10, 6, 1, 1),
    "bay_4": (11, 6, 1, 1),
    "bay_5": (12, 6, 1, 1),
    "bay_6": (13, 6, 1, 1),
    "arrow": (14, 6, 1, 1),
    "brass": (15, 6, 1, 1),
    "plate": (8, 7, 2, 1),
    "tyre_wall": (10, 7, 2, 1),
    "gauge": (12, 7, 1, 1),
    "screen": (13, 7, 1, 1),
    "bolt": (14, 7, 1, 1),
    "white": (15, 7, 1, 1),
    # Stencilled words, each a strip four times as wide as it is tall.
    "text_unit": (0, 8, 4, 1),
    "text_lift": (4, 8, 4, 1),
    "text_step": (8, 8, 4, 1),
    "text_rotor": (12, 8, 4, 1),
    "text_rack": (0, 9, 4, 1),
    "text_drone": (4, 9, 4, 1),
    "text_hazard": (8, 9, 4, 1),
    "text_carrier": (12, 9, 4, 1),
    # A second, lighter composite for the drones and accents, and a battered underside.
    "panel_l": (0, 10, 4, 4),
    "panel_w": (4, 10, 4, 4),
    "blade": (8, 10, 4, 2),
    "duct": (8, 12, 4, 2),
    "panel_seamed": (12, 10, 4, 4),
    "rail": (0, 14, 4, 2),
    "frame": (4, 14, 4, 2),
    "hose": (8, 14, 2, 2),
    "dark": (10, 14, 2, 2),
    "under": (12, 14, 2, 2),
    "numbers": (14, 14, 2, 2),
}

# Lenses: each a flat glowing colour, or a bar of segments.
LAMP = {
    "lamp_amber": (0, 0, 4, 4),
    "lamp_red": (4, 0, 4, 4),
    "lamp_green": (8, 0, 4, 4),
    "lamp_white": (12, 0, 4, 4),
    "lamp_cyan": (0, 4, 4, 4),
    "lamp_dim_red": (4, 4, 4, 4),
    "lamp_dim_amber": (8, 4, 4, 4),
    "lamp_blue": (12, 4, 4, 4),
    "lamp_bar": (0, 8, 16, 4),
    "lamp_screen": (0, 12, 8, 4),
    "lamp_warm": (8, 12, 8, 4),
}


def rect(tag):
    """The tag's rectangle in pixels of its picture: left, top, width, height, and that picture's side."""
    if tag in LAMP:
        x, y, w, h = LAMP[tag]
        s = LAMP_SIDE // GRID
        return x * s, y * s, w * s, h * s, LAMP_SIDE
    x, y, w, h = HULL[tag]
    s = HULL_SIDE // GRID
    return x * s, y * s, w * s, h * s, HULL_SIDE

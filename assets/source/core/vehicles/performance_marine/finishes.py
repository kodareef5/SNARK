"""Four-by-four modular swatches shared by the original hulls and rigging."""
SWATCHES = {
    "laminate": {
        "gel": (213, 219, 217), "pearl": (232, 234, 221), "midnight": (23, 51, 67), "graphite": (50, 56, 57),
        "vermilion": (223, 82, 43), "citron": (219, 236, 65), "aqua": (27, 147, 145), "gold": (191, 149, 90),
        "aluminium": (139, 154, 146), "olive": (86, 104, 84), "vinyl": (238, 225, 198), "suede": (52, 61, 62),
        "tobacco": (166, 102, 56), "teak": (165, 126, 85), "nonskid": (126, 132, 124), "carbon": (39, 47, 49),
    },
    "hardware": {
        "chrome": (174, 185, 185), "rubber": (33, 38, 40), "steel": (91, 104, 106), "screen": (34, 64, 75),
        "gauge": (31, 39, 40), "chart": (43, 83, 89), "grip": (46, 49, 50), "intake": (35, 39, 41),
        "red": (218, 61, 46), "green": (40, 188, 131), "lamp": (231, 222, 180), "throttle": (146, 69, 49),
        "slate": (88, 105, 105), "engine": (44, 52, 59), "tread": (52, 64, 61), "bronze": (175, 144, 86),
    },
}
TILES = {tag: (name, i) for name, entries in SWATCHES.items() for i, tag in enumerate(entries)}

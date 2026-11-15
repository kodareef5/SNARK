# The colours the flat levels draw each element in: the low setting's near plants and everyone's middle distance. The
# mean of an element's picture is a poor guide (a frond's mean takes in its brown stalk and comes out olive), so each is
# chosen by eye from the game's palette (shared/pack/palette.ts), given here as the palette's own sRGB so the converter
# finds it exactly. An element not named takes the tone of the first name it starts with.

TONES = {
    "bush": {
        "spray": (68, 103, 48),
        "inner": (58, 86, 37),
        "dead": (144, 138, 128),
        "fallen": (93, 106, 57),
        "stripped": (93, 106, 57),
        "leaf1": (58, 86, 37),
        "leaf2": (93, 106, 57),
        "leaf3": (162, 162, 97),
        "bark": (127, 121, 112),
    },
    "palmetto": {
        "fan1": (149, 177, 118),
        "fan2": (103, 143, 115),
        "fan3": (118, 160, 133),
        "fan4": (120, 141, 82),
        "fan5": (90, 126, 99),
        "fan6": (177, 180, 115),
        "deadfan1": (179, 99, 65),
        "deadfan2": (160, 154, 144),
        "spear": (149, 177, 118),
        "stalk": (135, 159, 100),
        "bark": (120, 83, 50),
    },
    "fern": {
        "frond1": (99, 158, 90),
        "frond2": (78, 121, 59),
        "frond3": (87, 140, 71),
        "frond4": (107, 124, 68),
        "frond5": (87, 140, 71),
        "frond6": (99, 158, 90),
        "deadfrond1": (159, 113, 67),
        "deadfrond2": (144, 138, 128),
        "young": (113, 176, 109),
        "bark": (139, 97, 58),
    },
    "seagrape": {
        "leaf1": (87, 140, 71),
        "leaf2": (78, 121, 59),
        "leaf3": (87, 140, 71),
        "leaf4": (149, 177, 118),
        "leaf5": (78, 121, 59),
        "leaf6": (197, 116, 79),
        "leaf7": (157, 85, 58),
        "leaf8": (162, 162, 97),
        "leaf9": (87, 140, 71),
        "leaf10": (78, 121, 59),
        "fruit1": (120, 141, 82),
        "fruit2": (137, 96, 88),
        "fruit3": (80, 54, 52),
        "twig": (149, 177, 118),
        "bark": (177, 172, 161),
    },
    "creeper": {
        "rubble": (177, 172, 161),
        "run": (87, 140, 71),
        "hang": (99, 158, 90),
        "ground": (87, 140, 71),
        "mat": (68, 103, 48),
    },
}


def tone(atlas, name, shade=1.0):
    """The flat colour of an element, as kit.hexname takes it: red, green and blue of 1. `shade` darkens it a little,
    for the inside of a plant; the converter then takes the palette colour nearest."""
    table = TONES[atlas]
    best = ""
    for key in table:
        if name.startswith(key) and len(key) > len(best):
            best = key
    rgb = table[best] if best else next(iter(table.values()))
    return [c / 255 * shade for c in rgb]

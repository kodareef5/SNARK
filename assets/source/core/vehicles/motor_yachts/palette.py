"""Where each of the yachts' finishes is drawn. The decks' laid teak is a metre-mapped sheet every yacht shares (paint.py
paints it); every other face is on the yacht's own pictures: the hull's, and above the main deck the house's, with its
furniture and fittings. A level is drawn with three materials at most."""
HULL = ["topsides", "strake", "boot", "keel"]
# The helm's displays and keys, read from the pilot's seat.
SCREENS = ["chart", "instruments", "keyboard"]
# The side of each yacht's own pictures.
OWN = {"solstice": {"hull": 2048}, "meridian": {"hull": 2048, "house": 2048},
       "belvedere": {"hull": 2048, "house": 4096}, "sovereign": {"hull": 2048, "house": 4096}}
# Metres above the keel where the house's picture begins, just above the main deck.
HOUSE = {"meridian": 1.8, "belvedere": 2.75, "sovereign": 3.15}


def own(name, tag, y):
    """The yacht's own picture a face of `tag` at height `y` is drawn on, or None for the teak."""
    if tag == "teak":
        return None
    # The inner faces of the panes are cut out of the last picture.
    if tag == "clear":
        return list(OWN[name])[-1]
    if tag in HULL or len(OWN[name]) == 1 or y < HOUSE[name]:
        return "hull"
    return "house"

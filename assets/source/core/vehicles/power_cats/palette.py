"""Where each of the catamarans' finishes is drawn. The decks' laid teak is a metre-mapped sheet both boats share
(paint.py paints it); every other face is on the boat's own pictures: the hulls' and the bridge deck's, and on the
larger above the bridge deck the house's, with its furniture and fittings. A level is drawn with three materials at most."""
HULL = ["shell", "stripe", "under"]
# The helm's displays, read from the pilot's seat.
SCREENS = ["chart", "sonar"]
# The side of each boat's own pictures.
OWN = {"manta": {"hull": 2048}, "lagoon": {"hull": 2048, "house": 4096}}
# Metres above the keel where the house's picture begins.
HOUSE = 2.3


def own(name, tag, y):
    """The boat's own picture a face of `tag` at height `y` is drawn on, or None for the teak."""
    if tag == "teak":
        return None
    if tag in HULL or len(OWN[name]) == 1 or y < HOUSE:
        return "hull"
    return "house"

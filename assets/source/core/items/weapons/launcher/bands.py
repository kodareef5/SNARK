# The launcher's two pictures as bands across them, shared by tex.py, which paints them, and model.py, which lays faces
# in them. Each picture is a trim sheet 512 pixels square that repeats along u: one picture spans TILE metres, so a
# face at its natural size has 1,024 pixels a metre. A band is rows of one finish. Inside its PAD rows at either edge
# its paint repeats up the picture too, so a band wrapped once round a tube meets itself without a seam.

SIDE = 512
PAD = 4
TILE = 0.5

# Rows from the top of each picture, in order.
METAL = [
    ("paint", 272),  # olive drab over steel: the tube
    ("warhead", 96),  # bronze green: the round's warhead
    ("dark", 64),  # phosphated steel: collar, sight, housing, the round's motor
    ("bare", 32),  # worn bright steel: rims, chamfers, the fuze
    ("yellow", 16),  # marking paint: the warhead's ring
    ("hazard", 16),  # yellow and black chevrons round the vent
    ("soot", 16),  # the bore, the vent's throat, the nozzle
]
FURNITURE = [
    ("wrap", 224),  # glass tape wound round the tube
    ("polymer", 160),  # stippled black: the grips
    ("rubber", 96),  # ribbed: the shoulder pad, the eyecup
    ("glass", 32),  # the sight's lenses
]
# Pixels along u of one hazard chevron and the next, and of one turn of the tape.
CHEVRON = 32
TURN = 32


def rows(sheet, name):
    """A band's first row and the row after its last, pads and all."""
    top = 0
    for band, tall in sheet:
        if band == name:
            return top, top + tall
        top += tall
    raise KeyError(name)


def span(sheet, name):
    """A band's paint between its pads, as v from its bottom to its top (0 at the picture's foot)."""
    top, bottom = rows(sheet, name)
    return 1 - (bottom - PAD) / SIDE, 1 - (top + PAD) / SIDE

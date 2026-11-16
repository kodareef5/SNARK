"""Original utility boat sections in engine metres, +Y up and +Z forward. Shared with the measured fit evidence."""
import math

BONES = [("chassis", (0, 0, 0)), ("outboard", (0, .98, -3.48)),
         ("propeller", (0, .08, -3.90)), ("steering", (.48, 1.64, .67)), ("throttle", (.98, 1.38, .53))]
PARENTS = [-1, 0, 1, 0, 0]
# z, half beam, keel, chine, sheer, deck. Full beam in the occupied area; the rising bow is a working foredeck.
HULL = [(-3.40, 1.16, .08, .35, 1.36, .73), (-2.90, 1.26, .02, .30, 1.36, .73),
        (-2.25, 1.30, 0, .28, 1.36, .73), (-1.00, 1.30, 0, .28, 1.36, .73),
        (.60, 1.30, .02, .30, 1.38, .73), (1.55, 1.27, .08, .38, 1.42, .73),
        (2.10, 1.13, .16, .51, 1.46, .83), (2.60, .86, .32, .71, 1.50, .99),
        (3.02, .49, .58, .94, 1.53, 1.18), (3.40, .035, 1.02, 1.22, 1.55, 1.39)]


def sample(z):
    for a, b in zip(HULL, HULL[1:]):
        if a[0] <= z <= b[0]:
            t = (z-a[0])/(b[0]-a[0])
            return [a[k]+t*(b[k]-a[k]) for k in range(1, len(a))]
    return list((HULL[0] if z < HULL[0][0] else HULL[-1])[1:])


def stations(a, b, step=.15):
    n=max(1, math.ceil(abs(b-a)/step))
    return [a+(b-a)*i/n for i in range(n+1)]


def interior(z):
    w, keel, chine, sheer, deck=sample(z)
    inner=max(.012,w-.09)
    deck_width=max(.006,(.73+.27*max(0,min(1,(deck-chine)/(sheer-.17-chine))))*w-.09)
    return [(inner,3.2,z),(inner,sheer,z),(deck_width,deck,z),
            (-deck_width,deck,z),(-inner,sheer,z),(-inner,3.2,z)]


def section(z):
    w, keel, chine, sheer, deck=sample(z)
    inner=max(.012,w-.09)
    # Semantic UV borders retain the painted waterline/stripe through native surface simplification.
    span=sheer-.17-chine
    centre=.91+.045*max(0,min(3,z))
    water=max(.05,min(.55,(.50-chine)/span))
    lower=max(water+.05,min(.75,(centre-.115-chine)/span))
    upper=max(lower+.05,min(.95,(centre+.115-chine)/span))
    bounds=[0,water,lower,upper,1]
    ts=[bounds[k]+(bounds[k+1]-bounds[k])*i/4 for k in range(4) for i in range(4)]+[1]
    side=[((.73+.27*t)*w,chine+span*t,z) for t in ts]
    floor=interior(z)[2][0]
    return [(0,keel,z)]+side+[(w,sheer,z),(inner,sheer,z),(floor,deck,z),
                            (-floor,deck,z),(-inner,sheer,z),(-w,sheer,z)]+[(-x,y,z) for x,y,z in reversed(side)]


SECTION_TAGS=["paint"]*41
SECTION_TAGS[19]="panel"
SECTION_TAGS[20]="carpet"
SECTION_TAGS[21]="panel"
for i in [1,2,3,4,36,37,38,39]:SECTION_TAGS[i]="paint_lower"
for i in [9,10,11,12,28,29,30,31]:SECTION_TAGS[i]="paint_band"

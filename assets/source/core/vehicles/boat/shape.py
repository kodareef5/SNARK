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


def section(z):
    w, keel, chine, sheer, deck=sample(z)
    inner=max(.012,w-.09)
    # Narrow longitudinal strips give the flat LODs enough colour samples to retain the painted waterline/stripe.
    side=[((.73+.27*i/16)*w,chine+(sheer-.17-chine)*i/16,z) for i in range(17)]
    return [(0,keel,z)]+side+[(w,sheer,z),(inner,sheer,z),(inner,deck,z),
                            (-inner,deck,z),(-inner,sheer,z),(-w,sheer,z)]+[(-x,y,z) for x,y,z in reversed(side)]


SECTION_TAGS=["paint"]*41
SECTION_TAGS[19]="panel"
SECTION_TAGS[20]="carpet"
SECTION_TAGS[21]="panel"

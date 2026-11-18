"""Paint the fastback's four wear maps. Run python3 -B tex/wear.py.

Coordinates in the drawing routines are source pixels, with rain falling in +y.
Time is measured in stages of the individual layer; RGB is undyed sRGB.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.spatial import cKDTree

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from finish import FINISH


def unit(a):
    return np.clip(a, 0., 1.)


def mix(a, b, t):
    a, b = np.asarray(a, np.float32), np.asarray(b, np.float32)
    return a + (b - a) * unit(t)[..., None]


def cloud(rng, n, pitch_y, pitch_x=None):
    """Sample a continuous pigment field. Independent scales give chips a broken edge."""
    pitch_x = pitch_y if pitch_x is None else pitch_x
    y, x = np.indices((n, n), dtype=np.float32)
    knots = rng.random((int(n / pitch_y) + 5, int(n / pitch_x) + 5), dtype=np.float32)
    return unit(ndimage.map_coordinates(knots, [y / pitch_y + 1, x / pitch_x + 1], order=3))


class Surface:
    def __init__(self, n, seed):
        self.rng = np.random.default_rng(seed)
        self.y, self.x = np.indices((n, n), dtype=np.float32) + .5
        self.cloud = cloud(self.rng, n, 39 if n == 512 else 25)
        self.scale = cloud(self.rng, n, 9)
        self.flake = cloud(self.rng, n, 3.2)
        self.grit = self.rng.random((n, n), dtype=np.float32)
        self.grain = .41 * self.scale + .35 * self.flake + .24 * self.grit
        self.hurt = np.zeros((n, n, 4), np.uint8)
        self.decay = np.zeros_like(self.hurt)

    def separate(self):
        self.decay[self.hurt[..., 3] != 0] = 0


def mark(layer, mask, onset, pigment):
    alpha = np.rint(255 * unit(1 - onset / 3)).astype(np.uint8)
    keep = mask & (alpha > layer[..., 3])
    layer[..., 3][keep] = np.broadcast_to(alpha, keep.shape)[keep]
    pigment = np.asarray(pigment)
    layer[..., :3][keep] = pigment[keep] if pigment.ndim == 3 else pigment


def path_coords(x, y, points):
    """Arc length and signed distance to a folded strip of sheet or hide."""
    points = np.asarray(points, np.float32)
    # Clip the corners of the polyline once. A pinched fold still has an elbow.
    a, b = points[:-1], points[1:]
    points = np.vstack([points[0], np.stack([.83*a + .17*b, .17*a + .83*b], axis=1).reshape(-1, 2), points[-1]])
    best = np.full(x.shape, np.inf, np.float32)
    along = np.zeros_like(x)
    cross = np.zeros_like(x)
    length = 0.
    for (px, py), (dx, dy) in zip(points, np.diff(points, axis=0)):
        step = np.hypot(dx, dy)
        t = unit(((x - px) * dx + (y - py) * dy) / step**2)
        d2 = (x - px - t*dx)**2 + (y - py - t*dy)**2
        closer = d2 < best
        along = np.where(closer, length + t*step, along)
        cross = np.where(closer, np.copysign(np.sqrt(d2), (y-py)*dx - (x-px)*dy), cross)
        best = np.minimum(best, d2)
        length += step
    return along / length, cross


def fold(s, points, width, onset, crush):
    """A tapered trough, a shoulder catching light, and chips at the pinch."""
    pts = np.array(points)
    left, top = np.maximum(0, pts.min(axis=0).astype(int) - 24)
    right, bottom = pts.max(axis=0).astype(int) + 25
    box = np.s_[top:bottom, left:right]
    t, d = path_coords(s.x[box], s.y[box], pts)
    grain, scale, flake = s.grain[box], s.scale[box], s.flake[box]
    taper = np.maximum(0, np.sin(t * np.pi))**.65
    d += .68 * (flake - .5)
    w = width * (.29 + .71 * taper)
    inside = (t > 0) & (t < 1)
    time = .10 + 1.26*onset + .75*(1-taper) + .34*(1-grain)
    # The bank darkens into the fold. Only the short stripped places go silver.
    shadow = mix((26, 29, 32), (91, 87, 81), .46 * grain + .48 * unit(d / w))
    mark(s.hurt[box], inside & (d > -.24*w) & (d < w), time, shadow)
    lip = (d < -.24*w) & (d > -.24*w - (1.05 + .80 * crush)*taper)
    mark(s.hurt[box], inside & lip & (scale + .5 * flake > .33),
         time + .07, mix((94, 103, 104), (192, 191, 171), .49 * scale + .51 * grain))

    # A short, milled contact patch at one shoulder. Longitudinal slivers of
    # steel sit within a chipped primer edge; the rest of the slope is dye.
    pinch = s.rng.uniform(.30, .71)
    belly = unit(1 - ((t - pinch) / (.20 + .14 * crush))**2)
    reach = (1.7 + 4.7 * crush**3) * belly
    dist = np.abs(d + .36*reach + 1.1)
    edge = dist / np.maximum(.1, reach) + 1.25*(.54-scale) + .84*(.49-flake)
    patch = inside & (belly > .05) & (edge < .84) & (grain > .47 + .10*unit(edge))
    primer = mix((74, 70, 65), (155, 149, 133), .65 * grain + .24 * scale)
    primer = mix(primer, (177, 181, 172), .71 * (dist < 1.05) * (flake > .58))
    mark(s.hurt[box], patch, time + .32 + .54*unit(edge), primer)


# The roof, front luggage lid and tail occupy successive strips from top to
# bottom. The door waist crosses the roof strip, and the wheel lips and sill
# cross the two lids. Space the points as pressings with folds of unequal span.
FOLDS = [
    # Front wings, return of the nose and the bonnet between them.
    ([(17,54),(37,65),(56,68),(76,95)], 3.6, .09, 1.0),
    ([(22,85),(48,82),(68,92)], 2.8, .84, .59),
    ([(60,29),(89,42),(108,45),(146,76)], 3.2, .25, .92),
    ([(96,22),(113,32),(144,38),(163,50)], 2.4, 1.22, .73),
    ([(152,22),(170,36),(188,41),(207,68),(240,87)], 3.2, .15, .81),
    ([(193,30),(207,48),(223,52)], 2., 1.37, .51),
    ([(265,49),(299,44),(325,29)], 2.9, .54, .61),
    ([(322,74),(352,59),(373,58),(391,38)], 3.8, .09, .94),
    ([(345,89),(370,72),(388,71)], 2.1, 1.14, .63),
    ([(408,59),(435,69),(449,95),(481,116)], 3.3, .39, .92),
    ([(43,130),(62,142),(96,148)], 2.4, 1.08, .54),
    ([(144,111),(164,118),(192,147)], 2.5, .79, .63),
    ([(296,137),(315,135),(348,111)], 2.2, 1.34, .49),
    # Shoulder and roof buckle. Diagonals change direction near the cantrail.
    ([(30,190),(56,199),(85,198)], 2.4, .64, .60),
    ([(116,189),(145,203),(160,224)], 2.6, 1.28, .58),
    ([(201,176),(218,173),(237,184)], 1.9, 1.53, .38),
    ([(368,191),(393,170),(418,165)], 2.8, .55, .69),
    ([(443,222),(454,200),(479,183)], 2., 1.12, .6),
    ([(81,259),(103,243),(127,238),(159,216)], 3.4, .18, .85),
    ([(117,281),(144,257),(156,255)], 2.3, 1.10, .59),
    ([(164,304),(193,287),(214,283),(239,259)], 3.6, .12, .82),
    ([(199,307),(219,297),(235,278)], 2.2, .99, .65),
    ([(272,240),(297,248),(318,265),(348,267)], 3.1, .29, .78),
    ([(307,237),(329,252),(343,254)], 2.0, 1.49, .53),
    ([(350,300),(379,286),(389,270),(418,251)], 3.4, .12, .93),
    ([(416,280),(426,269),(451,261),(468,245)], 2.4, 1.22, .76),
    # Skips in a sideswipe interleaved with shorter folds of the bumper skin.
    ([(16,347),(43,333),(66,334),(91,317)], 3.5, .19, 1.0),
    ([(49,352),(67,344),(82,345)], 2.4, .93, .81),
    ([(91,321),(123,310),(133,291)], 2.7, .71, .72),
    ([(121,337),(151,347),(178,346),(201,355)], 3.4, .20, .90),
    ([(177,366),(202,362),(222,364),(251,356)], 2.6, .84, .61),
    ([(248,341),(265,345),(292,340),(323,341)], 3.7, .10, .91),
    ([(296,349),(314,352),(340,345)], 2.4, 1.05, .67),
    ([(340,323),(359,331),(389,332),(409,342)], 3., .50, .63),
    ([(428,337),(448,317),(476,312),(497,293)], 3.3, .16, 1.0),
    ([(449,345),(458,331),(478,325)], 2.8, 1.14, .69),
    ([(22,394),(52,380),(73,377)], 3., .57, .71),
    ([(90,412),(118,396),(141,398),(168,382)], 3.1, .26, .87),
    ([(159,405),(194,403),(214,393)], 2.3, 1.21, .71),
    ([(239,405),(267,396),(294,394),(314,379)], 3.3, .19, .93),
    ([(316,407),(342,413),(380,408)], 2.5, .60, .64),
    ([(387,378),(409,371),(425,354)], 2.6, .72, .76),
    ([(434,412),(453,395),(480,388),(496,375)], 3.7, .11, 1.0),
    # Sill and tail. Several folds of a compressed corner, staggered in time.
    ([(24,443),(47,432),(81,430)], 2.7, .42, .8),
    ([(61,465),(91,455),(105,436),(130,423)], 3.6, .09, .94),
    ([(94,474),(116,455),(135,448)], 2.4, 1.05, .74),
    ([(138,477),(165,463),(184,462),(203,445)], 3.3, .43, .84),
    ([(202,483),(229,476),(244,461)], 2.8, .89, .70),
    ([(263,441),(280,449),(305,452),(321,467)], 3.5, .21, .9),
    ([(291,432),(307,442),(325,445)], 2.5, 1.09, .68),
    ([(347,482),(372,468),(391,466),(416,444)], 3.2, .17, .95),
    ([(419,465),(440,453),(456,433)], 2.7, .78, .78),
    ([(450,483),(474,479),(495,462)], 2.9, .59, .77),
]


def drag(s, x0, y0, length, slope, breadth, onset):
    """Road contact leaves skips, parallel scoring and flakes of primer."""
    x = s.x - x0
    along = x / length
    d = s.y - y0 - slope*x - 2.3*np.sin(5.1*along) - 1.2*(s.scale-.5)
    profile = unit(1 - (2*along - 1)**2)
    band = np.abs(d) / np.maximum(.2, breadth * profile**.7)
    comb = cloud(s.rng, len(x), 1.9, 18)
    bite = .52*comb + .23*s.scale + .17*s.flake + .08*s.grit
    hit = (profile > 0) & (band < 1) & (bite > .45 + .20*band)
    primer = mix((62, 57, 55), (144, 134, 116), .53*comb + .47*s.grain)
    primer = mix(primer, (193, 193, 179), unit((comb-.63)*3.1) * (band < .65))
    mark(s.hurt, hit, .12 + onset + .61*band + .65*(1-bite) + .76*(1-profile), primer)


def rubbed_contact(s, x, y, length, angle, width, onset):
    """A struck corner takes a print of the other bumper, broken by fine scoring."""
    rad = np.deg2rad(angle)
    dx, dy = s.x-x, s.y-y
    u = (dx*np.cos(rad) + dy*np.sin(rad)) / length
    v = -dx*np.sin(rad) + dy*np.cos(rad) - 2.8*np.sin(2.1*u)
    belly = unit(1 - (u + .13)**2)
    across = np.abs(v) / np.maximum(.1, width*belly)
    pressure = .47*s.scale + .33*s.flake + .20*s.grit
    contact = (belly > 0) & (across < .88) & (pressure > .45 + .21*across)
    # Charcoal transfer sits either side of the skip. At peak pressure the
    # rubber has wiped off; two very short cold lines show the hard substrate.
    rubber = mix((41, 40, 39), (98, 92, 83), pressure)
    rake = np.cos(v*1.74 + 2.2*u + .6*s.scale)
    metal = (rake > .48) & (np.abs(u-.29) < .28) & (s.grain > .57)
    mark(s.hurt, contact, onset+.42*np.abs(u)+.56*across+.46*(1-pressure),
         mix(rubber, (159, 162, 150), metal*(.64+.30*s.flake)))


def road_chips(s):
    # Sparse stone strikes with a small undercut on the downstream lip.
    for i in range(83):
        x0 = s.rng.uniform(8, 504)
        y0 = 8 + 496*s.rng.random()**(.68 if i % 3 else 1.21)
        angle = s.rng.uniform(-1.4, 1.4)
        start = s.rng.uniform(.13, 2.32)
        for j in range(s.rng.integers(1, 7)):
            x, y = np.clip([x0, y0] + s.rng.normal(0, 3.7*j, 2), 7, 505)
            box = np.s_[int(y)-6:int(y)+7, int(x)-6:int(x)+7]
            dx, dy = s.x[box]-x, s.y[box]-y
            p = (dx*np.cos(angle) + dy*np.sin(angle)) / s.rng.uniform(1.1, 4.8)
            q = (-dx*np.sin(angle) + dy*np.cos(angle)) / s.rng.uniform(.7, 2.15)
            r = .68*np.abs(q) + .75*np.abs(p+.27*q)
            keep = r < .44+.71*s.flake[box]+.36*s.grit[box]
            pigment = mix((57, 55, 53), (160, 157, 140), .45*(q < -.16) + .55*s.grain[box])
            mark(s.hurt[box], keep, start + .34*r + .08*j, pigment)


def enamel():
    s = Surface(512, 904672)
    for args in FOLDS:
        fold(s, *args)
    # The late compression closes a few corners into pleats. Vary the angles
    # and put short transverse pinches inside the longer, first-hit folds.
    for ridge in [
        [(43,94),(54,85),(58,73)], [(71,81),(65,65),(72,50),(65,38)],
        [(136,63),(146,63),(159,70)], [(374,68),(390,66),(402,58)],
        [(445,90),(455,83),(461,70)], [(100,239),(111,244),(121,261)],
        [(182,267),(196,278),(213,282)], [(337,275),(353,278),(373,268)],
        [(38,329),(41,316),(54,302)], [(81,355),(73,366),(76,376)],
        [(265,354),(285,363),(294,375)], [(452,379),(466,380),(476,388)],
        [(87,441),(93,450),(92,464)], [(114,471),(134,461),(150,462)],
        [(291,458),(296,470),(306,481)], [(394,439),(402,445),(419,446)],
    ]:
        fold(s, ridge, s.rng.uniform(2.1, 3.6), s.rng.uniform(1.31, 1.61), .46)
    for args in [
        (61, 52, 83, .41, 5.6, .17), (174, 40, 55, .46, 4.1, .76),
        (335, 69, 55, -.48, 6.4, .23), (412, 91, 59, .63, 4.4, .65),
        (168, 125, 49, .60, 4.2, 1.4), (339, 157, 57, -.32, 3.9, 1.05),
        (108, 285, 91, -.48, 6.6, .24), (259, 248, 67, .27, 4.1, .61),
        (314, 278, 85, -.38, 5.8, .16), (27, 338, 79, -.30, 6.4, .20),
        (101, 337, 88, .17, 6.5, .39), (188, 350, 104, -.06, 5.5, .12),
        (291, 344, 80, -.11, 4.4, .54), (392, 338, 91, -.28, 5.7, .42),
        (52, 400, 68, -.26, 3.2, 1.17), (175, 399, 95, -.05, 5.7, .67),
        (313, 410, 69, -.08, 4.3, .79), (419, 408, 67, -.32, 7.2, .23),
        (65, 463, 83, -.48, 6.5, .21), (206, 467, 53, -.29, 3.9, .72),
        (284, 450, 60, .30, 4.4, .51), (368, 475, 62, -.41, 5.5, .34),
    ]:
        drag(s, *args)
    for args in [
        (68,58,24,40,7,.34), (365,62,21,-26,6,.54),
        (120,246,36,-50,6,.37), (324,259,28,58,7,.28),
        (64,328,27,-19,9,.66), (221,353,34,-8,4,.46),
        (422,362,22,-53,8,1.15), (75,456,21,-29,7,.42),
        (319,452,20,17,6,.86),
    ]:
        rubbed_contact(s, *args)
    road_chips(s)
    weather_enamel(s)
    s.separate()
    return s.hurt, s.decay


def weather_enamel(s):
    # Inverse of model.mapped for the vertical faces. Both side projections
    # cross these low edges. Distances are in metres in their respective planes.
    u, v = (s.x/512 - .02)/.96, (1 - s.y/512 - .02)/.96
    z, h = (u - .5)*4, v*1.5
    az = np.abs(z)
    arch = np.abs(np.hypot(az-1.25, h-.30) - .364)
    arch = np.where(h > .22, arch, 1.)
    door = np.abs(az - np.interp(h, [.26,.32,.42,.80], [.51,.60,.67,.69]))
    door = np.where((h > .27) & (h < .82), door, 1.)
    sill = np.where(az < .91, np.minimum(np.abs(h-.203), np.abs(h-.27)), np.abs(h-.23))
    # Top projection of the curved bonnet reveal, deck lip and engine grille.
    wide, nose = np.abs(2*u-1)*.91, (v-.5)*4
    hood_side = np.interp(nose, [.795,1.12,1.37,1.62,1.77,1.834,1.857],
                          [.44,.425,.399,.351,.31,.276,.219])
    bonnet = np.where((nose>.795) & (nose<1.857), np.abs(wide-hood_side), 1.)
    bonnet = np.minimum(bonnet, np.where(wide < .27, np.abs(nose-1.871+.015*(wide/.27)**2), 1.))
    deck = np.where(wide < .70, np.abs(nose+1.89-.072*(wide/.718)**2), 1.)
    grille = np.abs(np.maximum(wide-.50, np.abs(nose+1.687)-.131))
    corners = np.minimum.reduce([arch, door, sill, bonnet, deck, grille])
    shore = .43*s.cloud + .28*s.scale + .19*s.flake + .10*s.grit
    reach = .011 + .065*unit((s.cloud-.22)/.64)**1.5
    edge = corners / reach
    # Exposed cuts bloom into nearby enamel, with intermittent creeks of
    # brown oxide. Intact areas separate colonies even on an unbroken seam.
    exposed = (s.hurt[...,3] > 0) & (s.hurt[...,0] > 89) & (s.scale + .45*s.cloud > .70)
    distance = ndimage.distance_transform_edt(~exposed)
    wound = distance / (1.2 + 7.4*unit((s.cloud-.37)*1.89)**1.4)
    edge = np.minimum(edge, wound + .14)
    rust = mix((63, 43, 37), (148, 77, 47), unit(.13 + .56*s.scale + .68*s.flake - .21*s.cloud))
    rust = mix(rust, (181, 119, 69), unit((s.grain-.50)*2.5) * unit(.35+.65*edge))
    mask = (edge < 1.12) & (shore > .416 + .19*edge - .07*s.flake)
    mark(s.decay, mask, .42 + 1.25*edge + 3.7*(.66-shore) + .38*(1-s.flake), rust)

    # Water only travels down from an oxidising edge. Fine channels persist
    # further than wide stains, and leave a denser deposit at their foot.
    rivulet = cloud(s.rng, 512, 26, 2.1)
    lead = unit(1-edge*1.7) * unit((shore-.51)*5.1)
    water = lead.copy()
    for y in range(1, 512):
        water[y] = np.maximum(lead[y], water[y-1] * (.79 + .18*rivulet[y]))
    stain = .57*rivulet + .26*s.scale + .17*s.flake
    mark(s.decay, (water > .085) & (stain > .58),
         2.95 - 1.3*water - 1.71*(stain-.62),
         mix((78, 54, 42), (151, 112, 74), .68*s.grain + .32*water))
    gritline = .51*s.cloud + .32*s.scale + .17*s.grit
    mark(s.decay, (h < .29) & (h > .13) & (gritline > .56),
         3.20 - 3.13*(gritline-.48) - .32*unit((.27-h)/.10),
         mix((78, 71, 57), (138, 123, 94), s.grain))
    # At these high V values the broad visible panel is the bonnet. A few
    # little dead-clearcoat islands also sit on the crown of the roof.
    sky = ((nose > 1.04) & (nose < 1.69) & (wide < .42)) | ((abs(nose+.18)<.23) & (wide<.46))
    chalk = .52*s.cloud + .31*s.scale + .17*s.flake
    mark(s.decay, sky & (chalk > .724), 3.02 - 3.9*(chalk-.68),
         mix((117, 120, 114), (166, 163, 148), s.grain))


def near_edge(s):
    # The UV gutter is 7.4 pixels. Measure from the usable pane, not the atlas cell.
    return np.maximum(0, np.minimum.reduce([s.x-7.4, s.y-7.4, 120.6-s.x, 120.6-s.y]))


def fracture_cells(s, pitch, impact=None):
    """Fine, irregular dicing. Return distance to the nearest shared edge in pixels."""
    gy, gx = np.mgrid[-2:int(128/pitch)+3, -2:int(128/pitch)+3]
    sites = np.stack([gx, gy], axis=-1) + s.rng.uniform(-.46, .46, (*gx.shape, 2))
    sites = (pitch*sites).reshape(-1, 2)
    if impact is not None:
        # Coarser islands outboard; small toughened-glass dice around the blow.
        sites = sites[s.rng.random(len(sites)) > .20]
        sites = np.vstack([sites, s.rng.normal(impact, (17, 19), (32, 2))])
    xy = np.stack([s.x + (s.scale-.5)*1.8, s.y + (s.flake-.5)*.85], axis=-1)
    dist, ids = cKDTree(sites).query(xy, k=2)
    centre, other = sites[ids[...,0]], sites[ids[...,1]]
    delta = other - centre
    spacing = np.linalg.norm(delta, axis=-1)
    edge = (dist[...,1]**2 - dist[...,0]**2) / (2*spacing)
    gleam = .5 + (.30*delta[...,0] - .31*delta[...,1]) / spacing
    return edge, centre[...,0], centre[...,1], gleam


def fractures(s, centre, count, radii, pigment, reserved, reach):
    """Bent primary cracks, partial circumferential cracks, short bifurcations."""
    angles = (np.arange(count) + s.rng.uniform(-.28, .28, count)) * (2*np.pi/count)
    spokes = np.zeros((len(radii)+1, count, 2))
    spokes[0] = centre
    for j, r in enumerate(radii, 1):
        turn = angles + s.rng.uniform(-.14, .14, count)
        length = r * s.rng.uniform(.78, 1.19, count)
        spokes[j] = centre + np.stack([length*np.cos(turn), length*np.sin(turn)], axis=-1)

    def line(a, b, wait, half):
        dx, dy = b-a
        t = unit(((s.x-a[0])*dx + (s.y-a[1])*dy) / (dx*dx + dy*dy))
        dist = np.hypot(s.x-a[0]-t*dx, s.y-a[1]-t*dy)
        r = np.hypot(s.x-centre[0], s.y-centre[1]) / reach
        mark(s.hurt, (dist < half*(.80+.36*s.flake)) & ~reserved,
             .10 + 1.87*r**.72 + wait + .18*dist/half, pigment)

    for j, row in enumerate(spokes[1:], 1):
        for i, tip in enumerate(row):
            root = spokes[j-1,i]
            line(root, tip, (i % 3)*.07, 1.18 if j < 4 else .98)
            if j < len(radii) and s.rng.random() < (.84 if j < 3 else .48):
                line(tip, row[(i+1) % count], .18 + .06*j, .83)
            if j >= 3 and (i+j) % 3 == 1:
                a = angles[i] + s.rng.choice((-1, 1))*s.rng.uniform(.32, .61)
                end = tip + s.rng.uniform(8, 22)*np.array([np.cos(a), np.sin(a)])
                line(tip, end, .30, .84)


def glazing(s, name):
    pane = name == 'glass'
    mirror = name == 'mirror'
    gauge = name == 'gauge'
    red = name in ('taillight', 'tailguide')
    amber = name in ('amber', 'marker')
    edge, cx, cy, light = fracture_cells(s, 10.1 if pane else 15., (46, 51) if pane else None)
    if pane:
        centre = np.array([46., 51.])
        aperture = np.minimum(np.hypot((cx-76 + .36*(cy-78))/22, (cy-79)/28),
                              np.hypot((cx-106 - .34*(cy-34))/16, (cy-31)/20))
        hole_time = 1.95 + .62*aperture
        lo, hi = (88, 103, 112), (200, 211, 205)
    elif mirror or gauge:
        centre = np.array([80., 51.]) if mirror else np.array([34., 75.])
        aperture = np.hypot((cx-105)/14, (cy-88)/23)
        hole_time = 2.02 + .65*aperture
        lo, hi = (48, 65, 73), (202, 215, 206)
    else:
        centre = s.rng.uniform([29, 27], [42, 38])
        if red:
            # A section of the long light bar has dropped out, right through
            # its upper and lower edges; a ribbon of plastic survives at left.
            aperture = np.minimum(abs(cx-92-.15*(cy-64))/29,
                                  np.hypot((cx-42+.24*(cy-59))/22, (cy-74)/43))
        else:
            aperture = np.minimum(np.hypot((cx-79+.29*(cy-65))/48, (cy-66)/46),
                                  np.hypot((cx-24-.38*(cy-83))/24, (cy-87)/31))
        hole_time = 1.18 + 1.10*aperture + .34*s.scale
        lo = (89, 40, 40) if red else (101, 65, 42) if amber else (51, 65, 72)
        hi = (236, 165, 145) if red else (233, 189, 119) if amber else (231, 229, 207)
    holes = aperture < 1.
    reserve = holes & (aperture < (.84 if pane else .88))
    pigment = mix(lo, hi, .20 + .54*light + .26*s.grain)
    fractures(s, centre, 10 if pane else 8, [3.7, 8.5, 20, 42, 84, 120], pigment,
              reserve, 67 if pane else 80)
    # Chipped edges at the frit; isolated dice cling to the rubber.
    rim = near_edge(s)
    if pane:
        rim_impact = np.minimum(np.hypot(s.x-15, (s.y-83)*.70), np.hypot(s.x-97, s.y-12))
        mark(s.hurt, (rim < 7) & (rim_impact < 29) & (edge < 1.23) & ~holes,
             .26 + .045*rim_impact + .055*rim, pigment)
    r = np.hypot((s.x-centre[0])*.94, s.y-centre[1])
    width = (.65 + .43*light) if pane else (1.02 + .5*light)
    if mirror or gauge:
        # Laminated instrument and mirror glass split into a few large facets.
        shard_area = ((s.x>84) & (s.y>62)) | (r < 13)
    else:
        shard_area = True
    mark(s.hurt, shard_area & (edge < width) & ~holes,
         1.46 + .70*unit(r/91) + .33*(1-s.cloud) + .14*(edge/width),
         mix(lo, hi, .31 + .52*light + .17*s.flake))
    # No loose bright fractures floating across the middle of an ejected piece.
    inside = ndimage.distance_transform_edt(holes)
    dark = mix((11, 16, 20), (32, 43, 46) if pane else (48, 42, 39), s.grain)
    teeth = unit(1-inside/3.8) * (.30 + .61*light) * (.46+.54*s.flake)
    mark(s.hurt, holes, hole_time, mix(dark, hi, teeth))

    if pane or mirror or gauge:
        tide = cloud(s.rng, 128, 37, 3.7)
        film = .43*s.cloud + .23*s.scale + .13*s.flake + .21*tide
        time = 2.69 + .63*unit(rim/27) - 2.54*(film-.49) - .47*(s.y>92)
        mark(s.decay, film > .36, time, mix((71, 77, 74), (145, 145, 122), .55*film+.45*s.grain))
    else:
        tarnish = .52*s.cloud + .31*s.scale + .17*s.flake
        colour = mix((112, 69, 48) if red else (135, 105, 54),
                     (183, 121, 77) if red else (216, 190, 119), s.grain)
        mark(s.decay, tarnish > .24, 2.71 - 2.24*(tarnish-.43) - .57*np.exp(-rim/14), colour)


def wheels(s, name):
    """Interrupted kerb rash, scoured alloy, and corrosion in the recesses."""
    x, y = s.x-64, s.y-64
    radius = np.hypot(x, y)
    phase = s.rng.uniform(-2.8, 2.8)
    angle = np.arccos(np.clip(np.cos(np.arctan2(y, x)-phase), -1, 1))
    # Spokes use their own box. The rotor and wheel lips occupy interior radii
    # within a complete wheel box, so give them their actual working radii.
    r0 = {'alloy': 46, 'hub': 45, 'caliper': 35, 'rotor': 28, 'chrome': 41, 'graphite': 39}[name]
    band = np.abs(radius-r0-3.9*np.cos(angle*2.9)-1.5*(s.scale-.5))
    scoring = .5 + .5*np.sin(1.65*radius + 1.4*s.scale + 2.7*angle)
    pressure = .40*s.scale + .22*s.grit + .38*scoring
    bright = mix((75, 74, 72), (207, 197, 170), .64*pressure + .36*s.flake)
    mark(s.hurt, (band < 8.9) & (angle < 2.15) & (pressure > .33+.020*band),
         .13+.81*angle+.084*band+.52*(1-pressure), bright)
    # A second oblique strike reaches the spoke face and plated trim.
    d = s.y - (92 - .54*s.x + 2.5*np.sin(s.x/13))
    rough = .46*s.flake + .34*s.scale + .20*s.grit
    mark(s.hurt, (abs(d)<5.4) & (s.x>25) & (s.x<106) & (rough>.38),
         .78 + .17*abs(d) + .54*(1-rough), mix((70, 68, 65), (182, 178, 154), rough))
    bed = .48*s.cloud + .28*s.scale + .24*s.flake
    pitting = .45*np.exp(-near_edge(s)/14) + .47*np.exp(-band/8)
    if name == 'rotor':
        pitting += .38*(radius<31)
    oxide = mix((67, 53, 43), (177, 101, 53), .55*s.flake + .45*s.scale)
    if name in ('chrome','alloy','hub'):
        # Grey-white aluminium salt and pitted plating with pockets of brake dust.
        oxide = mix(oxide, mix((90, 96, 89), (191, 186, 157), rough), unit((s.scale-.19)*2.25))
    mark(s.decay, bed > .25, 2.83 - 3.08*(bed-.42) - pitting, oxide)


def rubber(s, name):
    sidewall = name == 'tyre'
    x, y = s.x-64, s.y-64
    angle = np.arctan2(y, x)
    radius = np.hypot(x, y)
    if sidewall:
        length = np.arccos(np.clip(np.cos(angle-1.85), -1, 1))
        cut = radius - 48 + 6.2*np.sin(2*angle)
        t = .15 + 1.37*length
    else:
        cut = s.y - 88 + .42*s.x + 3.2*np.sin(s.x/10.5)
        t = .16 + .019*abs(s.x-70)
    cut += 1.8*(s.flake-.5)
    pigment = mix((17, 19, 21), (116, 108, 89), unit((cut+1)/5)*(.52+.47*s.grain))
    mark(s.hurt, (abs(cut)<6.5) & (s.grain > .18+.025*abs(cut)), t + .12*abs(cut), pigment)
    edge, _, _, _ = fracture_cells(s, 14.3 if sidewall else 18)
    shoulder = abs(radius-48) if sidewall else near_edge(s)
    rot = .50*s.cloud + .28*s.scale + .22*s.flake
    mark(s.decay, (edge < 1.3) & (rot > .35), 1.41+.030*shoulder+.90*(1-rot),
         mix((20, 23, 24), (56, 55, 49), s.grain))
    mark(s.decay, rot > .34, 2.84 - 2.55*(rot-.46) - .46*np.exp(-shoulder/12),
         mix((55, 57, 54), (116, 109, 90), s.grain))


def interior(s, name):
    # On the seat the bolster bursts across its bias. The woven insert unpicks
    # along the warp, and the headlining tears in a long, sagging curve.
    seams = {
        'seat': [(26,36),(41,53),(58,62),(61,74),(83,90)],
        'weave': [(31,84),(48,72),(52,56),(73,49),(85,32)],
        'grip': [(47,18),(56,41),(55,64),(68,84),(70,108)],
        'dash': [(16,73),(38,62),(57,63),(69,51),(96,38)],
        'carpet': [(19,83),(42,74),(68,77),(88,63),(106,61)],
        'headlining': [(17,39),(39,51),(47,65),(78,78),(103,73)],
        'insert': [(27,102),(39,80),(55,72),(66,57),(90,52)],
    }
    t, d = path_coords(s.x, s.y, seams[name])
    mid = np.maximum(0, np.sin(t*np.pi))
    cloth = name in ('seat', 'carpet', 'weave', 'headlining')
    width = (2.0 + (5.9 if cloth else 2.7)*mid**2) * (.75 + .57*s.flake)
    r = np.abs(d) / width
    grain = s.grain
    time = .25 + 1.27*(1-mid) + .58*r + .43*(1-s.scale)
    inside = (t > 0) & (t < 1)
    mark(s.hurt, inside & (r < 1), time, mix((25, 24, 24), (80, 65, 51), grain))
    # The warm strip is the visible backing; short severed threads cross it.
    lint = (np.cos(s.x*(1.21 if name=='weave' else .89) + d*.48 + 1.9*s.scale) > .39)
    pad = (d < -.12*width) & (r < .78) & (s.scale+.5*s.flake > .58)
    mark(s.hurt, inside & pad, time-.12, mix((88, 71, 49), (172, 148, 101), grain))
    mark(s.hurt, inside & (r < 1.46) & (r > .62) & lint, time-.02,
         mix((91, 83, 69), (191, 175, 132), grain))
    # Tension opens the stitching on either side of the split late in its life.
    slit = d - (3.8 + 8.6*mid - 2.4*np.cos(8.1*t))
    loops = np.sin(74*t - .48*d + s.scale) > -.24
    mark(s.hurt, inside & (t>.24) & (t<.87) & (abs(slit)<1.42) & loops,
         1.94 + .69*(1-mid) + .34*(1-s.flake), mix((62, 55, 45), (153, 134, 100), grain))
    if name in ('dash', 'grip'):
        # Hard vinyl splits from the trough, exposing a pale substrate at the lip.
        split = ([(57,63),(59,77),(68,83)] if name=='dash' else [(56,62),(43,67),(36,79)])
        along, gap = path_coords(s.x, s.y, split)
        mark(s.hurt, (along>0) & (along<1) & (abs(gap)<1.6),
             1.37+.76*along+.21*abs(gap), mix((26, 29, 29), (157, 144, 115), (gap<-.48)*(.55+.41*grain)))
    if name in ('carpet', 'weave'):
        # The backing peeks through the pile to one side of the cut. Surviving
        # yarn crosses the bare patch in one direction, intermittently in the other.
        bare = mid**2 * unit((s.cloud + .5*s.flake - .61)*2.5)
        warp = (s.x.astype(int)%5 < 2) | ((s.y.astype(int)%6 == 0) & (s.flake > .57))
        patch = inside & (d>3) & (d<3+bare*13) & (grain>.35)
        mark(s.hurt, patch, 1.53+.68*(1-bare)+.035*d,
             mix((68, 58, 47), (160, 137, 96), (.26+.69*warp)*grain+.16*warp))
    tide = .52*s.cloud + .28*s.scale + .20*s.flake
    damp = .48*np.exp(-near_edge(s)/17) + .49*unit((s.y-63)/58)
    # Distinct spore colonies within a patch of damp and dust along its tide mark.
    mildew = unit((s.flake-.46)*3.2)*unit((s.cloud-.32)*2.5)
    colour = mix((85, 79, 64), (154, 143, 109), grain)
    colour = mix(colour, mix((54, 66, 52), (110, 113, 82), grain), mildew)
    mark(s.decay, tide > .34, 3.10 - 2.60*(tide-.42) - damp - .58*mildew, colour)


def hardware(s, name):
    # A buckled plate, folded grille slats, torn wheel tub or scuffed valance.
    creases = {
        'plate': [(13,86),(46,68),(55,49),(94,31)],
        'intake': [(18,47),(37,58),(58,57),(71,71),(109,80)],
        'smoke': [(22,87),(40,74),(56,68),(69,45),(97,39)],
        'under': [(8,92),(33,81),(61,79),(81,65),(116,53)],
        'liner': [(18,27),(39,39),(54,60),(78,66),(104,83)],
    }
    t, d = path_coords(s.x, s.y, creases[name])
    mid = np.maximum(0, np.sin(t*np.pi))
    w = (1.2 + 4.7*mid)*(.77+.47*s.flake)
    inside = (t>0) & (t<1)
    colour = mix((34, 37, 36), (165, 161, 142), unit(.47+d/w)*(.53+.46*s.grain))
    mark(s.hurt, inside & (abs(d)<w), .19+.83*(1-mid)+.46*abs(d)/w, colour)
    rake = .52*cloud(s.rng, 128, 2.6, 16) + .48*s.grain
    mark(s.hurt, inside & (abs(d + w) < 5*mid) & (rake > .55), .83+.59*(1-mid)+.47*(1-rake),
         mix((97, 89, 77), (173, 164, 140), rake))
    if name == 'intake':
        # A folded slat leaves a dark pocket behind a displaced, chipped edge.
        slat = np.abs((s.y-4 + 6.2*np.sin(np.pi*t))%11-5.5)
        dent = ((s.x-74)/27)**2 + ((s.y-63)/21)**2
        mark(s.hurt, (dent<1) & (slat<3.8), 1.53+.69*dent+.12*slat,
             mix((16, 19, 20), (109, 111, 101), (slat>2.2)*(.61+.37*s.grain)))
    soot = .53*s.cloud + .27*s.scale + .2*s.flake
    puddle = .56*np.exp(-near_edge(s)/14) + .39*unit((s.y-59)/62)
    oxide = mix((68, 61, 49), (141, 125, 92), s.grain)
    if name in ('plate','under','intake'):
        oxide = mix(oxide, (156, 86, 47), unit((s.scale-.42)*2.6))
    if name == 'plate':
        # Reflective film survives in the middle; bleeding fasteners and the
        # rolled flange stain it first, including a short rain track at each end.
        bolts = np.minimum(np.hypot(s.x-18, (s.y-40)*.67), np.hypot(s.x-109, (s.y-40)*.67))
        streak = np.minimum(abs(s.x-18), abs(s.x-109)) + .17*abs(s.y-52)
        puddle += .93*np.exp(-np.minimum(bolts, streak)/8)
        puddle -= .84*unit(near_edge(s)/24)
    mark(s.decay, soot > .31, 2.90 - 2.76*(soot-.44) - puddle, oxide)


def detail():
    atlas = [np.zeros((1024, 1024, 4), dtype=np.uint8) for _ in range(2)]
    for i, name in enumerate(FINISH):
        if name == 'invisible':
            continue
        s = Surface(128, 3201 + 193*i)
        if name in ('glass','mirror','gauge','headlight','projector','lamp_edge','amber','taillight','tailguide','marker'):
            glazing(s, name)
        elif name in ('alloy','hub','caliper','rotor','chrome','graphite'):
            wheels(s, name)
        elif name in ('tyre','tread','seal'):
            rubber(s, name)
        elif name in ('seat','weave','dash','carpet','grip','headlining','insert'):
            interior(s, name)
        else:
            hardware(s, name)
        s.separate()
        col, row = i%8*128, i//8*128
        for sheet, tile in zip(atlas, (s.hurt, s.decay)):
            # Extrude each drawable interior up to its own cell border.
            sheet[row:row+128, col:col+128] = np.pad(tile[7:121, 7:121], ((7,7),(7,7),(0,0)), mode='edge')
    return atlas


if __name__ == '__main__':
    for material, painter in [('enamel', enamel), ('detail', detail)]:
        for layer, picture in zip(('hurt','decay'), painter()):
            Image.fromarray(picture).save(HERE / f'{material}_{layer}.png')

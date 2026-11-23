"""HL-9, the contracted tandem-rotor heavy lifter that carries the AFU-07 rack by its four castings. See ../air_freight.

A crewed nose, two transmission pylons joined by an open truss spine and a synchronising shaft, twin turbines on
the rear pylon, and two clamp yokes whose hydraulic arms close their jaws on the rack's castings. At rest the jaws
are closed; turning a left clamp +0.5 rad about +Z (a right one -0.5) swings it open.
"""

from pathlib import Path
import math
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "air_freight"))
from kit import Kit, MIRROR, T, R, rounded  # noqa: E402

ROTORS = {"rotor_front": (0, 2.85, 3.84), "rotor_rear": (0, 3.25, -3.84)}
RADIUS = 3.55
JAW = (1.17, 0.25, 3.52)
PIVOT = (1.5, 1.15)
BONES = [
    ("chassis", (0, 0, 0)),
    ("rotor_front", ROTORS["rotor_front"]),
    ("rotor_rear", ROTORS["rotor_rear"]),
    ("clamp_front_left", (PIVOT[0], PIVOT[1], JAW[2])),
    ("clamp_front_right", (-PIVOT[0], PIVOT[1], JAW[2])),
    ("clamp_rear_left", (PIVOT[0], PIVOT[1], -JAW[2])),
    ("clamp_rear_right", (-PIVOT[0], PIVOT[1], -JAW[2])),
]

kit = Kit("air_carrier", BONES)
kit.least_bevel = 0.15
box, cbox, beam, cyl = kit.box, kit.cbox, kit.beam, kit.cylinder


BAND = (0.5, 0.58)


def section(w, low, top, corner=0.32, n=5):
    """A rounded box section, as points (x, y), counter-clockwise from the bottom right, with the livery band's edges on each side."""
    c = min(w, (top - low) / 2) * corner
    h = top - low
    a, b = low + BAND[0] * h, low + BAND[1] * h
    return rounded([(w, low), (w, a), (w, b), (w, top), (-w, top), (-w, b), (-w, a), (-w, low)], c, n)


def livery(stations):
    """Pale grey above the band, the band in amber, dark below: a contractor's machine."""
    pts = [section(w, lo, hi, k) for _, w, lo, hi, k in stations]

    def tag(r, i):
        p, q = pts[r][i], pts[r][(i + 1) % len(pts[r])]
        lo, hi = stations[r][2], stations[r][3]
        f = ((p[1] + q[1]) / 2 - lo) / (hi - lo)
        if BAND[0] - 0.01 < f < BAND[1] + 0.01 and abs(p[0] - q[0]) < 1e-6:
            return "amber"
        return "panel_w" if f > BAND[1] else "panel_d"
    return tag


def ring(points, z):
    return [(x, y, z) for x, y in points]


def fuselage(stations, tag, tags=None, caps=True, cap=None):
    kit.loft([ring(section(w, lo, hi, k), z) for z, w, lo, hi, k in stations], tag, caps=caps, cap=cap, tags=tags)


# ---------------------------------------------------------------- nose
def nose():
    st = [(7.32, 0.3, 1.3, 1.7, 0.9), (7.15, 0.58, 1.04, 2.0, 0.75), (6.75, 0.76, 0.95, 2.3, 0.5), (6.15, 0.8, 0.92, 2.42, 0.4),
          (5.4, 0.8, 0.93, 2.45, 0.35), (4.85, 0.78, 1.0, 2.5, 0.35)]
    pts = [section(w, lo, hi, k) for _, w, lo, hi, k in st]

    def tag(r, i):
        # A wraparound greenhouse: windscreen and side windows above the band, a solid roof, chin windows below.
        p, q = pts[r][i], pts[r][(i + 1) % len(pts[r])]
        lo, hi = st[r][2], st[r][3]
        f = ((p[1] + q[1]) / 2 - lo) / (hi - lo)
        x = abs(p[0] + q[0]) / 2
        if r <= 1 and f > 0.6:
            return "glass"
        if r == 2 and 0.62 < f < 0.93:
            return "glass"
        if r == 1 and f < 0.2 and x < 0.36:
            return "glass"
        return paint(r, i)

    paint = livery(st)
    fuselage(st, "panel_b", tags=tag, cap="panel_d")
    # Window frames and the wiper, a sensor turret under the chin, steps and handholds, nav and landing lamps.
    for s in (1, -1):
        beam((s * 0.3, 2.0, 7.1), (s * 0.22, 2.3, 6.72), 0.04, 0.04, "dark")
        # Pitot tube and a blade antenna.
        kit.tube([(s * 0.42, 1.25, 7.0), (s * 0.5, 1.25, 7.25), (s * 0.5, 1.25, 7.38)], 0.012, "steel", 6)
        cbox((s * 0.81, 1.75, 5.7), (0.03, 0.06, 0.16), "lamp_red" if s > 0 else "lamp_green", bevel=0.01)
        kit.decal((s * 0.805, 1.35, 5.4), (s, 0, 0), (0, 0, -s), 0.9, 0.22, "text_carrier", lift=0.003)
        for y in (0.65, 0.4):
            box((min(s * 0.72, s * 0.85), y - 0.02, 5.9), (max(s * 0.72, s * 0.85), y + 0.02, 6.2), "grip")
        beam((s * 0.78, 0.4, 6.05), (s * 0.78, 0.92, 6.05), 0.04, 0.04, "steel")
    kit.prism([(5.3, 2.43), (5.55, 2.43), (5.42, 2.62), (5.34, 2.62)], "x", -0.008, 0.008, "dark")
    cyl((0, 0.98, 6.9), (0, 0.84, 6.9), 0.14, "panel_d", 16, bevel=0.03)
    kit.lathe((0, 0.84, 6.9), (0, 0.66, 6.9), [(0, 0.13), (0.06, 0.13), (0.14, 0.09), (0.18, 0.0)], "dark", 16)
    cyl((0, 0.74, 6.99), (0, 0.74, 7.04), 0.05, "dark", 12, cap="lens")
    for x in (0.25, -0.25):
        cyl((x, 0.95, 6.55), (x, 0.9, 6.55), 0.08, "dark", 12)
        cyl((x, 0.9, 6.55), (x, 0.895, 6.55), 0.065, "lamp_warm", 12)
    # Front landing gear: oleo legs with a wheel each.
    for s in (1, -1):
        x = s * 0.62
        beam((x, 0.95, 5.95), (x, 0.3, 5.95), 0.12, 0.12, "frame", bevel=0.02)
        cyl((x, 0.55, 5.95), (x, 0.2, 5.95), 0.045, "chrome", 10)
        beam((x, 0.85, 5.55), (x, 0.4, 5.92), 0.06, 0.06, "frame")
        cyl((x - s * 0.08, 0.2, 5.95), (x + s * 0.08, 0.2, 5.95), 0.06, "steel", 10)
        kit.lathe((x + s * 0.02, 0.2, 5.95), (x + s * 0.16, 0.2, 5.95), [(0, 0.12), (0.01, 0.19), (0.03, 0.2), (0.11, 0.2), (0.13, 0.19), (0.14, 0.12)], "tread", 16,
                  tags=["tyre_wall", "tread", "tread", "tread", "tyre_wall"])


# ---------------------------------------------------------------- pylons, spine, engines
def pylon(e):
    z0 = ROTORS["rotor_front" if e > 0 else "rotor_rear"][2]
    hub = ROTORS["rotor_front" if e > 0 else "rotor_rear"][1]
    if e > 0:
        st = [(4.9, 0.78, 1.0, 2.5, 0.35), (4.5, 0.76, 1.02, 2.56, 0.3), (3.3, 0.74, 1.05, 2.56, 0.3), (2.85, 0.66, 1.15, 2.42, 0.35)]
    else:
        st = [(-2.85, 0.66, 1.15, 2.6, 0.35), (-3.2, 0.76, 1.05, 2.9, 0.3), (-4.5, 0.78, 1.02, 2.92, 0.3), (-5.3, 0.68, 1.12, 2.8, 0.35),
              (-6.2, 0.42, 1.5, 2.62, 0.45), (-7.0, 0.2, 1.9, 2.44, 0.7)]
    fuselage(st, "panel_b", tags=livery(st), cap="panel_d")
    top = max(h for _, _, _, h, _ in st)
    # Transmission fairing on top: intakes, the mast, the swashplate and its three servos.
    fair = [(z0 + 0.95 * e, 0.42, top - 0.05, top + 0.12, 0.5), (z0 + 0.5 * e, 0.5, top - 0.05, top + 0.24, 0.5), (z0 - 0.6 * e, 0.5, top - 0.05, top + 0.24, 0.5), (z0 - 1.0 * e, 0.36, top - 0.05, top + 0.1, 0.5)]
    fuselage(sorted(fair, key=lambda r: r[0]), "panel_w", cap="panel_w")
    for s in (1, -1):
        box((min(s * 0.46, s * 0.52), top + 0.02, z0 - 0.45), (max(s * 0.46, s * 0.52), top + 0.18, z0 + 0.1), "mesh")
        kit.decal((s * 0.765, top - 0.35, z0 - 0.9 * e), (s, 0, 0), (0, 0, -s), 0.7, 0.17, "text_rotor", lift=0.003)
    # Access panels and a step ladder up the pylon's flank to the transmission deck.
    for s in (1, -1):
        w = st[1][1] + 0.003
        for dz, dy, ww, hh in ((-0.35, 0.95, 0.6, 0.42), (0.45, 0.95, 0.5, 0.42)):
            kit.plate((s * w, 1.05 + dy, z0 + dz * e), (s, 0, 0), (0, 0, -s), ww, hh, "panel_seamed", depth=0.012)
        for k in range(4):
            box((min(s * w, s * (w + 0.05)), 1.25 + k * 0.28, z0 - 0.95 * e - 0.12), (max(s * w, s * (w + 0.05)), 1.28 + k * 0.28, z0 - 0.95 * e + 0.12), "steel")
    mast_lo = top + 0.24
    cyl((0, mast_lo - 0.05, z0), (0, hub - 0.12, z0), 0.13, "steel", 16)
    cyl((0, mast_lo, z0), (0, mast_lo + 0.06, z0), 0.36, "frame", 20, bevel=0.015)
    for k in range(3):
        a = k * math.tau / 3 + 0.5
        x, z = math.cos(a) * 0.3, z0 + math.sin(a) * 0.3
        cyl((x, mast_lo - 0.1, z), (x, mast_lo + 0.02, z), 0.04, "chrome", 8)
        box((x - 0.05, mast_lo - 0.2, z - 0.05), (x + 0.05, mast_lo - 0.08, z + 0.05), "dark")
    # Anti-collision beacon on the fairing's trailing edge.
    cyl((0, top + 0.1, z0 - 0.95 * e), (0, top + 0.2, z0 - 0.95 * e), 0.05, "lamp_red", 10)
    # Clamp yoke under the pylon: a box beam across with a rotary actuator at each end.
    jz = e * JAW[2]
    box((-1.62, 0.98, jz - 0.17), (1.62, 1.22, jz + 0.17), "frame", bevel=0.03)
    for s in (1, -1):
        kit.prism([(s * 0.66, 1.22), (s * 0.66, 1.4), (s * 1.0, 1.22)], "z", jz - 0.15, jz + 0.15, "frame")
        cyl((s * PIVOT[0], PIVOT[1], jz - 0.24), (s * PIVOT[0], PIVOT[1], jz + 0.24), 0.16, "panel_d", 18, bevel=0.02, cap="bolt")
        box((min(s * 1.36, s * 1.66), 1.2, jz - 0.12), (max(s * 1.36, s * 1.66), 1.36, jz + 0.12), "frame", bevel=0.02)
        kit.tube([(s * 1.2, 1.23, jz + 0.17), (s * 1.38, 1.28, jz + 0.26), (s * 1.48, 1.2, jz + 0.25)], 0.02, "hose", 6)
        kit.decal((s * 1.0, 1.1, jz + 0.171 * (1 if e > 0 else -1)), (0, 0, e), (e, 0, 0), 0.9, 0.12, "text_hazard", lift=0.002)


def spine():
    # Open truss between the pylons: four chords, posts and diagonals, the synchronising shaft on hangers above.
    z0, z1 = -2.9, 2.9
    chords = [(0.42, 2.15), (-0.42, 2.15), (0.55, 1.25), (-0.55, 1.25)]
    for x, y in chords:
        beam((x, y, z0), (x, y, z1), 0.11, 0.11, "rail", bevel=0.015)
    bays = 8
    for k in range(bays + 1):
        z = z0 + (z1 - z0) * k / bays
        for s in (1, -1):
            beam((s * 0.55, 1.25, z), (s * 0.42, 2.15, z), 0.07, 0.07, "frame")
        beam((0.42, 2.15, z), (-0.42, 2.15, z), 0.06, 0.06, "frame")
        beam((0.55, 1.25, z), (-0.55, 1.25, z), 0.06, 0.06, "frame")
        if k < bays:
            zn = z0 + (z1 - z0) * (k + 1) / bays
            for s in (1, -1):
                a, b = ((s * 0.55, 1.25, z), (s * 0.42, 2.15, zn)) if k % 2 == 0 else ((s * 0.42, 2.15, z), (s * 0.55, 1.25, zn))
                beam(a, b, 0.05, 0.05, "frame")
            beam((0.55, 1.25, z), (-0.55, 1.25, zn), 0.045, 0.045, "frame")
    cyl((0, 2.38, z0 - 0.1), (0, 2.38, z1 + 0.1), 0.075, "steel", 12)
    for k in range(5):
        z = z0 + 0.4 + k * (z1 - z0 - 0.8) / 4
        box((-0.16, 2.2, z - 0.07), (0.16, 2.46, z + 0.07), "panel_d", bevel=0.02)
        cyl((0, 2.38, z - 0.09), (0, 2.38, z + 0.09), 0.11, "frame", 12)
    # Walkway grating on the lower chords, the cable trays and the docking sensor pod under the middle.
    box((-0.5, 1.31, z0), (0.5, 1.33, z1), "grip")
    for s in (1, -1):
        box((min(s * 0.3, s * 0.4), 2.06, z0), (max(s * 0.3, s * 0.4), 2.1, z1), "dark")
        kit.tube([(s * 0.36, 2.1, z0), (s * 0.36, 2.12, z1)], 0.02, "hose", 6)
    box((-0.3, 1.0, -0.5), (0.3, 1.24, 0.5), "panel_d", bevel=0.05)
    kit.lathe((0, 1.0, 0.0), (0, 0.88, 0.0), [(0, 0.17), (0.06, 0.16), (0.12, 0.0)], "glass", 16)
    for x, tag in ((0.22, "lamp_green"), (-0.22, "lamp_red")):
        cbox((x, 1.0, 0.4), (0.06, 0.025, 0.06), tag)
    kit.decal((0.555 + 0.056, 1.25, 1.6), (1, 0, 0), (0, 0, -1), 1.1, 0.09, "text_carrier", lift=0.002)
    kit.decal((-0.555 - 0.056, 1.25, 1.6), (-1, 0, 0), (0, 0, 1), 1.1, 0.09, "text_carrier", lift=0.002)


def engines():
    # Twin turbines on stub pylons either side of the rear pylon.
    for s in (1, -1):
        x, y = s * 1.18, 2.42
        prof = [(0.0, 0.26), (0.0, 0.32), (0.08, 0.37), (0.4, 0.38), (1.6, 0.38), (2.15, 0.34), (2.45, 0.27), (2.5, 0.22)]
        kit.lathe((x, y, -2.55), (x, y, -5.05), prof, "panel_b", 28, tags=["dark", "steel", "panel_b", "panel_seamed", "panel_b", "panel_d", "frame"])
        kit.lathe((x, y, -2.56), (x, y, -2.62), [(0, 0.26), (0.06, 0.24)], "mesh", 20)
        cyl((x, y, -2.6), (x, y, -2.75), 0.1, "dark", 12, r2=0.05)
        cyl((x, y, -5.0), (x, y, -5.32), 0.23, "steel", 18, r2=0.21)
        kit.lathe((x, y, -5.31), (x, y, -5.34), [(0, 0.21), (0.03, 0.12)], "seam", 18)
        for z in (-3.1, -4.3):
            beam((s * 0.72, 2.3, z), (x - s * 0.3, y, z), 0.3, 0.12, "panel_d", bevel=0.02)
    # Rear gear: splayed legs with twin wheels, clear of the rack's length.
    for s in (1, -1):
        top = (s * 0.72, 1.12, -5.6)
        foot = (s * 1.25, 0.3, -5.6)
        beam(top, foot, 0.14, 0.12, "frame", bevel=0.02)
        beam((s * 0.72, 1.12, -5.0), (s * 1.2, 0.45, -5.55), 0.07, 0.07, "frame")
        cyl((foot[0], 0.55, -5.6), (foot[0], 0.22, -5.6), 0.05, "chrome", 10)
        cyl((foot[0] - s * 0.1, 0.22, -5.6), (foot[0] + s * 0.24, 0.22, -5.6), 0.05, "steel", 10)
        for dx in (0.02, 0.16):
            kit.lathe((foot[0] + s * dx, 0.22, -5.6), (foot[0] + s * (dx + 0.12), 0.22, -5.6), [(0, 0.12), (0.01, 0.21), (0.03, 0.22), (0.09, 0.22), (0.11, 0.21), (0.12, 0.12)], "tread", 16,
                      tags=["tyre_wall", "tread", "tread", "tread", "tyre_wall"])
    # Tail: strobe and the cooling exhaust.
    cyl((0, 2.17, -6.98), (0, 2.17, -7.05), 0.06, "lamp_white", 10)


# ---------------------------------------------------------------- clamps
def clamp(bone, s, e):
    jz = e * JAW[2]
    px, py = PIVOT
    with kit.on(bone):
        with kit.at(MIRROR if s < 0 else T()):
            # Built for the left side: the arm drops from the actuator to the jaw, which closes inward on the casting.
            beam((px, py, jz), (1.44, 0.48, jz), 0.2, 0.26, "amber", bevel=0.03, up=(0, 0, 1))
            for z in (jz - 0.131, jz + 0.131):
                kit.decal(((px + 1.44) / 2 + 0.01, 0.78, z), (0, 0, 1 if z > jz else -1), (1 if z > jz else -1, 0, 0), 0.12, 0.42, "hazard", lift=0.002)
            # Hydraulic ram along the arm's outer face: barrel, chrome rod, clevises.
            cyl((1.66, 1.05, jz), (1.6, 0.66, jz), 0.06, "panel_d", 12, bevel=0.01)
            cyl((1.6, 0.66, jz), (1.56, 0.42, jz), 0.03, "chrome", 10)
            box((1.58, 1.02, jz - 0.05), (1.66, 1.12, jz + 0.05), "steel")
            box((1.5, 0.36, jz - 0.05), (1.6, 0.46, jz + 0.05), "steel")
            kit.tube([(1.68, 1.0, jz + 0.06), (1.72, 0.9, jz + 0.16), (1.6, 1.25, jz + 0.22)], 0.016, "hose", 6)
            # The jaw: a hooked block with a locking pin into the casting's aperture and a guide horn below.
            box((1.27, 0.1, jz - 0.17), (1.58, 0.44, jz + 0.17), "frame", bevel=0.03)
            box((1.27, 0.06, jz - 0.13), (1.42, 0.12, jz + 0.13), "steel", bevel=0.02)
            kit.prism([(1.27, 0.02), (1.42, 0.06), (1.42, 0.12), (1.27, 0.12)], "z", jz - 0.12, jz + 0.12, "amber")
            cyl((1.28, JAW[1], jz), (1.2, JAW[1], jz), 0.035, "chrome", 10)
            cyl((1.58, JAW[1], jz), (1.64, JAW[1], jz), 0.06, "panel_d", 12, cap="bolt")
            cbox((1.585, 0.4, jz + e * 0.12), (0.02, 0.04, 0.04), "lamp_amber")


# ---------------------------------------------------------------- rotors
def rotor(bone):
    cx, cy, cz = ROTORS[bone]
    turn = 1 if bone == "rotor_front" else -1
    with kit.on(bone):
        # Hub: a three-arm head with lag dampers, pitch horns and links down to the rotating swashplate ring.
        cyl((cx, cy - 0.12, cz), (cx, cy + 0.1, cz), 0.2, "frame", 18, bevel=0.02)
        kit.lathe((cx, cy + 0.1, cz), (cx, cy + 0.145, cz), [(0, 0.16), (0.025, 0.12), (0.045, 0.0)], "panel_d", 16)
        ring_y = cy - 0.24
        cyl((cx, ring_y - 0.02, cz), (cx, ring_y + 0.02, cz), 0.32, "steel", 20)
        for k in range(3):
            a = k * math.tau / 3
            ca, sa = math.cos(a), math.sin(a)
            p = lambda r, y=cy, t=0.0: (cx + ca * r - sa * t, y, cz + sa * r + ca * t)
            beam(p(0.15), p(0.62), 0.16, 0.12, "frame", bevel=0.02)
            cyl(p(0.25, cy, -0.12 * turn), p(0.5, cy, -0.1 * turn), 0.035, "chrome", 8)
            box_at = p(0.42, cy - 0.06, 0.16 * turn)
            cbox(box_at, (0.08, 0.06, 0.08), "steel")
            beam(p(0.28, ring_y + 0.02, 0.2 * turn), p(0.42, cy - 0.08, 0.16 * turn), 0.03, 0.03, "chrome")
            # The blade: a cuff, then a tapered aerofoil with an amber tip cap.
            beam(p(0.6), p(0.9), 0.2, 0.08, "steel", bevel=0.01)
            rings = []
            for r, chord, th, twist in ((0.9, 0.34, 0.06, 0.18), (1.3, 0.36, 0.05, 0.14), (2.6, 0.34, 0.035, 0.07), (RADIUS - 0.15, 0.3, 0.025, 0.02), (RADIUS, 0.22, 0.016, 0.0)):
                twist *= turn
                pts = []
                for c, t in ((-0.5, 0.0), (-0.32, 0.55), (0.1, 1.0), (0.5, 0.0), (0.1, -0.35), (-0.32, -0.3)):
                    lc, lt = c * chord, t * th / 2
                    x2, y2 = lc * math.cos(twist) - lt * math.sin(twist), lc * math.sin(twist) + lt * math.cos(twist)
                    pts.append(p(r, cy + y2, x2 * turn))
                rings.append(pts)
            kit.loft(rings, "blade", tags=lambda r, i: "amber" if r == 3 else "blade", cap="amber")


nose()
pylon(1)
pylon(-1)
spine()
engines()
for e, end in ((1, "front"), (-1, "rear")):
    for s, side in ((1, "left"), (-1, "right")):
        clamp(f"clamp_{end}_{side}", s, e)
rotor("rotor_front")
rotor("rotor_rear")
kit.finish()

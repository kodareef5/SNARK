# The thrown weapons and the projectiles: "grenade" (core:grenade, held) and "grenade_thrown" (core:grenade_thrown, the
# live grenade in flight), "bola" and "bola_lying" (core:bola, held and lying), "arrow" (core:arrow) and "dart"
# (core:dart), modelled from the concept views in ref/concept/ (their sizes are BRIEF.md's).
#
# Held pieces are modelled as the right hand holds them (tools/art/spec.ts, PieceSpec.hold): the grip at the origin,
# the length along +Z, the top along +Y. The projectiles keep the axes tools/pack/weapons.ts draws their boxes in: the
# arrow and the dart point along +Z with the origin where the head meets the shaft, so a stuck one stands out of what
# it hit; the live grenade stands on its origin, its fuse cap up.
#
# Materials: "steel" and "hide" (and "lashing" on the grenade's band); "hide" and "lashing" on the bola; "wood",
# "flint" and "hide" on the arrow; "steel" and "hide" on the dart.

import math
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from kit import BRASS, BRIGHT, STEEL, V, Part, bezier, circle, cord, knapped, leaf_point, rrect, sweep, tube  # noqa: E402

# ---- the grenade ------------------------------------------------------------------------------------------------------


def grenade(name="grenade"):
    part = Part(name, ["steel", "hide", "lashing"])
    # The iron egg: eight facets round its middle, rounding over into its base and narrowing into its top.
    prof = [(-0.045, 0.006), (-0.042, 0.020), (-0.033, 0.031), (-0.018, 0.0375), (-0.005, 0.038), (0.012, 0.0365),
            (0.028, 0.031), (0.039, 0.022), (0.045, 0.014)]
    oct8 = lambda r: [(r / math.cos(math.pi / 8) * math.cos(math.pi / 8 + 2 * math.pi * k / 8),
                       r / math.cos(math.pi / 8) * math.sin(math.pi / 8 + 2 * math.pi * k / 8)) for k in range(8)]
    sweep(part, "steel", [V(0, 0, z) for z, _ in prof], [oct8(r) for _, r in prof], hint=(0, 1, 0), **STEEL)
    # The hide band round its waist.
    bz = [-0.016, -0.0145, 0.0145, 0.016]
    sweep(part, "hide", [V(0, 0, z) for z in bz], [oct8(0.0372), oct8(0.0405), oct8(0.0400), oct8(0.0368)], hint=(0, 1, 0),
          uv="wrap", smooth=False)
    # The lacing across the band on the -Y side: three crossings of cord.
    for k in (-1, 0, 1):
        x = k * 0.010
        cord(part, [V(x - 0.005, -0.0395, -0.014), V(x, -0.0418, 0.0), V(x + 0.005, -0.0395, 0.014)], 0.0016, 4, hint=(0, 1, 0))
    # The brass fuse cap, the pin across it, and the ring hanging from the pin's -X end.
    tube(part, "steel", [V(0, 0, 0.043), V(0, 0, 0.060), V(0, 0, 0.066)], [0.013, 0.013, 0.010], 10, hint=(0, 1, 0), **BRASS)
    tube(part, "steel", [V(0.016, 0, 0.058), V(-0.018, 0, 0.058)], 0.0022, 5, hint=(0, 1, 0), **BRIGHT)
    ring = [V(-0.018 - 0.0005 * math.sin(a), 0, 0.072 + 0.014 * math.cos(a + math.pi) + 0.0) for a in [2 * math.pi * k / 10 for k in range(11)]]
    ring = [V(-0.018 + 0.012 * math.sin(2 * math.pi * k / 10), 0, 0.072 - 0.013 * math.cos(2 * math.pi * k / 10)) for k in range(10)]
    ring.append(ring[0])
    sweep(part, "steel", ring[:-1] + [ring[0] + V(0, 0, 0.0001)], circle(0.002, 4), hint=(0, 1, 0), caps=(True, True), **BRIGHT)
    # The lever: a steel strip from the cap down the +Y side, 3 mm clear of the body.
    lv = [V(0, 0.011, 0.064), V(0, 0.022, 0.054), V(0, 0.036, 0.034), V(0, 0.0425, 0.010), V(0, 0.0420, -0.008), V(0, 0.0390, -0.020)]
    sweep(part, "steel", lv, rrect(0.014, 0.002, 0.0006, 1), hint=(1, 0, 0), **STEEL)
    return part


# ---- the bola ---------------------------------------------------------------------------------------------------------


def pouch(part, centre, toward, r=0.034):
    """A stone sewn into a hide pouch, its gathered mouth toward `toward` (a direction) and tied there with cord."""
    d = V(*toward).normalized()
    c = V(*centre)
    stations = [(-1.0, 0.3), (-0.75, 0.78), (-0.2, 1.0), (0.4, 0.92), (0.82, 0.5), (1.05, 0.22), (1.25, 0.26)]
    path = [c + d * (r * s) for s, _ in stations]
    secs = [circle(r * w, 6) for _, w in stations]
    sweep(part, "hide", path, secs, hint=(0, 1, 0) if abs(d.y) < 0.9 else (1, 0, 0), uv="wrap")
    # The tie round the gathered neck.
    tube(part, "lashing", [c + d * r * 0.98, c + d * r * 1.06, c + d * r * 1.14], [r * 0.30, r * 0.33, r * 0.30], 6,
         hint=(0, 1, 0) if abs(d.y) < 0.9 else (1, 0, 0))
    return c + d * r * 1.25


def bola_part(name, lying):
    rng = random.Random(3)
    part = Part(name, ["hide", "lashing"])
    knot = V(0, 0.016, 0) if lying else V(0, 0, 0)
    if lying:
        # Spread in a slack Y on the ground, each cord gently curved.
        ends = []
        for k in range(3):
            a = math.pi / 2 + 2 * math.pi * k / 3 + rng.uniform(-0.15, 0.15)
            d = V(math.cos(a), 0, math.sin(a))
            side = V(-d.z, 0, d.x)
            c = knot * 0 + d * 0.40 + V(0, 0.034, 0)
            neck = pouch(part, c, -d)
            # Slack: each cord lies in an S, as it fell.
            wave = rng.choice((-1, 1)) * rng.uniform(0.05, 0.08)
            low = V(0, 0.0035 - 0.016, 0)
            cord(part, bezier(knot + d * 0.010, knot + d * 0.15 + side * wave + low, knot + d * 0.26 - side * wave + low, neck + V(0, -0.012, 0), 5),
                 0.0035, 4, hint=(0, 1, 0))
            ends.append(c)
        loop_at = knot + V(0.0, 0.0, 0.0)
        loop = [loop_at + V(0.016 * math.sin(t), -0.012 + 0.0002 * k, -0.030 - 0.022 * math.cos(t) + 0.022) for k, t in enumerate([2 * math.pi * k / 9 for k in range(9)])]
    else:
        ends = []
        # Held by the knot, the cords running forward along +Z, fanning a little, the pouches bunched at their ends.
        for k in range(3):
            a = math.pi / 2 + 2 * math.pi * k / 3
            off = V(0.058 * math.cos(a), 0.058 * math.sin(a), 0)
            c = V(0, 0, 0.400) + off
            neck = pouch(part, c, (-off.x * 2.2, -off.y * 2.2, -1.0))
            cord(part, bezier(knot + V(0, 0, 0.010), knot + V(0, 0, 0.12) + off * 0.15, neck - V(0, 0, 0.12) + off * 0.1, neck, 4), 0.0035, 5, hint=(1, 0, 0))
            ends.append(c)
        loop = [V(0.014 * math.sin(t), 0.004 * math.cos(t), -0.028 + 0.028 * math.cos(t)) for t in [2 * math.pi * k / 9 for k in range(9)]]
    # The knot: a fat wad of cord.
    tube(part, "lashing", [knot + V(0, 0, -0.016), knot + V(0, 0, -0.006), knot + V(0, 0, 0.006), knot + V(0, 0, 0.016)],
         [0.008, 0.015, 0.015, 0.009], 6, hint=(0, 1, 0))
    # The loop to hold, hanging back from the knot.
    cord(part, loop + [loop[0] + V(0.0001, 0, 0)], 0.003, 5, hint=(0, 1, 0))
    return part, knot, ends


def bola_far(name, knot, ends):
    """
    The bola's far level, made by hand: 48 triangles, three pouches as eight-sided lumps on three straight cords. What
    the build would make of the near one at that budget loses whole pouches, more than a hand's width (asset.ts).
    """
    part = Part(f"{name}_LOD1", ["hide", "lashing"])
    flat = lambda n, corners: [(p.x / 0.2, p.z / 0.2) for p in corners]
    for c in ends:
        r = 0.034
        knapped(part, "hide", [c + V(r, 0, 0), c - V(r, 0, 0), c + V(0, r, 0), c - V(0, r, 0), c + V(0, 0, r), c - V(0, 0, r)], flat)
        d = (c - knot).normalized()
        tube(part, "lashing", [knot, c - d * r * 0.9], 0.0045, 3, hint=(0, 1, 0) if abs(d.y) < 0.9 else (1, 0, 0))
    return part


# ---- the arrow and the dart -------------------------------------------------------------------------------------------


def arrow():
    rng = random.Random(17)
    part = Part("arrow", ["wood", "flint", "hide"])
    tube(part, "wood", [V(0, 0, -0.708), V(0, 0, -0.400), V(0, 0, -0.030)], [0.0045, 0.0046, 0.0045], 7, hint=(0, 1, 0), uv="wrap")
    # The nock: the shaft swelling a little round its slot, the slot two lips.
    for sx in (-1, 1):
        sweep(part, "wood", [V(sx * 0.003, 0, -0.722), V(sx * 0.003, 0, -0.706)], rrect(0.003, 0.010, 0.001, 1), hint=(0, 1, 0))
    tube(part, "wood", [V(0, 0, -0.712), V(0, 0, -0.700)], [0.0055, 0.0048], 7, hint=(0, 1, 0))
    leaf_point(part, rng, -0.006, 0.012, 0.050, 0.012, 0.003, n=8, scatter=5)
    # The hide thong bound over the split end.
    tube(part, "hide", [V(0, 0, -0.036), V(0, 0, -0.033), V(0, 0, -0.004), V(0, 0, -0.001)], [0.0048, 0.0065, 0.0065, 0.0050], 7, hint=(0, 1, 0))
    # Three cut-leather vanes, one pointing to +Y, each a long low shield 2 mm thick.
    for k in range(3):
        a = math.pi / 2 + 2 * math.pi * k / 3
        out = V(math.cos(a), math.sin(a), 0)
        side = V(-out.y, out.x, 0)
        prof = [(-0.700, 0.004), (-0.690, 0.016), (-0.665, 0.018), (-0.630, 0.014), (-0.600, 0.004)]
        verts = []
        for z, h in prof:
            for e in (-1, 1):
                for r in (0.0035, 0.0035 + h):
                    verts.append(part.vert(out * r + side * e * 0.001 + V(0, 0, z)))
        # Each station's four corners: (left in, left out, right in, right out).
        rows = [verts[i * 4:(i + 1) * 4] for i in range(len(prof))]
        tile = 0.2
        for i in range(len(prof) - 1):
            a0, b0 = rows[i], rows[i + 1]
            za, zb = prof[i][0] / tile, prof[i + 1][0] / tile
            ha, hb = prof[i][1] / tile, prof[i + 1][1] / tile
            # Right face (+side), left face, outer edge.
            part.add([a0[2], b0[2], b0[3], a0[3]], [(za, 0), (zb, 0), (zb, hb), (za, ha)], "hide", False)
            part.add([a0[0], a0[1], b0[1], b0[0]], [(-za, 0), (-za, ha), (-zb, hb), (-zb, 0)], "hide", False)
            part.add([a0[1], a0[3], b0[3], b0[1]], [(za, 0.5), (za, 0.51), (zb, 0.51), (zb, 0.5)], "hide", False)
            part.add([a0[0], b0[0], b0[2], a0[2]], [(za, 0.6), (zb, 0.6), (zb, 0.61), (za, 0.61)], "hide", False)
        for r, flip in ((rows[0], True), (rows[-1], False)):
            q = [r[0], r[2], r[3], r[1]]
            part.add(q[::-1] if not flip else q, [(0.7, 0.7), (0.71, 0.7), (0.71, 0.71), (0.7, 0.71)], "hide", False)
    return part


def dart():
    part = Part("dart", ["steel", "hide"])
    tube(part, "steel", [V(0, 0, -0.002), V(0, 0, 0.008), V(0, 0, 0.014)], [0.0015, 0.0013, 0.0002], 6, hint=(0, 1, 0), **BRIGHT)
    tube(part, "steel", [V(0, 0, -0.010), V(0, 0, 0.000)], 0.0075, 8, hint=(0, 1, 0), **STEEL)
    tube(part, "steel", [V(0, 0, -0.090), V(0, 0, -0.010)], 0.0065, 8, hint=(0, 1, 0), **BRASS)
    tube(part, "steel", [V(0, 0, -0.100), V(0, 0, -0.090)], 0.0070, 8, hint=(0, 1, 0), **STEEL)
    # The fringe: eight flat strips of hide spreading back from the end cap.
    for k in range(8):
        a = 2 * math.pi * k / 8 + 0.2
        out = V(math.cos(a), math.sin(a), 0)
        sweep(part, "hide", [V(0, 0, -0.098) + out * 0.004, V(0, 0, -0.130) + out * 0.009, V(0, 0, -0.165) + out * 0.015],
              rrect(0.0012, 0.006, 0.0004, 1), hint=tuple(out), uv="wrap")
    return part


g = grenade()
g.build()
# The live grenade stands on its base, its fuse cap up: the held one turned a quarter about x and lifted onto y = 0.
lo = min(p.z for p in g.verts)
g.name = "grenade_thrown"
g.build(transform=lambda p: V(p.x, p.z - lo, -p.y))
held, knot, ends = bola_part("bola", False)
held.build()
bola_far("bola", knot, ends).build()
lying, knot, ends = bola_part("bola_lying", True)
low = min(p.y for p in lying.verts)
lying.build(transform=lambda p: V(p.x, p.y - low, p.z))
bola_far("bola_lying", knot, ends).build(transform=lambda p: V(p.x, max(p.y - low, 0.0), p.z))
for p in (g, held, lying, arrow(), dart()):
    if p.name in ("arrow", "dart"):
        p.build()
    print(f"{p.name}: {p.triangles()} triangles")

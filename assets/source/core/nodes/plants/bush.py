# The berry bush (core:bush): a rounded shrub of glossy leafy sprays on a few woody stems from one crown, berry clusters
# at the tips of the outer sprays where a hand reaches them, the most exposed hanging loose bunches. Berries are colour
# region 0, the kind's colour, on every level, so one bush carries any berry.
#
# The frame: three to five stems rise from a crown just below the ground and fork into branches; each branch carries,
# on twigs of their own, the sprays of its part of the crown. The sprays lie in the crown's shell like scales, facing
# out; a second shell of older sprays inside, in shade, fills what shows through the gaps. A window or two is left open.

import math

from mathutils import Vector

import kit
from tones import tone

ATLAS = "bush"
BERRY = "region0"
UP = Vector((0, 0, 1))


def surface(v, u):
    """The point of the bush's outline in the direction u (a unit vector), and that outline's middle."""
    H, W, D = v["height"], v["width"], v["depth"]
    lean = v.get("lean", (0.0, 0.0))
    centre = Vector((lean[0], lean[1], H * 0.5))
    # Flatter on top than below, where the skirt of sprays hangs nearly to the ground, drawn in toward the stems.
    narrow = 1.0 + 0.35 * min(u.z, 0.0)
    return centre + Vector((u.x * W / 2 * narrow, u.y * D / 2 * narrow, u.z * H * (0.5 if u.z > 0 else 0.42))), centre


def frame(v, rng, sp):
    """Stems, branches and sprays of one individual. Each stem forks into branches toward its share of the outline, and
    each branch carries the sprays that reach it, so every spray grows from wood; a few windows are left open."""
    H = v["height"]
    scale = v.get("scale", 1.0)
    berried = [n for n in sp if n.startswith("spray") and not n.endswith("_bare")]
    inner = [n for n in sp if n.startswith("inner")] or [n + "_bare" for n in berried]
    golden = math.pi * (3 - math.sqrt(5))
    # Windows: one or two ways through the outline left open, as a real shrub has.
    windows = []
    for _ in range(v.get("windows", 2)):
        a = rng.uniform(0, 2 * math.pi)
        z = rng.uniform(-0.1, 0.5)
        r = math.sqrt(1 - z * z)
        windows.append(Vector((math.cos(a) * r, math.sin(a) * r, z)))
    # Where the sprays reach: spread over the outline, a little more round its wide middle than on top, none in a
    # window.
    dirs = []
    per = v["sprays"]
    for i in range(per * 2):
        if len(dirs) == per:
            break
        z = 1 - (i + 0.5) / per * 1.7
        if z < -1:
            z = rng.uniform(-0.6, 0.9)
        z = math.copysign(abs(z) ** 1.15, z)
        z = max(-0.6, min(0.97, z + rng.uniform(-0.05, 0.05)))
        r = math.sqrt(max(0.0, 1 - z * z))
        a = i * golden + rng.uniform(-0.3, 0.3)
        d = Vector((math.cos(a) * r, math.sin(a) * r, z))
        if any(d.dot(w) > math.cos(math.radians(8)) for w in windows):
            continue
        dirs.append(d)

    n_stems = v["stems"]
    heads = []
    for k in range(n_stems):
        a = 2 * math.pi * (k + rng.uniform(-0.25, 0.25)) / n_stems
        out = rng.uniform(0.15, 0.4)
        heads.append((a, Vector((math.cos(a) * out, math.sin(a) * out, 1)).normalized()))
    groups = [[] for _ in range(n_stems)]
    for d in dirs:
        a = math.atan2(d.y, d.x)
        k = min(range(n_stems), key=lambda j: abs(math.remainder(a - heads[j][0], 2 * math.pi)))
        groups[k].append(d)

    stems, branches, sprays = [], [], []
    r0 = v.get("stem_radius", 0.02)
    for k, (a, lean) in enumerate(heads):
        if not groups[k]:
            continue
        foot = Vector((math.cos(a) * 0.03, math.sin(a) * 0.03, -0.08))
        fork = foot + lean * (H * rng.uniform(0.3, 0.42) / lean.z)
        bend = Vector((math.cos(a + 1.3), math.sin(a + 1.3), 0)) * rng.uniform(-0.04, 0.04)
        rk = r0 * rng.uniform(0.85, 1.15)
        stems.append(([foot, foot.lerp(fork, 0.35) + bend, foot.lerp(fork, 0.7) - bend * 0.5, fork], [rk, rk * 0.9, rk * 0.78, rk * 0.66]))
        # The stem's reach split among two or three branches, each taking the sprays nearest it.
        ds = groups[k]
        nb = max(1, min(3, round(len(ds) / 3.5)))
        cents = [ds[int(j * len(ds) / nb)] for j in range(nb)]
        for _ in range(4):
            parts = [[] for _ in range(nb)]
            for d in ds:
                parts[max(range(nb), key=lambda j: d.dot(cents[j]))].append(d)
            cents = [sum(p, Vector()).normalized() if p else cents[j] for j, p in enumerate(parts)]
        for part in parts:
            if not part:
                continue
            reach = [surface(v, d)[0] for d in part]
            mid = sum(reach, Vector()) / len(reach)
            bp = fork.lerp(mid, rng.uniform(0.35, 0.5)) + UP * rng.uniform(0.0, 0.06)
            branches.append(([fork, fork.lerp(bp, 0.5) + bend * 0.5, bp], [rk * 0.62, rk * 0.5, rk * 0.4]))
            for d in part:
                # Each spray lies in the crown's shell like a scale: its middle inside the outline, running along it,
                # mostly upward, its tip lifted well off, and facing out, so from any side the sprays across the crown
                # face the eye and those at its edge show their leaves splayed out against the sky.
                rim, centre = surface(v, d)
                name = rng.pick(berried)
                length = sp[name]["metres"] * scale * rng.uniform(0.8, 1.05)
                out = Vector((d.x / (v["width"] / 2), d.y / (v["depth"] / 2), d.z / (H * 0.5))).normalized()
                up = UP - out * out.dot(UP)
                if up.length < 0.2:
                    up = Vector((math.cos(a), math.sin(a), 0))
                up.normalize()
                spin = rng.uniform(-1.2, 1.2)
                # Over the top the sprays lie nearly flat, closing the crown, rather than rising round an open middle.
                lift = rng.uniform(0.1, 0.25) if d.z > 0.75 else rng.uniform(0.5, 0.9)
                along = (up * math.cos(spin) + out.cross(up) * math.sin(spin) + out * lift).normalized()
                mid = centre + (rim - centre) * rng.uniform(0.7, 0.82)
                anchor = mid - along * length * 0.5
                anchor.z = max(anchor.z, H * 0.12)
                # Its face out, the low ones tilted up toward an eye above them, turned 10 to 30 degrees one way or the
                # other and folded, so no two neighbours lie in one plane.
                face = out + (UP * 0.7 if d.z < -0.15 else Vector())
                face = face - along * face.dot(along)
                if face.length < 1e-3:
                    face = Vector((math.cos(a), math.sin(a), 0))
                face.normalize()
                turn = math.radians(rng.uniform(10, 30)) * (1 if rng.chance(0.5) else -1)
                face = (face * math.cos(turn) + along.cross(face) * math.sin(turn)).normalized()
                bears = rng.chance(v.get("berried", 0.75)) and d.z > -0.1
                sprays.append({"anchor": anchor, "along": along, "face": face, "length": length, "bend": rng.uniform(-0.35, 0.05), "fold": rng.uniform(0.3, 0.5), "z": d.z, "outer": True, "branch": [bp, bp.lerp(anchor, 0.5), anchor + along * 0.03], "name": name, "bears": bears})
    # A spray whose tip stands apart from every other spray is left out, so none is seen alone.
    ends = [[s["anchor"] + s["along"] * s["length"] * f for f in (0.0, 0.5, 1.0)] for s in sprays]
    alone = [min((ends[i][2] - q).length for j, qs in enumerate(ends) if j != i for q in qs) > 0.22 for i in range(len(sprays))]
    sprays = [s for s, gone in zip(sprays, alone) if not gone]
    # Older sprays in a second shell inside the first, by the same rule, spread evenly round it: through a gap in the
    # outer sprays the eye meets leaves in shade, not the bare middle and the far side of the bush.
    n_in = v.get("inner", 7)
    for i in range(n_in):
        z = 1 - (i + 0.5) / n_in * 1.5
        r = math.sqrt(max(0.0, 1 - z * z))
        a = i * golden + rng.uniform(-0.3, 0.3)
        d = Vector((math.cos(a) * r, math.sin(a) * r, z))
        rim, centre = surface(v, d)
        name = rng.pick(inner)
        length = sp[name]["metres"] * scale * rng.uniform(0.75, 0.9)
        out = Vector((d.x / (v["width"] / 2), d.y / (v["depth"] / 2), d.z / (H * 0.5))).normalized()
        up = UP - out * out.dot(UP)
        up = up.normalized() if up.length > 0.2 else Vector((math.cos(a), math.sin(a), 0))
        spin = rng.uniform(-1.2, 1.2)
        along = (up * math.cos(spin) + out.cross(up) * math.sin(spin) + out * 0.3).normalized()
        mid = centre + (rim - centre) * rng.uniform(0.45, 0.6)
        anchor = mid - along * length * 0.5
        anchor.z = max(anchor.z, H * 0.12)
        face = (out - along * out.dot(along)).normalized()
        sprays.append({"anchor": anchor, "along": along, "face": face, "length": length, "bend": -0.15, "fold": 0.3, "z": d.z, "outer": False, "branch": None, "name": name, "bears": False})
    return stems + branches, sprays


def build(v, picked=False):
    """Every level of one individual. With `picked`, the same bush after a survivor has stripped it."""
    rng = kit.Rng(v["seed"])
    sp = kit.sprites(ATLAS)
    stems, sprays = frame(v, rng, sp)
    H = v["height"]
    centre = Vector((0, 0, H * 0.5))
    # The outer sprays are lit as a dome over the ground rather than a ball: its foot faces out, not down.
    low = Vector((0, 0, H * 0.15))
    bark = sp["bark"]
    berried = [n for n in sp if n.startswith("spray") and not n.endswith("_bare")]
    hurt = kit.Rng(v["seed"] * 7 + 3)

    # Three greens of the palette's leaf run: the sunlit top, the sides, the inside.
    tones = {"light": kit.hexname([78 / 255, 121 / 255, 59 / 255]), "mid": kit.hexname(tone(ATLAS, "spray")), "dark": kit.hexname(tone(ATLAS, "inner"))}
    wood = kit.hexname(tone(ATLAS, "bark"))
    L = [kit.Level(True), kit.Level(False), kit.Level(False), kit.Level(False)]

    def put(name, place, tone, quad=True, berries=True, lean=0.6, inner=False):
        # The outer sprays are lit nearly as the round of the crown would be, fronts and backs alike, so a spray turned
        # edge-on is shaded as the crown round it and not as a dark blade.
        kit.card(L[0], ATLAS, name, place, ATLAS, centre if inner else low, lean if inner else 0.85, rear=0.35 if inner else 1.0)
        # Flat too the inner shell fills the gaps in the outer, in shade.
        kit.card(L[1], ATLAS, name, place, tones[tone], centre)
        # Far off every other spray does, a third larger.
        far = quad and len(tips) % 2 == 1
        if far:
            big = kit.Place(place.origin, place.a, place.n, place.length * 1.3, place.bend)
            kit.card(L[2], ATLAS, name, big, tones[tone], centre, outline="quad")
        if berries:
            for b in clusters(sp[name].get("berries", []), 1):
                p, n = place.point(b[0], b[1])
                # Flat, a cluster is two beads, round enough not to read as chips; far off, one small solid.
                if berries == "beads":
                    kit.blob(L[1], p + n * 0.04, 0.032, BERRY, turn=rng.uniform(0, 3), kind="ball")
                if far:
                    kit.blob(L[2], p + n * 0.01, max(b[2], 0.03) * place.length * 0.7, BERRY, kind="tetra", turn=rng.uniform(0, 3))

    def hang(name, place):
        """A bunch in front of the spray's biggest cluster, hanging from it: two cards crossed, so it is round from
        every side."""
        cl = clusters(sp[name].get("berries", []), 1)
        s_, t_ = (cl[0][0], cl[0][1]) if cl else (0.0, 0.8)
        p, n = place.point(s_, t_)
        bunch = rng.pick(bunches)
        size = sp[bunch]["metres"] * rng.uniform(0.9, 1.15)
        down = (-UP + n * 0.35).normalized()
        across = down.cross(UP)
        across = across.normalized() if across.length > 1e-3 else Vector((1, 0, 0))
        top = p + n * 0.05 + UP * size * 0.2
        kit.spindle(L[0], [p, p.lerp(top, 0.5) + UP * 0.01, top], 0.003, 3, ATLAS, bark)
        for face in (n - down * n.dot(down), across):
            kit.card(L[0], ATLAS, bunch, kit.Place(top, down, face.normalized(), size, 0.0), ATLAS, centre, 0.5)
        # Flat, a ball of berry colour where the bunch hangs, clear of the leaves.
        kit.blob(L[1], top + down * size * 0.5 + n * 0.02, 0.045, BERRY, turn=rng.uniform(0, 3), kind="ball")


    tips = []
    # The most exposed bearing sprays, high and outside, each hang a bunch of berries clear of their leaves.
    bunches = [n for n in sp if n.startswith("bunch")]
    bearing = [s for s in sprays if s["outer"] and s["bears"] and s["z"] > -0.2]
    bearing.sort(key=lambda s: -(s["z"] + rng.uniform(0, 0.8)))
    hung = set(id(s) for s in bearing[: v.get("bunches", 10)]) if bunches and not picked else set()
    for s in sprays:
        place = kit.Place(s["anchor"], s["along"], s["face"], s["length"], s["bend"], s.get("fold", 0.0))
        if not s["outer"]:
            put(s["name"], place, "dark", quad=False, berries=False, inner=True)
            continue
        name, bears = s["name"], s["bears"]
        if picked:
            fate = hurt.next()
            if fate < 0.12:
                # Snapped and hanging from its branch, or torn off and lying under the bush.
                if hurt.chance(0.5):
                    hang = (s["along"] - UP * 1.6).normalized()
                    place = kit.Place(s["anchor"], hang, s["face"], s["length"] * 0.9, 0.35)
                    put(name + "_bare", place, "dark", berries=False)
                else:
                    out = Vector((s["anchor"].x, s["anchor"].y, 0)).normalized()
                    foot = out * v["width"] * hurt.uniform(0.35, 0.6) + Vector((0, 0, 0.012))
                    flat = (out + Vector((hurt.uniform(-0.8, 0.8), hurt.uniform(-0.8, 0.8), 0))).normalized()
                    lie = kit.Place(foot, flat, UP, s["length"] * 0.8, 0.0)
                    fallen = "fallen1" if "fallen1" in sp else name + "_bare"
                    put(fallen, lie, "dark", berries=False, lean=0.1)
                continue
            if fate < 0.26 and "stripped1" in sp:
                put(rng.pick([n for n in sp if n.startswith("stripped")]), place, "mid", berries=False)
                tips.append(place.tip())
                continue
            put(name + "_bare", place, "mid" if s["z"] < 0.4 else "light", berries=False)
        else:
            put(name if bears else name + "_bare", place, "light" if s["z"] > 0.4 else "mid", berries=("beads" if id(s) not in hung and s["z"] > 0.25 else True) if bears else False)
            if id(s) in hung:
                hang(name, place)
        # The twig each spray grows on, from its branch.
        if s["branch"]:
            r = v.get("stem_radius", 0.02) * 0.45
            kit.spindle(L[0], s["branch"], r, 3, ATLAS, bark)
            if s["z"] < 0.1:
                kit.spindle(L[1], s["branch"], r, 3, wood)
        tips.append(place.tip())
    if picked:
        # Leaves stripped off and dropped round the foot of the bush.
        singles = [n for n in sp if n.startswith("leaf")]
        for i in range(v.get("litter", 6) if singles else 0):
            a = hurt.uniform(0, 2 * math.pi)
            r = v["width"] * hurt.uniform(0.25, 0.65)
            foot = Vector((math.cos(a) * r, math.sin(a) * r, 0.01))
            flat = Vector((math.cos(a + hurt.uniform(-2, 2)), math.sin(a + hurt.uniform(-2, 2)), 0.02)).normalized()
            put(hurt.pick(singles), kit.Place(foot, flat, UP, 0.08, 0.0), "dark", quad=False, berries=False, lean=0.0)

    for pts, radii in stems:
        main = len(pts) > 3
        kit.tube(L[0], pts, radii, 4 if main else 3, ATLAS, bark)
        kit.tube(L[1], pts, radii, 3, wood)

    # The coarsest: a lump through the sprays' tips, and the berries as a few points of colour on its crown.
    tips = sorted(tips, key=lambda p: -(p - centre).length)[:11] + [Vector((0, 0, -0.05))]
    kit.hull(L[3], tips, tones["mid"])
    if not picked:
        crown = sorted(tips, key=lambda p: -p.z)[:3]
        for p in crown:
            kit.blob(L[3], p.lerp(centre, 0.15), H * 0.08, BERRY, kind="tetra", turn=rng.uniform(0, 3))
    return L


def clusters(berries, most):
    """Berries gathered into at most `most` clusters, each as its middle and a radius that holds it."""
    if not berries:
        return []
    groups = [[b] for b in berries]
    while len(groups) > most:
        best = None
        for i in range(len(groups)):
            for j in range(i + 1, len(groups)):
                ci, cj = mean(groups[i]), mean(groups[j])
                d = (ci[0] - cj[0]) ** 2 + (ci[1] - cj[1]) ** 2
                if best is None or d < best[0]:
                    best = (d, i, j)
        _, i, j = best
        groups[i] += groups.pop(j)
    out = []
    for g in groups:
        c = mean(g)
        r = max(math.hypot(b[0] - c[0], b[1] - c[1]) + b[2] for b in g)
        out.append((c[0], c[1], r * 0.75))
    return out


def mean(g):
    return (sum(b[0] for b in g) / len(g), sum(b[1] for b in g) / len(g))

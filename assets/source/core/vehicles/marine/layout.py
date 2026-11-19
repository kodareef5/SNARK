"""A vessel's own pictures. The faces each material lays out are cut into charts by what they are, the way they face and
where they lie along the hull, and the charts are packed onto the material's square at one size a metre, as
../compact/parts.py lays out the car: every texel of those pictures is one place on the vessel, which the painters in
each family folder paint from its position (bake.py, surface.py). The family's tiled pictures keep their own UVs.

Coordinates are the engine's (X port, Y up, Z bow) until the shipyard turns the mesh into Blender's frame."""
import hashlib
import json
import math
import os

import bmesh
from mathutils import Vector

from parts import AXES, basis, pack

# A chart runs no further than this along the hull, in metres, so that a long topside packs among the others.
PIECE = 5.0


def chart_faces(bm, chosen, key):
    """Groups of connected faces of `chosen` (face indices) with one key, `key(face)`."""
    seen, groups = set(), []
    for f in bm.faces:
        if f.index not in chosen or f.index in seen:
            continue
        k = key(f)
        group, stack = [], [f]
        seen.add(f.index)
        while stack:
            g = stack.pop()
            group.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index in chosen and h.index not in seen and key(h) == k:
                        seen.add(h.index)
                        stack.append(h)
        groups.append((k, group))
    return groups


def tightest(corners, u, v):
    """The two directions across the chart's plane, turned from `u` and `v` the same way round, whose box about the
    corners is least, the longer side across: a curved band or a slanted panel then packs as tightly as it can."""
    best = None
    for step in range(0, 90, 3):
        a = math.radians(step)
        cu, cv = u * math.cos(a) + v * math.sin(a), v * math.cos(a) - u * math.sin(a)
        us, vs = [c.dot(cu) for c in corners], [c.dot(cv) for c in corners]
        w, h = max(us) - min(us), max(vs) - min(vs)
        if best is None or w * h < best[0] - 1e-9:
            best = (w * h, cu, cv, w, h)
    _, cu, cv, w, h = best
    return (cu, cv) if w >= h else (cv, -cu)


def lay_out(items, sizes, spare, gutter=6, sheets=1):
    """Lays out each item's faces on its material's picture. `items` is (object, material name per face, tag per face),
    a material name of None leaving the face as it is; `sizes` is each material's side in pixels; `spare(tag, axis)` how
    much less than full size a face is given, for what is seldom seen; `sheets` how many pictures across the vessel's
    tiled faces reach (`on_first_sheet`), which the pack stores every UV of the mesh over. Returns each material's pixels
    a metre."""
    charts = {m: [] for m in sizes}
    for o, mats, tags in items:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.faces.ensure_lookup_table()
        axis = {f.index: max(range(6), key=lambda a: f.normal.dot(AXES[a])) for f in bm.faces}
        chosen = {f.index for f in bm.faces if mats[f.index] is not None}

        def key(f):
            a = axis[f.index]
            # Along the hull for what faces across or up and down it; the ends' faces are short already. The bands of
            # one moulding share a chart: each texel keeps its own tag in the bake.
            piece = math.floor(f.calc_center_median().z / PIECE) if a < 4 else 0
            return (mats[f.index], a, piece)

        for k, group in chart_faces(bm, chosen, key):
            u, v = basis(k[1])
            corners = [l.vert.co for g in group for l in g.loops]
            u, v = tightest(corners, u, v)
            pts = [(c.dot(u), c.dot(v)) for c in corners]
            lo = (min(p[0] for p in pts), min(p[1] for p in pts))
            hi = (max(p[0] for p in pts), max(p[1] for p in pts))
            charts[k[0]].append({"obj": o.name, "faces": [g.index for g in group], "u": u, "v": v, "lo": lo,
                                 "size": (hi[0] - lo[0], hi[1] - lo[1]), "spare": spare(tags[group[0].index], k[1])})
        bm.free()
    density, placed = {}, {}
    for m, cs in charts.items():
        if not cs:
            continue
        # The largest size a metre at which the charts still fit, found by halving.
        lo_d, hi_d, best = 1.0, 4096.0, None
        for _ in range(26):
            d = (lo_d + hi_d) / 2
            p = pack(cs, d, sizes[m], gutter)
            if p is None:
                hi_d = d
            else:
                lo_d, best = d, p
        density[m], placed[m] = lo_d, best
    for o, mats, tags in items:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.faces.ensure_lookup_table()
        uv = bm.loops.layers.uv.verify()
        for m, cs in charts.items():
            if m not in placed:
                continue
            side, d = sizes[m], density[m]
            for c, (x, y) in zip(cs, placed[m]):
                if c["obj"] != o.name:
                    continue
                s = d * c["spare"]
                for fi in c["faces"]:
                    face = bm.faces[fi]
                    for l in face.loops:
                        pu = (l.vert.co.dot(c["u"]) - c["lo"][0]) * s + x
                        pv = (l.vert.co.dot(c["v"]) - c["lo"][1]) * s + y
                        l[uv].uv = (pu / side, 1 - pv / side)
                    unsliver(face, uv, sheets / 65535)
        bm.to_mesh(o.data)
        bm.free()
    return density


def unsliver(face, uv, step):
    """A face whose UVs, rounded to the step the pack stores them in, are not clearly wound as its chart's (which the flip
    of v leaves the other way round from the vessel's faces, so negative here) lies on a small triangle of its first
    corner's, wound as its chart's: a sliver, or a face too small or too nearly edge-on to keep its way round. A face
    with no area in the picture could take either way round once the levels are simplified."""
    q = [(round(l[uv].uv[0] / step), round(l[uv].uv[1] / step)) for l in face.loops]
    if len(q) != 3:
        return
    twice = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[1][1] - q[0][1]) * (q[2][0] - q[0][0])
    longest = max(math.dist(q[i], q[(i + 1) % 3]) for i in range(3))
    if twice > -2 * max(longest, 1):
        u, v = face.loops[0][uv].uv
        for l, (du, dv) in zip(face.loops, ((0, 0), (0, 3 * step), (3 * step, 0))):
            l[uv].uv = (u + du, v + dv)


def on_first_sheet(uvs):
    """A tiled face's UVs moved by whole sheets to begin on the first, as the game reads them (v down from the top: so
    here, Blender's v up, to end on it). The pack stores a mesh's UVs in 16 bits over the range they span, so a deck mapped
    sheet after sheet down a long yacht would store its own pictures' UVs coarsely."""
    du, dv = math.floor(min(u for u, _ in uvs)), math.ceil(max(v for _, v in uvs)) - 1
    return [(u - du, v - dv) for u, v in uvs]


def sheets_of(uvs):
    """How many pictures across tiled UVs begun on the first sheet reach, as the pack stores them (v down from the top)."""
    return max(1, math.ceil(max(max(u for u, _ in uvs), max(1 - v for _, v in uvs)) - 1e-9))


def layout_hash(objects):
    """A hash of every face's corners on the pictures, its material and its tag, which the painted pictures are for."""
    h = hashlib.sha256()
    for o in sorted(objects, key=lambda o: o.name):
        me = o.data
        uv = me.uv_layers.active.data
        tag = me.attributes["tag"].data
        for p in me.polygons:
            h.update(f"{o.name}{p.material_index}:{tag[p.index].value}".encode())
            for li in p.loop_indices:
                u, v = uv[li].uv
                h.update(f"{round(u * 4096)},{round(v * 4096)};".encode())
    return h.hexdigest()[:16]


def mark(o, tags, names, part, parts):
    """Keeps each face's tag and part on the mesh, as indices of `names` and `parts`, for the bake once joined."""
    me = o.data
    t = me.attributes.get("tag") or me.attributes.new("tag", "INT", "FACE")
    p = me.attributes.get("part") or me.attributes.new("part", "INT", "FACE")
    for i, tag in enumerate(tags):
        if tag not in names:
            names.append(tag)
        t.data[i].value = names.index(tag)
        p.data[i].value = part
    parts.append(o.name)


def check(folder, objects, names, parts, sizes):
    """Stops the build when the vessel's pictures were painted for another layout, and writes what the bake needs."""
    digest = layout_hash(objects)
    for o in objects:
        o["marine"] = json.dumps({"tags": names, "parts": parts, "sizes": sizes})
    print(f"model: layout {digest}")
    if os.environ.get("MARINE_LAYOUT") == "new":
        return digest
    known = os.path.join(folder, "tex", "layout.json")
    want = json.load(open(known))["hash"] if os.path.exists(known) else None
    # Under `bun run art` (SNARK_LAYOUT=settle) the build goes on and says the layout moved: the same model lays out
    # differently on another processor, and the art tool then keeps the committed mesh the pictures fit, or refuses if the
    # shape changed too (tools/pack/settle.ts).
    if want != digest and os.environ.get("SNARK_LAYOUT") == "settle":
        print(f"model: layout moved {digest} from {want}")
    elif want != digest:
        raise SystemExit(f"model: the layout is {digest}, and {folder}/tex was painted for {want}. Run ../marine/bake.py and the family's paint and wear scripts again")
    return digest

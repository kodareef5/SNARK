# Reads each atlas's layout and pictures and writes what the model scripts need to know of every element on it: the
# outline that holds its alpha (the card, on every level near enough to show its shape), a quadrilateral that holds it
# (the far levels), its mean colour, and where its berries are. Run with the system Python, not Blender, after an atlas changes:
#
#   python3 sprites.py [ATLAS ...]
#
# An element is placed by its anchor (where it is held: the foot of its stem) and its tip (the way it grows). Points are
# given in the element's own frame: t along the line from anchor to tip, s across it to the right, both in units of the
# element's length (its farthest alpha from the anchor along that line).

import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.spatial import ConvexHull

HERE = os.path.dirname(os.path.abspath(__file__))
# Alpha this high or more is drawn; the card holds all of it, with this many pixels to spare.
SOLID = 0.3
SPARE = 3

# How finely each sort of element is cut, by the start of its name: rows of its strip (for an element bent along its
# length) and corners of its card. A layout entry may give its own.
SHAPES = {"spray": (4, 7), "inner": (4, 7), "frond": (6, 8), "deadfrond": (5, 8), "young": (4, 8), "hang": (6, 8), "ground": (6, 8), "spear": (5, 6), "leaf": (3, 6), "fruit": (4, 6), "run": (5, 6), "bunch": (3, 6)}


def shape(name):
    best = ""
    for k in SHAPES:
        if name.startswith(k) and len(k) > len(best):
            best = k
    return SHAPES.get(best, (4, 8))


DIRS = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)]


def load(path, mode):
    return np.asarray(Image.open(path).convert(mode), dtype=np.float32) / 255.0


def frame(el):
    """The anchor, the unit along the element and the unit to its right, in picture pixels (rows run down)."""
    a = np.array(el["anchor"], dtype=np.float64)
    d = np.array(el["tip"], dtype=np.float64) - a
    d /= np.linalg.norm(d)
    # Seen on the picture, right of a direction (dx, dy) with y down is (-dy, dx).
    return a, d, np.array([-d[1], d[0]])


def strip(t, s, rows, lo, hi):
    """Rows across the element from lo to hi along it, each as wide as the points in the bands either side of it, so the
    straight edges between rows hold every point."""
    edges = np.linspace(lo, hi, rows)
    bands = []
    for i in range(rows - 1):
        sel = (t >= edges[i]) & (t <= edges[i + 1])
        bands.append((float(s[sel].min()), float(s[sel].max())) if sel.any() else None)
    out = []
    for i, ti in enumerate(edges):
        near = [b for b in (bands[i - 1] if i > 0 else None, bands[i] if i < rows - 1 else None) if b is not None]
        out.append([float(ti), min(b[0] for b in near), max(b[1] for b in near)] if near else [float(ti), 0.0, 0.0])
    return out


def trace(mask):
    """The boundary pixels of a filled blob, in order round it (Moore's neighbour tracing)."""
    m = np.pad(mask, 1)
    ys, xs = np.nonzero(m)
    start = (int(ys[0]), int(xs[0]))
    p, back = start, 6
    pts = [start]
    for _ in range(m.size):
        for i in range(1, 9):
            k = (back + i) % 8
            q = (p[0] + DIRS[k][0], p[1] + DIRS[k][1])
            if m[q]:
                prev = DIRS[(back + i - 1) % 8]
                rel = (p[0] + prev[0] - q[0], p[1] + prev[1] - q[1])
                back = DIRS.index(rel)
                p = q
                break
        else:
            break
        if p == start:
            break
        pts.append(p)
    return np.array([(x - 1 + 0.5, y - 1 + 0.5) for y, x in pts], dtype=np.float64)


def simplify(points, tol):
    """Douglas and Peucker's simplification of a closed outline."""

    def rdp(pts):
        if len(pts) < 3:
            return pts
        a, b = pts[0], pts[-1]
        ab = b - a
        n = np.linalg.norm(ab)
        d = np.linalg.norm(pts - a, axis=1) if n < 1e-9 else np.abs(ab[0] * (pts[:, 1] - a[1]) - ab[1] * (pts[:, 0] - a[0])) / n
        i = int(np.argmax(d))
        if d[i] <= tol:
            return np.array([a, b])
        return np.vstack([rdp(pts[: i + 1])[:-1], rdp(pts[i:])])

    far = int(np.argmax(np.linalg.norm(points - points[0], axis=1)))
    one = rdp(points[: far + 1])
    two = rdp(np.vstack([points[far:], points[:1]]))
    return np.vstack([one[:-1], two[:-1]])


def reduce_hull(poly, most, bounds=None):
    """A convex polygon, counter-clockwise, with corners taken away until it has `most`: each time the edge whose two
    neighbours, run on until they meet, add the least area is replaced by the point where they meet. A meeting point
    outside `bounds` (a convex polygon: the element's rectangle) is not taken, so the card never shows a neighbour."""
    poly = [tuple(map(float, p)) for p in poly]
    if _signed(poly) < 0:
        poly.reverse()
    while len(poly) > most:
        best = None
        n = len(poly)
        for i in range(n):
            p0, p1, p2, p3 = poly[i - 1], poly[i], poly[(i + 1) % n], poly[(i + 2) % n]
            x = _meet(p0, p1, p2, p3)
            if x is None or (bounds is not None and not _within(bounds, x)):
                continue
            added = abs(_signed([p1, x, p2]))
            if best is None or added < best[0]:
                best = (added, i, x)
        if best is None:
            break
        _, i, x = best
        j = (i + 1) % n
        poly[i] = x
        poly.pop(j)
    return [list(p) for p in poly]


def _within(poly, p):
    """Whether p lies in a convex polygon given counter-clockwise."""
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        if (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < -1e-9:
            return False
    return True


def _signed(poly):
    return 0.5 * sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))


def _meet(p0, p1, p2, p3):
    """Where the line on from p0 through p1 meets the line back from p3 through p2, beyond p1 and p2."""
    d1 = (p1[0] - p0[0], p1[1] - p0[1])
    d2 = (p2[0] - p3[0], p2[1] - p3[1])
    den = d1[0] * d2[1] - d1[1] * d2[0]
    if abs(den) < 1e-12:
        return None
    w = (p2[0] - p1[0], p2[1] - p1[1])
    u = (w[0] * d2[1] - w[1] * d2[0]) / den
    v = (w[0] * d1[1] - w[1] * d1[0]) / den
    if u < 0 or v < 0:
        return None
    return (p1[0] + d1[0] * u, p1[1] + d1[1] * u)


def spikes(solid, x0, y0, origin, along, right, length, count=9):
    """A fan as the flat levels draw it: the joined web of its inner part, and from it a broad tapered finger for each
    of `count` sectors of the angle it spans, each as long as the segments in its sector, with gaps toward the tips."""
    ys, xs = np.nonzero(solid)
    px = xs + x0 + 0.5 - origin[0]
    py = ys + y0 + 0.5 - origin[1]
    t = (px * along[0] + py * along[1]) / length
    s = (px * right[0] + py * right[1]) / length
    r = np.hypot(s, t)
    a = np.arctan2(s, t)
    far = r > 0.25
    lo, hi = np.percentile(a[far], 1), np.percentile(a[far], 99)
    step = (hi - lo) / count
    reach = []
    for i in range(count):
        sel = far & (np.abs(a - (lo + step * (i + 0.5))) < step / 2)
        reach.append(float(np.percentile(r[sel], 97)) if sel.any() else 0.0)
    web = 0.42 * min(x for x in reach if x > 0)

    def at(radius, angle):
        return [float(radius * np.sin(angle)), float(radius * np.cos(angle))]

    out = []
    # The web: a fan of triangles from the foot to the edge where the fingers part.
    for i in range(count):
        out.append([[0.0, 0.0], at(web, lo + step * i), at(web, lo + step * (i + 1))])
    # The fingers, each as wide as most of its sector where it leaves the web.
    for i, far_ in enumerate(reach):
        if far_ <= web:
            continue
        mid = lo + step * (i + 0.5)
        out.append([at(web, mid - step * 0.45), at(web, mid + step * 0.45), at(far_, mid)])
    return out


def feather(rows, lo, lobes=6):
    """A frond as the flat levels draw it, as separate triangles: a narrow midrib to the tip, and on each side a slim
    leaflet for each of `lobes` steps along it, its foot along the midrib and its point out at the frond's edge and
    swept toward the tip."""

    def edge(t):
        for (ta, la, ra), (tb, lb, rb) in zip(rows, rows[1:]):
            if ta <= t <= tb:
                f = (t - ta) / (tb - ta) if tb > ta else 0.0
                return la + (lb - la) * f, ra + (rb - ra) * f
        return rows[-1][1], rows[-1][2]

    def rib(t):
        return 0.02 - 0.015 * (t - lo) / (1.0 - lo)

    out = []
    step = (1.0 - lo) / lobes
    for k in range(lobes):
        t0, t1 = lo + step * k, lo + step * (k + 1)
        # The midrib, a quadrilateral a step, its last a point.
        w0, w1 = rib(t0), rib(t1) if k < lobes - 1 else 0.0
        out.append([[-w0, t0], [w0, t0], [w1, t1]])
        if w1 > 0:
            out.append([[-w0, t0], [w1, t1], [-w1, t1]])
        if k == 0:
            continue
        # Leaflets either side, their feet most of the step long.
        foot0, foot1 = t0 + step * 0.05, t0 + step * 0.9
        tip = min(1.0, t0 + step * 1.25)
        left, right = edge(tip)
        out.append([[rib(foot0), foot0], [right * 0.95, tip], [rib(foot1), foot1]])
        out.append([[-rib(foot0), foot0], [-rib(foot1), foot1], [left * 0.95, tip]])
    return [[[float(x) for x in p] for p in tri] for tri in out]


def largest(mask):
    lab, n = ndimage.label(mask)
    if n == 0:
        return None
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    return ndimage.binary_fill_holes(lab == (1 + int(np.argmax(sizes))))


def element(el, rgba, regions, size):
    x0, y0, x1, y1 = el["rect"]
    a = rgba[y0:y1, x0:x1, 3]
    solid = a >= SOLID
    if not solid.any():
        raise SystemExit(f"{el['name']}: nothing solid in its rectangle")
    origin, along, right = frame(el)

    def local(mask):
        ys, xs = np.nonzero(mask)
        px = xs + x0 + 0.5 - origin[0]
        py = ys + y0 + 0.5 - origin[1]
        return px * along[0] + py * along[1], px * right[0] + py * right[1]

    t, s = local(ndimage.binary_dilation(solid, iterations=SPARE))
    length = float(t.max())
    t, s = t / length, s / length
    lo = float(t.min())
    rows, corners = shape(el["name"])
    out = {"name": el["name"], "role": el.get("role", "spray"), "length_px": length, "lo": lo, "strip": strip(t, s, el.get("rows", rows), lo, 1.0)}

    # The card: the convex hull of every drawn pixel, cut down to a few corners by adding the least area each time.
    pts = np.stack([s, t], 1)
    box = [((x - origin[0]) * right[0] + (y - origin[1]) * right[1], (x - origin[0]) * along[0] + (y - origin[1]) * along[1]) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]
    box = [(bs / length, bt / length) for bs, bt in box]
    if _signed(box) < 0:
        box.reverse()
    out["card"] = reduce_hull(pts[ConvexHull(pts).vertices], el.get("corners", corners), box)
    # The cheapest that keeps the shape, for the flat levels, which show no picture and so may reach past the
    # element's rectangle: four corners, a leaf's diamond.
    out["card4"] = reduce_hull(pts[ConvexHull(pts).vertices], 4)
    # The far levels: fewer rows across, down to two, a quadrilateral that holds it all.
    out["strip3"] = strip(t, s, 3, lo, 1.0)
    if el["name"].startswith(("frond", "deadfrond", "young")):
        # Flat, a frond keeps its feathered edge: leaflets either side of a narrow midrib.
        out["saw"] = feather(strip(t, s, 13, lo, 1.0), lo)
    out["quad"] = strip(t, s, 2, lo, 1.0)
    if el["name"].startswith(("fan", "deadfan")):
        out["spikes"] = spikes(solid, x0, y0, origin, along, right, length, 7)
        out["spikes5"] = spikes(solid, x0, y0, origin, along, right, length, 3)
    out["area"] = float(solid.sum()) / length**2

    w = a[..., None]
    out["mean"] = [float(c) for c in (rgba[y0:y1, x0:x1, :3] * w).sum((0, 1)) / max(float(w.sum()), 1e-6)]
    out["fill"] = float(solid.sum()) / float(len(t))
    if regions is not None:
        r = regions[y0:y1, x0:x1]
        berry = (r[..., 0] > 0.5) & (r[..., 1] < 0.5) & (r[..., 2] < 0.5) & solid
        lab, n = ndimage.label(berry)
        out["berries"] = []
        for k in range(1, n + 1):
            ys, xs = np.nonzero(lab == k)
            if len(xs) < 6:
                continue
            dx, dy = xs.mean() + x0 + 0.5 - origin[0], ys.mean() + y0 + 0.5 - origin[1]
            out["berries"].append([float((dx * right[0] + dy * right[1]) / length), float((dx * along[0] + dy * along[1]) / length), float(np.sqrt(len(xs) / np.pi) / length)])
        if out["berries"]:
            bw = berry[..., None]
            out["berry_mean"] = [float(c) for c in (rgba[y0:y1, x0:x1, :3] * bw).sum((0, 1)) / max(float(bw.sum()), 1e-6)]
    # Texture coordinates of the anchor, and of a unit along and to the right. Blender's v runs up the picture.
    out["uv"] = {
        "origin": [float(origin[0] / size), float(1 - origin[1] / size)],
        "along": [float(along[0] * length / size), float(-along[1] * length / size)],
        "right": [float(right[0] * length / size), float(-right[1] * length / size)],
    }
    return out


def atlas(name):
    folder = os.path.join(HERE, "tex", name)
    with open(os.path.join(folder, "layout.json")) as f:
        layout = json.load(f)
    rgba = load(os.path.join(folder, f"{name}_base.png"), "RGBA")
    size = rgba.shape[0]
    reg_path = os.path.join(folder, f"{name}_regions.png")
    regions = load(reg_path, "RGB") if os.path.exists(reg_path) else None
    out = {"size": size, "elements": {}}
    for el in layout["elements"]:
        if el.get("role") == "bark":
            x0, y0, x1, y1 = el["rect"]
            out["elements"][el["name"]] = {"name": el["name"], "role": "bark", "u": [x0 / size, x1 / size], "metres": el.get("metres", 1.0), "mean": [float(c) for c in rgba[y0:y1, x0:x1, :3].mean((0, 1))]}
            continue
        if el.get("role") == "band":
            # A band across the whole picture, repeating from left to right. Blender's v runs up the picture.
            x0, y0, x1, y1 = el["rect"]
            out["elements"][el["name"]] = {"name": el["name"], "role": "band", "v": [1 - y1 / size, 1 - y0 / size], "metres": el.get("metres", 1.0), "mean": [float(c) for c in rgba[y0:y1, x0:x1, :3].mean((0, 1))]}
            continue
        if el.get("role") == "patch":
            # A square laid over a surface from above; it does not repeat. Texture coordinates of its corners, a few
            # pixels in so a far copy of the picture does not take in its neighbours.
            x0, y0, x1, y1 = el["rect"]
            inset = 6
            out["elements"][el["name"]] = {"name": el["name"], "role": "patch", "uv": [(x0 + inset) / size, 1 - (y1 - inset) / size, (x1 - inset) / size, 1 - (y0 + inset) / size], "metres": el.get("metres", 1.0), "mean": [float(c) for c in rgba[y0:y1, x0:x1, :3].mean((0, 1))]}
            continue
        e = element(el, rgba, regions, size)
        for key in ("twin", "metres"):
            if key in el:
                e[key] = el[key]
        out["elements"][el["name"]] = e
    with open(os.path.join(folder, "sprites.json"), "w") as f:
        json.dump(out, f, indent=1)
    print(f"{name}: {len(out['elements'])} elements")


if __name__ == "__main__":
    names = sys.argv[1:] or sorted(d for d in os.listdir(os.path.join(HERE, "tex")) if os.path.exists(os.path.join(HERE, "tex", d, "layout.json")))
    for n in names:
        atlas(n)

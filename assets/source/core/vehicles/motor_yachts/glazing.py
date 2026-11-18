"""Fracture facets and shards seated in a baked pane perimeter."""
from functools import lru_cache
import numpy as np
from scipy.spatial import ConvexHull
from paint import smooth


def cells(u, v, scale, seed):
    # Two nearest irregular seeds give both a facet and the line separating it from its neighbour.
    x, y = u/scale, v/scale
    ix, iy = np.floor(x).astype("i"), np.floor(y).astype("i")
    first = np.full_like(u, 8)
    second = first.copy()
    value = np.zeros_like(u)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            key = ((ix+dx)*23497 + (iy+dy)*79319 + seed*491) % 65521
            key = (key.astype("int64") * (key+19)) % 65521
            jitter = (key % 193)/193
            fx = ix+dx+.17+.66*jitter
            fy = iy+dy+.17+.66*((key//193) % 157)/157
            d2 = ((x-fx)**2 + (y-fy)**2).astype("f")
            nearer = d2 < first
            second = np.minimum(second, np.maximum(first, d2))
            value = np.where(nearer, jitter, value)
            first = np.minimum(first, d2)
    return np.sqrt(second)-np.sqrt(first), value


@lru_cache(maxsize=256)
def frame_shards(boat, part):
    edges = boat.glass_edges[part]
    if not edges:
        return np.zeros(3), np.eye(3)[:2], []
    ends = np.unique(np.stack([a for a, _ in edges]+[a+d for a, d in edges]), axis=0)
    centre = ends.mean(0)
    _, lengths, axes = np.linalg.svd(ends-centre, full_matrices=False)
    if len(ends)<3 or lengths[1]<.00001:
        return centre, np.eye(3)[:2], []
    axis = np.cross(axes[-1], (0, 1, 0))
    basis = (np.stack((axis/np.linalg.norm(axis), [0,1,0])) if np.linalg.norm(axis)>.06 else axes[:2])
    uv = np.column_stack([((ends-centre)*row).sum(1) for row in basis])
    ring = uv[ConvexHull(uv).vertices]
    size = np.ptp(ring, axis=0)
    lengths = np.linalg.norm(np.roll(ring, -1, axis=0)-ring, axis=1)
    perimeter = np.r_[0, np.cumsum(lengths)]
    rng = np.random.default_rng(7519+part)
    def border(t):
        t = t%perimeter[-1]
        j = np.searchsorted(perimeter, t, side="right")-1
        return ring[j]+(ring[(j+1)%len(ring)]-ring[j])*(t-perimeter[j])/lengths[j]
    pieces = []
    for j in range(rng.integers(3, 7)):
        # Root both ends in the real perimeter. The broken edges meet at an off-centre tip.
        t = rng.uniform(0, perimeter[-1])
        width = rng.uniform(.05,.18)*min(size.max(), 2.3)
        left, mid, right = border(t-width), border(t), border(t+width)
        root = (left+right)*.5
        inward = ring.mean(0)-root
        inward /= max(.001, np.linalg.norm(inward))
        depth = rng.uniform(.12,.62)*min(size.min(), .94)
        tip = root + inward*depth + (right-left)*rng.uniform(-.83,.85)
        pieces.append((left, mid, right, tip, rng.uniform(0,1)))
    return centre, basis, pieces


def triangle(u, v, a, b, c, step):
    sense = np.sign((b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]))
    if not sense:
        return np.zeros_like(u)
    sides = []
    for start, end in ((a,b), (b,c), (c,a)):
        dx, dy = end-start
        sides.append(sense*(dx*(v-start[1])-dy*(u-start[0]))/max(.0001, np.hypot(dx,dy)))
    return smooth(.5+np.minimum.reduce(sides)/step)



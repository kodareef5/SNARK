"""One of a vessel's own pictures as texels: where each lies on the vessel, what it is, and fields worked out from those,
from the bake (bake.py). The painters work on these. Texels no triangle covers take the values of the nearest one that
is covered, so the gutters round each chart carry its colours into the smaller mips.

    from surface import Surface
    s = Surface("<vessel folder>/tex/bakes", "hull")
    s.P, s.N        positions and normals in the engine's frame (X port, Y up, Z bow), metres, one row a texel
    s.TAG, s.PART   indices into s.tags and s.parts (the shipyard's tag of each face, and the part it was built as)
    s.AO            how much of the sky each texel sees within the bake's reach, 0 to 1
    s.MPT           metres a texel spans there; s.covered whether a triangle covers it
    s.where(*tags)  texels with any of those tags
"""
import math
import os

import numpy as np
from PIL import Image
from scipy import ndimage


class Surface:
    def __init__(self, bakes, name):
        d = np.load(os.path.join(bakes, f"{name}.npz"))
        self.name = name
        self.size = S = int(d["size"])
        self.tags = [str(t) for t in d["tags"]]
        self.parts = [str(p) for p in d["parts"]]
        uv = d["uv"] * S
        tag = np.full((S, S), -1, np.int16)
        part = np.zeros((S, S), np.int16)
        pos = np.zeros((S, S, 3), np.float32)
        nrm = np.zeros((S, S, 3), np.float32)
        mpt = np.zeros((S, S), np.float32)
        for t in range(len(uv)):
            a, b, c = uv[t]
            x0, x1 = int(max(math.floor(min(a[0], b[0], c[0]) - .5), 0)), int(min(math.ceil(max(a[0], b[0], c[0]) + .5), S - 1))
            y0, y1 = int(max(math.floor(min(a[1], b[1], c[1]) - .5), 0)), int(min(math.ceil(max(a[1], b[1], c[1]) + .5), S - 1))
            den = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])
            if abs(den) < 1e-9:
                continue
            X, Y = np.meshgrid(np.arange(x0, x1 + 1) + .5, np.arange(y0, y1 + 1) + .5)
            w1 = ((X - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (Y - a[1])) / den
            w2 = ((b[0] - a[0]) * (Y - a[1]) - (X - a[0]) * (b[1] - a[1])) / den
            w0 = 1 - w1 - w2
            inside = (w0 >= -1e-4) & (w1 >= -1e-4) & (w2 >= -1e-4)
            if not inside.any():
                continue
            ys, xs = np.nonzero(inside)
            W = np.stack([w0[inside], w1[inside], w2[inside]], 1)
            P, N = d["pos"][t].astype(np.float64), d["nrm"][t].astype(np.float64)
            yy, xx = ys + y0, xs + x0
            pos[yy, xx] = np.einsum("ij,jk->ik", W, P)
            nn = np.einsum("ij,jk->ik", W, N)
            nrm[yy, xx] = nn / np.linalg.norm(nn, axis=1, keepdims=True).clip(1e-6)
            tag[yy, xx] = d["tag"][t]
            part[yy, xx] = d["part"][t]
            area3 = np.linalg.norm(np.cross(P[1] - P[0], P[2] - P[0])) / 2
            mpt[yy, xx] = math.sqrt(area3 / (abs(den) / 2))
        self.covered = tag >= 0
        idx = ndimage.distance_transform_edt(~self.covered, return_distances=False, return_indices=True)
        fill = lambda a: a[idx[0], idx[1]]
        self.tag, self.part, self.pos, self.nrm, self.mpt = fill(tag), fill(part), fill(pos), fill(nrm), fill(mpt)
        occ = np.asarray(Image.open(os.path.join(bakes, f"{name}_occlusion.png")), np.float32)
        if occ.ndim == 3:
            occ = occ[..., 0]
        self.ao = fill(np.where(self.covered, (occ / (65535.0 if occ.max() > 255 else 255.0)).clip(0, 1), 0))
        self.n = S * S
        self.P = self.pos.reshape(-1, 3)
        self.N = self.nrm.reshape(-1, 3)
        self.TAG = self.tag.reshape(-1)
        self.PART = self.part.reshape(-1)
        self.AO = self.ao.reshape(-1)
        self.MPT = self.mpt.reshape(-1)

    def where(self, *names):
        """Texels whose tag is any of `names`."""
        ids = [self.tags.index(n) for n in names if n in self.tags]
        return np.isin(self.TAG, ids)

    def on(self, *names):
        """Texels whose part's name holds any of `names`."""
        ids = [i for i, p in enumerate(self.parts) if any(n in p for n in names)]
        return np.isin(self.PART, ids)

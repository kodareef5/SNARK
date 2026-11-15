# Carves each rock's solid from its field at a centimetre and keeps it in the
# repository's .cache, which the rest reads. Run by make.py, or alone:
#   blender -b --factory-startup --python sculpt.py -- rock_1 [...]
# With --marks it works out only the marks of solids already carved (plain
# Python will do for that): python3 sculpt.py -- --marks rock_1 [...]

import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True

from sdf import mesh_field  # noqa: E402
from variants import VARIANTS, form_of  # noqa: E402

# ROCK_CACHE and ROCK_STEP set apart a quick coarse look at a form without touching the solids the bake reads.
CACHE = os.environ.get("ROCK_CACHE", os.path.join(HERE, "..", "..", "..", "..", "..", ".cache", "rocks"))
STEP = float(os.environ.get("ROCK_STEP", "0.01"))


def cached(name):
    return os.path.join(CACHE, f"{name}_high.npz")


def vertex_normals(verts, quads):
    a, b, c, d = (verts[quads[:, k]] for k in range(4))
    fn = np.cross(c - a, d - b)
    vn = np.zeros_like(verts)
    for k in range(4):
        np.add.at(vn, quads[:, k], fn)
    return vn / np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-9)


def sculpt(name):
    form = form_of(name)
    lo, hi = form.bounds()
    t = time.time()
    verts, quads = mesh_field(form, lo, hi, STEP)
    nrm = vertex_normals(verts, quads)
    # Quads must face out: the normals point away from the middle on the whole.
    if np.sum(np.einsum("ij,ij->i", nrm, verts - verts.mean(axis=0))) < 0:
        quads = quads[:, ::-1].copy()
        nrm = -nrm
    marks = form.marks(verts, nrm)
    os.makedirs(CACHE, exist_ok=True)
    np.savez(cached(name), verts=verts, quads=quads, normals=nrm, **{f"mark_{k}": v.astype(np.float32) for k, v in marks.items()})
    print(f"sculpt: {name} {len(verts)} vertices {len(quads)} quads in {time.time() - t:.1f} s")


def remark(name):
    """Works out the marks of a solid already carved, for a change to the marks alone."""
    z = dict(np.load(cached(name)))
    t = time.time()
    marks = form_of(name).marks(z["verts"], z["normals"])
    z.update({f"mark_{k}": v.astype(np.float32) for k, v in marks.items()})
    np.savez(cached(name), **z)
    print(f"sculpt: {name} marked again in {time.time() - t:.1f} s")


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    names = [a for a in args if not a.startswith("--")]
    for name in names or VARIANTS:
        remark(name) if "--marks" in args else sculpt(name)

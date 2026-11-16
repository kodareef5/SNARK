"""Searches the battens' fold (rig.py: FOLD and TUCK for web_1..3, FINGER_ROLL) and the membrane's weights
(model.py: MEMBRANE_FIT) together, in NumPy, on what dump.py wrote. Run dump.py first, with the rig as it stands.

A candidate re-poses the battens and the finger's roll in every dumped pose and clip frame, skins the left
membrane with its weights and counts what check.py counts: the skin crossing itself, the shell and legs, and the
other wing, folds tighter than the skin is thick, and skin spread past the bones. The clips' frames count too, a
sample of them for crossings, the held ones (HELD) most, and every frame of the ground clips for the ground: the
battens and the skin's rear edge must stay above it (rig.check_clip). A frame whose battens the clip keys itself is
left as it is. The search keeps any random change that lowers the total, from the numbers the rig and model have now.

    python3 ref/wing/fold.py [steps] [seed]

Prints the best and writes it to fold.json beside this script, as the numbers for rig.py and model.py. Needs NumPy
and SciPy. The search is local and slow (several seconds a candidate); confirm its result with check.py and the
clips' own finish().
"""

import json
import math
import os
import sys
import tempfile
import time

import numpy as np
from scipy.spatial import cKDTree
from scipy.spatial.transform import Rotation as Rot, Slerp

np.seterr(all="ignore")
HERE = os.path.dirname(os.path.abspath(__file__))
D = json.load(open(os.path.join(tempfile.gettempdir(), "pteranodon_fold.json")))
JOINT, TAIL = D["joint"], D["tail"]
PARENT = {"web_1_l": "forearm_l", "web_2_l": "hand_l", "web_3_l": "wing_2_l"}
FINGER = ["wing_1_l", "wing_2_l", "wing_3_l", "wing_4_l"]
WEBS = ("web_1", "web_2", "web_3")
X4 = np.diag([-1.0, 1.0, 1.0, 1.0])
# The poses scored, and how much each counts; then the clips' frames sampled for crossings, and the ground's lines.
POSES = {"stance": 5.0, "ground_0.8": 0.5, "ground_0.6": 1.0, "ground_open": 0.5, "dive": 2.0, "air_0.25": 1.0,
         "air_0.4": 1.5, "tuck": 2.0, "air_0.7": 1.0, "land_0.6": 0.7, "land_0.75": 0.5}
SAMPLE_EACH = 3
HELD = {"idle": 3.0, "idle_look": 2.0, "hover": 3.0, "fly": 3.0, "fly_fast": 3.0, "walk": 1.5}
TAIL_MIN, SKIN_MIN = 0.005, -0.03


def tb(p):
    p = np.asarray(p, float)
    return np.stack([p[..., 0], -p[..., 2], p[..., 1]], -1)


def ta(v):
    return np.stack([v[..., 0], v[..., 2], -v[..., 1]], -1)


def mirror_w(w):
    swap = lambda b: b[:-2] + "_r" if b.endswith("_l") else (b[:-2] + "_l" if b.endswith("_r") else b)
    return {swap(b): x for b, x in w.items()}


# ---- the membrane and the solids ------------------------------------------------------------------------------------

GRID = np.array(D["grid"])
FRACS = np.array(D["fracs"])
NU, NV = GRID.shape[:2]


def slab(grid, half):
    """The slab as model.slab makes it: points, each point's grid cell, triangles, each triangle's cell."""
    du, dv = np.gradient(grid, axis=0), np.gradient(grid, axis=1)
    n = np.cross(du, dv)
    n /= np.maximum(np.linalg.norm(n, axis=2, keepdims=True), 1e-12)
    n = np.where(n[..., 1:2] < 0, -n, n)
    pts, ij, up, dn = [], [], {}, {}
    for i in range(NU):
        for j in range(NV):
            if i == NU - 1:
                if j == 0:
                    tip = len(pts)
                    pts.append(grid[i, j]); ij.append((i, j))
                up[i, j] = dn[i, j] = tip
            elif i == 0 or j in (0, NV - 1):
                up[i, j] = dn[i, j] = len(pts)
                pts.append(grid[i, j]); ij.append((i, j))
            else:
                h = half * (0.55 if min(i, NU - 1 - i, j, NV - 1 - j) == 1 else 1.0)
                up[i, j] = len(pts); pts.append(grid[i, j] + n[i, j] * h); ij.append((i, j))
                dn[i, j] = len(pts); pts.append(grid[i, j] - n[i, j] * h); ij.append((i, j))
    tris, cell = [], []
    for i in range(NU - 1):
        for j in range(NV - 1):
            for m in (up, dn):
                q = [m[i, j], m[i + 1, j], m[i + 1, j + 1], m[i, j + 1]]
                for t in ((0, 1, 2), (0, 2, 3)):
                    tt = [q[k] for k in t]
                    if len(set(tt)) == 3:
                        tris.append(tt); cell.append((i, j))
    pairs = {}
    for k, c in enumerate(ij):
        pairs.setdefault(c, []).append(k)
    return np.array(pts), np.array(ij), np.array(tris), np.array(cell), np.array([v for v in pairs.values() if len(v) == 2])


PTS, IJ, TRIS, CELL, UPDN = slab(GRID, D["half"])
# faces grown into the body or the arm (the root's first two columns, the leading edge's first row) are not counted
INNER = (CELL[:, 0] >= 2) & (CELL[:, 1] >= 1)
EDGE = np.array([k for k, (i, j) in enumerate(IJ) if j >= NV - 4])
SOLIDS = {}
for name, s in D["solids"].items():
    SOLIDS[name] = (np.array(s["points"]), s["weights"],
                    np.array([(f[0], f[k], f[k + 1]) for f in s["faces"] for k in range(1, len(f) - 1)]))


# ---- skinning and crossings -----------------------------------------------------------------------------------------

def skin(points, weights, mats):
    """Points (animal frame) skinned by their weights through the bones' matrices; the animal frame back."""
    v4 = np.c_[tb(points), np.ones(len(points))]
    names = sorted({b for w in weights for b in w})
    W = np.zeros((len(points), len(names)))
    for i, w in enumerate(weights):
        for b, x in w.items():
            W[i, names.index(b)] = x
    out = np.zeros((len(points), 3))
    for k, b in enumerate(names):
        out += W[:, k:k + 1] * (v4 @ mats[b].T)[:, :3]
    return ta(out)


def _seg_tri(p0, p1, a, b, c):
    e1, e2, d = b - a, c - a, p1 - p0
    h = np.cross(d, e2)
    det = np.einsum("ij,ij->i", e1, h)
    ok = np.abs(det) > 1e-12
    inv = np.where(ok, 1.0 / np.where(ok, det, 1.0), 0.0)
    s = p0 - a
    u = inv * np.einsum("ij,ij->i", s, h)
    q = np.cross(s, e1)
    v = inv * np.einsum("ij,ij->i", d, q)
    t = inv * np.einsum("ij,ij->i", e2, q)
    return ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t >= 0) & (t <= 1)


def _crossing(V, A, B):
    hit = np.zeros(len(A), bool)
    for T, U in ((A, B), (B, A)):
        a, b, c = V[U[:, 0]], V[U[:, 1]], V[U[:, 2]]
        for i, j in ((0, 1), (1, 2), (2, 0)):
            hit |= _seg_tri(V[T[:, i]], V[T[:, j]], a, b, c)
    return hit


def _near(V, ta_, tb_=None):
    """Pairs of triangles whose bounding spheres meet."""
    C = V[ta_].mean(1)
    R = np.linalg.norm(V[ta_] - C[:, None], axis=2).max(1)
    if tb_ is None:
        pairs = np.array(sorted(cKDTree(C).query_pairs(2 * R.max())), dtype=int).reshape(-1, 2)
        if len(pairs):
            pairs = pairs[np.linalg.norm(C[pairs[:, 0]] - C[pairs[:, 1]], axis=1) <= R[pairs[:, 0]] + R[pairs[:, 1]]]
        return pairs
    C2 = V[tb_].mean(1)
    R2 = np.linalg.norm(V[tb_] - C2[:, None], axis=2).max(1)
    lists = cKDTree(C).query_ball_tree(cKDTree(C2), R.max() + R2.max())
    pairs = np.array([(i, j) for i, js in enumerate(lists) for j in js], dtype=int).reshape(-1, 2)
    if len(pairs):
        pairs = pairs[np.linalg.norm(C[pairs[:, 0]] - C2[pairs[:, 1]], axis=1) <= R[pairs[:, 0]] + R2[pairs[:, 1]]]
    return pairs


def self_crossings(V, tris, gap=0.02):
    """Pairs of the triangles that cross, sharing no corner and with no corners within `gap` (check.py's count)."""
    pairs = _near(V, tris)
    if not len(pairs):
        return 0
    A, B = tris[pairs[:, 0]], tris[pairs[:, 1]]
    keep = ~(A[:, :, None] == B[:, None, :]).any((1, 2))
    A, B = A[keep], B[keep]
    keep = np.linalg.norm(V[A][:, :, None] - V[B][:, None, :], axis=3).min((1, 2)) > gap
    return int(_crossing(V, A[keep], B[keep]).sum())


def crossings(V, tris_a, tris_b):
    pairs = _near(V, tris_a, tris_b)
    return int(_crossing(V, tris_a[pairs[:, 0]], tris_b[pairs[:, 1]]).sum()) if len(pairs) else 0


def creases(P):
    """Points where the slab's two faces have swapped sides: folded tighter than the skin is thick."""
    mid = np.full((NU, NV, 3), np.nan)
    for a, b in UPDN:
        mid[tuple(IJ[a])] = (P[a] + P[b]) / 2
    n = np.cross(np.gradient(mid, axis=0), np.gradient(mid, axis=1))
    n /= np.maximum(np.linalg.norm(n, axis=2, keepdims=True), 1e-12)
    d = P[UPDN[:, 0]] - P[UPDN[:, 1]]
    nn = n[IJ[UPDN[:, 0], 0], IJ[UPDN[:, 0], 1]]
    return int((np.einsum("ij,ij->i", d, nn) < 0.25 * np.linalg.norm(d, axis=1)).sum())


# ---- the weights ----------------------------------------------------------------------------------------------------

def _knots(knots, t):
    if t <= knots[0][0]:
        return {knots[0][1]: 1.0}
    for (t0, a), (t1, b) in zip(knots, knots[1:]):
        if t <= t1:
            k = (t - t0) / max(t1 - t0, 1e-9)
            return {a: 1.0 - k, b: k} if a != b else {a: 1.0}
    return {knots[-1][1]: 1.0}


def _add(out, w, k):
    for b, x in w.items():
        out[b] = out.get(b, 0.0) + x * k


def weights(p):
    """model.membrane_weights with the fit `p`, for the slab's points."""
    along = D["along"]
    reach = p["root_reach"]
    ribs = [(0.0, "root"), (reach, "web_1_l")] + ([(along["forearm_l"], "web_1_l")] if reach < along["forearm_l"] else []) + \
           [(along["hand_l"], "web_2_l"), (along["wing_2_l"], "web_3_l"), (1.0, "wing_4_l")]
    smooth = lambda v: min(max(v, 0.0), 1.0) ** 2 * (3 - 2 * min(max(v, 0.0), 1.0))
    W = {}
    for i in range(NU):
        for j in range(NV):
            v = j / (NV - 1)
            if i == NU - 1:
                W[i, j] = {"wing_4_l": 1.0}
            elif j == 0:
                W[i, j] = dict(D["lead"][i])
            elif i == 0:
                W[i, j] = dict(D["root"][j])
            else:
                rib = {}
                body = _knots([(0.0, "chest"), (0.35, "spine"), (0.7, "pelvis")], v)
                for name, w in _knots(ribs, FRACS[i]).items():
                    _add(rib, body if name == "root" else {name: 1.0}, w)
                v1 = p["v1_inner"] if FRACS[i] < along["hand_l"] + 0.17 else p["v1_outer"]
                v0 = p["v0"] * v1
                s = smooth((v - v0) / max(v1 - v0, 1e-3)) * p["rib_max"]
                W[i, j] = {}
                _add(W[i, j], D["lead"][i], 1 - s)
                _add(W[i, j], rib, s)
    for _ in range(p["smooth"]):
        new = {}
        for (i, j), w in W.items():
            if j == 0 or i == 0 or i == NU - 1:
                new[i, j] = w
                continue
            near = [c for c in ((i + 1, j), (i - 1, j), (i, j + 1), (i, j - 1)) if c in W]
            o = {}
            _add(o, w, 0.5)
            for c in near:
                _add(o, W[c], 0.5 / len(near))
            new[i, j] = o
        W = new
    out = []
    for i, j in IJ:
        top = sorted(((b, x) for b, x in W[int(i), int(j)].items() if x > 1e-4), key=lambda kv: -kv[1])[:4]
        t = sum(x for _, x in top)
        out.append({b: x / t for b, x in top})
    return out


# ---- the fold -------------------------------------------------------------------------------------------------------

def mats(bones):
    return {b: np.array(m) for b, m in bones.items()}


def roll_at(p, f):
    return 2 * f * p["roll_tuck"] if f <= 0.5 else p["roll_tuck"] + (2 * f - 1) * (p["roll_fold"] - p["roll_tuck"])


def rolled(M, ang, side):
    """The finger's four bones of `side` rolled `ang` degrees about their own length (the right as the left's mirror)."""
    s = 1.0 if side == "l" else -1.0
    for b in FINGER:
        name = b[:-2] + "_" + side
        h, t = tb(np.array(JOINT[b]) * [s, 1, 1]), tb(np.array(TAIL[b]) * [s, 1, 1])
        m = M[name]
        a = m[:3, :3] @ (t - h)
        hp = (m @ np.r_[h, 1])[:3]
        R = Rot.from_rotvec(a / np.linalg.norm(a) * math.radians(ang * s)).as_matrix()
        T = np.eye(4); T[:3, :3] = R; T[:3, 3] = hp - R @ hp
        M[name] = T @ m


def turn_to(target, parent, name):
    """As rig.solve_fold: the least turn of `name` relative to its posed parent that points it at `target`."""
    h, t = tb(np.array(JOINT[name])), tb(np.array(TAIL[name]))
    Rp = parent[:3, :3]
    now, want = Rp @ (t - h), tb(np.array(target)) - (parent @ np.r_[h, 1])[:3]
    now, want = now / np.linalg.norm(now), want / np.linalg.norm(want)
    v, c = np.cross(now, want), np.dot(now, want)
    R = Rot.from_rotvec(v / np.linalg.norm(v) * math.atan2(np.linalg.norm(v), c)).as_matrix() if np.linalg.norm(v) > 1e-9 else np.eye(3)
    return Rot.from_matrix(Rp.T @ R @ Rp)


def unrolled(bones, f, p):
    M = mats(bones)
    for side in "lr":
        rolled(M, -roll_at(p, f), side)
    return M


NOW = {"roll_tuck": D["roll"]["tuck"], "roll_fold": D["roll"]["fold"], **D["fit"],
       **{f"fold_{k}": list(D["fold"][k]) for k in WEBS}, **{f"tuck_{k}": list(D["tuck"][k]) for k in WEBS}}
BASE = {"stance": unrolled(D["poses"]["stance"]["bones"], 1.0, NOW), "tuck": unrolled(D["poses"]["tuck"]["bones"], 0.5, NOW)}


class Fold:
    def __init__(self, p):
        self.p = p
        self.q = {n: (turn_to(p["tuck_" + n[:5]], BASE["tuck"][par], n), turn_to(p["fold_" + n[:5]], BASE["stance"][par], n))
                  for n, par in PARENT.items()}

    def turn(self, name, f):
        qt, qf = self.q[name]
        if f <= 0.5:
            return Slerp([0, 1], Rot.concatenate([Rot.identity(), qt]))([f * 2])[0]
        return Slerp([0, 1], Rot.concatenate([qt, qf]))([f * 2 - 1])[0]

    def pose(self, frame):
        """A frame (un-rolled bones, fold, battens the clip keys) with this fold's battens and roll."""
        M = dict(frame["bones"])
        for side in "lr":
            rolled(M, roll_at(self.p, frame["fold"]), side)
        for name, parent in PARENT.items():
            h = tb(np.array(JOINT[name]))
            q = self.turn(name, frame["fold"]).as_matrix()
            L = np.eye(4); L[:3, :3] = q; L[:3, 3] = h - q @ h
            M[name] = M[parent] @ L
            M[name[:-2] + "_r"] = M[parent[:-2] + "_r"] @ X4 @ L @ X4
        M.update(frame.get("keyed", {}))
        return M


def clip_frames():
    """The ground clips' frames, un-rolled, each with the fold its second batten shows on the rig's present path, and
    the battens the clip keys itself (off that path) kept as they are. Frames off the path altogether are left out."""
    now = Fold(NOW)
    out = []
    for clip, frames in D["clips"].items():
        for f_, fr in sorted(frames.items(), key=lambda kv: int(kv[0])):
            M = mats(fr["bones"])
            rel = Rot.from_matrix((np.linalg.inv(M["hand_l"]) @ M["web_2_l"])[:3, :3])
            off, f = min(((now.turn("web_2_l", f) .inv() * rel).magnitude(), f) for f in np.linspace(0, 1, 101))
            if off > 0.03:
                continue
            keyed = {}
            for name, parent in PARENT.items():
                for side, X in (("l", np.eye(3)), ("r", np.diag([-1.0, 1, 1]))):
                    n_, p_ = name[:-2] + "_" + side, parent[:-2] + "_" + side
                    r = (np.linalg.inv(M[p_]) @ M[n_])[:3, :3]
                    if (now.turn(name, f).inv() * Rot.from_matrix(X @ r @ X)).magnitude() > 0.03:
                        keyed[n_] = M[n_]
            out.append({"clip": clip, "frame": int(f_), "lift": fr["lift"], "fold": float(f), "keyed": keyed,
                        "bones": unrolled(fr["bones"], f, NOW)})
    return out


FRAMES = clip_frames()
FREE = [fr for fr in FRAMES if not fr["keyed"]]
GROUND = [fr for fr in FREE if fr["clip"] in D["grounded"]]
SAMPLE = []
for clip in sorted({fr["clip"] for fr in FREE}):
    mine = [fr for fr in FREE if fr["clip"] == clip]
    SAMPLE += [mine[int(k * (len(mine) - 1) / max(SAMPLE_EACH - 1, 1))] for k in range(SAMPLE_EACH)]
CANON = {name: {"fold": D["poses"][name]["fold"], "bones": unrolled(D["poses"][name]["bones"], D["poses"][name]["fold"], NOW)}
         for name in POSES}


# ---- the score and the search ---------------------------------------------------------------------------------------

def counts(M, W, P=None):
    P = skin(PTS, W, M) if P is None else P
    n_self = self_crossings(P, TRIS)
    n_body = 0
    for name, (sp, sw, st) in SOLIDS.items():
        SP = skin(sp, sw, M)
        n_body += crossings(np.concatenate([P, SP]), TRIS[INNER], st + len(P))
    return n_self, n_body, P


def score(p):
    F, W = Fold(p), weights(p)
    WR = [mirror_w(w) for w in W]
    total, out = 0.0, {}
    for name, k in POSES.items():
        frame = CANON[name]
        M = F.pose(frame)
        n_self, n_body, P = counts(M, W)
        PR = skin(PTS * [-1, 1, 1], WR, M)
        n_wings = crossings(np.concatenate([P, PR]), TRIS, TRIS[:, ::-1] + len(P))
        n_crease = creases(P)
        beyond = 0.0
        if frame["fold"] >= 0.45:
            bones = np.array([ta((M[b] @ np.r_[tb(np.array(pt)), 1])[:3]) for b in ["upper_arm_l", "forearm_l", "hand_l"] + FINGER
                              for pt in (JOINT[b], TAIL[b])])
            beyond += np.clip(P[:, 0] - (bones[:, 0].max() + 0.08), 0, None).sum()
            beyond += np.clip(P[:, 1] - (bones[:, 1].max() + 0.05), 0, None).sum()
            beyond += 2 * np.clip(0.01 - P[:, 1], 0, None).sum() if name.startswith(("stance", "ground")) else \
                np.clip((bones[:, 1].min() - 0.05) - P[:, 1], 0, None).sum()
        out[name] = (n_self, n_body, n_wings, n_crease)
        total += k * (n_self + n_body + 2 * n_wings + 0.15 * n_crease + 4 * beyond)
    clip_cost, per = 0.0, {}
    for frame in SAMPLE:
        M = F.pose(frame)
        n_self, n_body, P = counts(M, W)
        n_wings = crossings(np.concatenate([P, skin(PTS * [-1, 1, 1], WR, M)]), TRIS, TRIS[:, ::-1] + len(P))
        c = per.setdefault(frame["clip"], [0, 0, 0])
        c[0], c[1], c[2] = c[0] + n_self, c[1] + n_body, c[2] + n_wings
        clip_cost += HELD.get(frame["clip"], 1.0) * (n_self + 2 * n_body + 2 * n_wings)
    low_tail = low_skin = 9.0
    WE, WER = [W[k] for k in EDGE], [WR[k] for k in EDGE]
    for frame in GROUND:
        M = F.pose(frame)
        for name in PARENT:
            for side, s in (("l", 1.0), ("r", -1.0)):
                n_ = name[:-2] + "_" + side
                low_tail = min(low_tail, ta((M[n_] @ np.r_[tb(np.array(TAIL[name]) * [s, 1, 1]), 1])[:3])[1] + frame["lift"])
        y = min(skin(PTS[EDGE], WE, M)[:, 1].min(), skin(PTS[EDGE] * [-1, 1, 1], WER, M)[:, 1].min())
        low_skin = min(low_skin, y + frame["lift"])
    out["clips"] = {k: tuple(v) for k, v in per.items()}
    out["ground"] = (round(low_tail, 3), round(low_skin, 3))
    total += clip_cost + 6000 * (max(0.0, TAIL_MIN - low_tail) + max(0.0, SKIN_MIN - low_skin))
    return total, out


def perturb(p, rng, scale):
    q = json.loads(json.dumps(p))
    keys = [f"fold_{k}" for k in WEBS] + [f"tuck_{k}" for k in WEBS] + ["roll_fold", "roll_tuck", "v1_inner", "v1_outer",
                                                                      "v0", "smooth", "rib_max"]
    for k in rng.choice(keys, size=rng.integers(1, 3), replace=False):
        if k.startswith(("tuck_", "fold_")):
            q[k] = [float(a + rng.normal(0, 0.12 * scale)) for a in q[k]]
        elif k.startswith("roll"):
            q[k] = float(q[k] + rng.normal(0, 20 * scale))
        elif k == "smooth":
            q[k] = int(np.clip(q[k] + rng.integers(-1, 2), 0, 6))
        elif k == "v0":
            q[k] = float(np.clip(q[k] + rng.normal(0, 0.15 * scale), 0.0, 0.9))
        elif k == "rib_max":
            q[k] = float(np.clip(q[k] + rng.normal(0, 0.08 * scale), 0.55, 1.0))
        else:
            q[k] = float(np.clip(q[k] + rng.normal(0, 0.12 * scale), 0.12, 1.0))
    return q


def main():
    steps = int(sys.argv[1]) if len(sys.argv) > 1 else 200
    rng = np.random.default_rng(int(sys.argv[2]) if len(sys.argv) > 2 else 1)
    best = dict(NOW)
    bs, bo = score(best)
    print("now", round(bs, 1), bo, flush=True)
    t0 = time.time()
    for it in range(steps):
        cand = perturb(best, rng, 0.6 if it < steps * 0.4 else (0.35 if it < steps * 0.8 else 0.2))
        s, o = score(cand)
        if s < bs:
            best, bs, bo = cand, s, o
            print(f"{it} {time.time() - t0:.0f}s {bs:.1f}", bo, flush=True)
    with open(os.path.join(HERE, "fold.json"), "w") as fh:
        json.dump({"score": bs, "counts": bo, "params": best}, fh, indent=1)
    print("rig.py FOLD", {k: tuple(round(v, 3) for v in best[f"fold_{k}"]) for k in WEBS})
    print("rig.py TUCK", {k: tuple(round(v, 3) for v in best[f"tuck_{k}"]) for k in WEBS})
    print("rig.py FINGER_ROLL", {"tuck": round(best["roll_tuck"], 1), "fold": round(best["roll_fold"], 1)})
    print("model.py MEMBRANE_FIT", {k: round(best[k], 4) if isinstance(best[k], float) else best[k] for k in D["fit"]})


if __name__ == "__main__":
    main()

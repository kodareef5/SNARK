"""Register the wings, jaw, neck and landing contacts in model metres; bake native maps."""

import hashlib
import io
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt
from scipy.spatial import cKDTree
from scipy.spatial.transform import Rotation

folder = Path(__file__).resolve().parents[1]
source, scratch = map(Path, sys.argv[1:])
raw = source.read_bytes()
if hashlib.sha256(raw).hexdigest() != "159ffcf3b3d8c5826b5bceeef25a092f482878f1ae4821e596f55331119e5a03":
    raise ValueError("Expected Chistodrako's original Pteranodon GLB")
end = 20 + int.from_bytes(raw[12:16], "little")
g = json.loads(raw[20:end])
buf = memoryview(raw)[end + 8 :]


def array(idx):
    a = g["accessors"][idx]
    v = g["bufferViews"][a["bufferView"]]
    dt = np.dtype({5126: "<f4", 5125: "<u4", 5123: "<u2", 5121: "u1"}[a["componentType"]])
    n = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[a["type"]]
    return np.ndarray(
        (a["count"], n),
        dt,
        buf,
        v.get("byteOffset", 0) + a.get("byteOffset", 0),
        strides=(v.get("byteStride", dt.itemsize * n), dt.itemsize),
    )


def picture(i):
    v = g["bufferViews"][g["images"][g["textures"][i]["source"]]["bufferView"]]
    off = v.get("byteOffset", 0)
    return Image.open(io.BytesIO(buf[off : off + v["byteLength"]]))


prim = g["meshes"][0]["primitives"][0]
a = prim["attributes"]
p = array(a["POSITION"]).astype(float)
tri = array(prim["indices"]).reshape(-1, 3)
uv = array(a["TEXCOORD_0"])
skin = g["skins"][0]
bones = [g["nodes"][idx]["name"].split(".")[0] for idx in skin["joints"]]
heads = np.linalg.inv(array(skin["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1))[:, :3, 3]
j, w = array(a["JOINTS_0"]), array(a["WEIGHTS_0"]).astype(float)
w /= w.sum(1, keepdims=True)
guide = dict(np.load(scratch / "guide.npz"))
names = list(guide["names"])
joint = dict(zip(guide["joints"], guide["heads"]))
tail = dict(zip(guide["joints"], guide["tails"]))


def ease(a, b, t):
    t = np.clip((t - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def rotate_beak(q, degrees, scale):
    x, y, z = (q - heads[bones.index("jaw")]).T
    c, s = np.cos(np.deg2rad(degrees)), np.sin(np.deg2rad(degrees))
    return np.column_stack((x * 0.079, (c * y + s * z) * scale, (-s * y + c * z) * scale)) + joint["jaw"]


def link(q, src, src_end, dst, dst_end, thickness):
    d = np.asarray(src_end) - src
    e = np.asarray(dst_end) - dst
    length = np.linalg.norm(d)
    axis = d / length
    shift = q - src
    along = shift @ axis
    rot, _ = Rotation.align_vectors([e / np.linalg.norm(e)], [axis])
    return dst + along[:, None] * e / length + thickness * rot.apply(shift - along[:, None] * axis)


def shoulder(q):
    # Map the raised donor arm into the game's level glide. Its knuckle and
    # the three outer spars must fold around the existing animation pivots.
    x, y, z = q.T
    ax = abs(x)
    src = [0, 2.48, 6.73, 12.87, 25.54, 32.55, 39.85, 45.1, 49.04]
    dst = [0, 0.15, 0.454, 0.966, 1.524, 2.204, 2.764, 3.203, 3.481]
    h = np.interp(ax, src, [4.9, 5.2, 6.5, 9.8, 14.0, 14.6, 15.0, 15.25, 15.45])
    forward = np.interp(ax, src, [2, 2, 0.3, 3.10, 1.39, -1.60, -4.88, -7.35, -9.58])
    yy = np.interp(ax, src, [0.75, 0.74, 0.817, 0.898, 0.947, 0.862, 0.768, 0.681, 0.612])
    zz = np.interp(ax, src, [0, 0, 0.065, 0.029, 0.048, -0.096, -0.289, -0.513, -0.731])
    # The inner trailing edge reaches the ankle and the outside skin narrows
    # to the last finger. Preserve the local ribbing and camber of the donor.
    chord = np.interp(ax, src, [0.085, 0.086, 0.102, 0.083, 0.071, 0.077, 0.075, 0.075, 0.074])
    return np.column_stack(
        (np.sign(x) * np.interp(ax, src, dst), yy + (y - h) * 0.057, zz + (z - forward) * chord)
    )


def core(q):
    x, y, z = q.T
    levels = [-10, -6.3, -4.8, -3.3, -1.9, -0.4, 2, 3.5, 4.5, 5.5, 6.4, 7.4, 8.55]
    cy = np.interp(z, levels, [3.1, 3.2, 3.3, 3.5, 3.6, 3.7, 4.4, 4.9, 5.2, 5.5, 5.8, 6.1, 6.63])
    height = np.interp(z, levels, [0.66, 0.72, 0.74, 0.76, 0.78, 0.80, 0.815, 0.86, 0.95, 1.06, 1.18, 1.26, 1.292])
    along = np.interp(
        z, levels, [-0.82, -0.60, -0.50, -0.36, -0.24, -0.12, -0.015, 0.10, 0.22, 0.33, 0.43, 0.51, 0.58]
    )
    # The donor's horizontal neck would become a narrow cylinder if only its
    # centreline rose to the saddle rig. Carry its throat volume up that curve.
    neck = np.interp(z, [-6, -2, 1, 3.5, 5.4, 7.5, 9], [0, 0.10, 0.18, 0.48, 0.96, 0.83, 0.24])
    depth = (y - cy) * 0.071 * (1 + 0.84 * neck)
    breast = np.exp(-(((z - 1.1) / 3.2) ** 2))
    depth -= 0.077 * breast * ease(0.1, 2.2, cy - y)
    return np.column_stack((x * 0.067 * (1 + 0.91 * neck), height + depth, along))


def limb(q, side, segment):
    letter = side.upper()
    suffix = "_" + side
    original = [heads[bones.index(letter + n)] for n in ("thigh", "knee", "ankle", "middle01", "middle03")]
    native = [joint[n + suffix] for n in ("thigh", "shin", "foot", "toes")] + [tail["toes" + suffix]]
    return link(q, original[segment], original[segment + 1], native[segment], native[segment + 1], 0.061)


fitted = np.zeros_like(p)
weights = np.zeros((len(p), len(names)))
wing_weight = np.zeros(len(p))
dyes = np.zeros((len(p), 6))
for i, b in enumerate(bones):
    weight = ((j == i) * w).sum(1)
    use = weight > 0
    if not use.any():
        continue
    q = p[use]
    side = "l" if b[0] == "L" else "r"
    suf = "_" + side
    if b in ("head", "L_eye", "R_eye") or "Eyelid" in b:
        pos = rotate_beak(q, 18.4, 0.086)
        target = "skull"
        dye = 2 if b == "head" else None
    elif b == "jaw" or "tongue" in b:
        pos = rotate_beak(q, 38.0, 0.084)
        target = "jaw"
        dye = 2 if b == "jaw" else None
    elif any(s in b for s in ["thigh", "knee", "ankle", "thumb", "index", "middle", "pinky", "ring"]):
        segment = 0 if "thigh" in b else 1 if "knee" in b else 2 if "ankle" in b else 3
        pos = limb(q, side, segment)
        target = ("thigh", "shin", "foot", "toes")[segment] + suf
        dye = 5
    elif b[0] in "LR" and ("wing" in b or "Arm" in b or "wrist" in b or "finger" in b or "clevicle" in b):
        pos = shoulder(q)
        target = ("fingers" if "finger" in b else "upper_arm") + suf
        if "finger" not in b:
            wing_weight[use] += weight[use]
        dye = 2 if "finger" in b else 0
    else:
        pos = core(q)
        target = {
            "neck_01": "neck_1",
            "neck_02": "neck_2",
            "neck_03": "neck_3",
            "neck_04": "neck_4",
            "neck_05": "neck_4",
            "spine2": "spine",
            "spine3": "spine",
            "chest": "chest",
        }.get(b, "pelvis")
        dye = 5
    fitted[use] += pos * weight[use, None]
    weights[use, names.index(target)] += weight[use]
    if dye is not None:
        dyes[use, dye] += weight[use]

# Interpolate native folding weights on the actual guide triangles. Blending
# across the chord keeps the ankle and knuckle from pulling against one another.
wt = guide["weights"]
surf = guide["tri"][guide["wing"]]
xyz = guide["p"][surf]
centres = xyz.mean(1)
_, near = cKDTree(centres).query(fitted, k=12)
a, b, c = xyz[near].transpose(2, 0, 1, 3)
u, v, ap = b - a, c - a, fitted[:, None, :] - a


def dot(a, b):
    return (a * b).sum(-1)


uu, vv, ww, uvv, vp = dot(u, u), dot(v, v), dot(u, ap), dot(u, v), dot(v, ap)
denom = np.maximum(uu * vv - uvv * uvv, 1e-20)
wa, wb = (vv * ww - uvv * vp) / denom, (uu * vp - uvv * ww) / denom
coeff = np.maximum(np.stack((1 - wa - wb, wa, wb), axis=-1), 0)
coeff /= coeff.sum(-1, keepdims=True)
nearpoint = (xyz[near] * coeff[:, :, :, None]).sum(2)
best = ((nearpoint - fitted[:, None, :]) ** 2).sum(-1).argmin(1)
rows = np.arange(len(p))
transfer = (wt[surf[near[rows, best]]] * coeff[rows, best, :, None]).sum(1)
for side in ["l", "r"]:
    # Remove the placeholder arm share; keep the explicit hand digits.
    weights[:, names.index("upper_arm_" + side)] = 0
weights += wing_weight[:, None] * transfer
order = np.argsort(weights, axis=1)[:, :-4]
np.put_along_axis(weights, order, 0, axis=1)
weights /= weights.sum(1, keepdims=True)

# Original vertex splits belong to UV or normal charts. Weld by original
# position and keep per-corner UVs so their seams stay watertight through motion.
_, first, inverse = np.unique(np.round(p, 4), axis=0, return_index=True, return_inverse=True)
faces = inverse[tri].tolist()
charts = uv[tri].tolist()
positions = fitted[first].tolist()
skinweights = weights[first].tolist()
from collections import Counter, defaultdict

edges = Counter(tuple(sorted((a, b))) for t in faces for a, b in zip(t, t[1:] + t[:1]))
rim = defaultdict(list)
for (a, b), n in edges.items():
    if n == 1:
        rim[a].append(b)
        rim[b].append(a)
corner = {v: chart[k] for face, chart in zip(faces, charts) for k, v in enumerate(face)}
while rim:
    ring = [next(iter(rim))]
    prev = -1
    while True:
        v = ring[-1]
        nxt = next(t for t in rim[v] if t != prev)
        if nxt == ring[0]:
            break
        ring.append(nxt)
        prev = v
    for v in ring:
        del rim[v]
    at = len(positions)
    positions.append(np.mean(fitted[first[ring]], axis=0))
    skinweights.append(weights[first[ring[0]]])
    chart = np.mean([corner[v] for v in ring], axis=0)
    for a, b in zip(ring, ring[1:] + ring[:1]):
        faces.append([a, b, at])
        charts.append([corner[a], corner[b], chart])
np.savez(scratch / "bound", p=positions, weights=skinweights, names=names, tri=faces, uv=charts)

tex = folder / "tex"


def put(im, role, size=None):
    if size:
        im = im.resize((size, size), Image.Resampling.LANCZOS)
    im.save(tex / ("coastal_" + role + ".png"), optimize=True)


mat = g["materials"][0]
spec = mat["extensions"]["KHR_materials_pbrSpecularGlossiness"]
base = picture(spec["diffuseTexture"]["index"]).convert("RGB")
normal = np.asarray(picture(mat["normalTexture"]["index"]).convert("RGB"), dtype=float) / 127.5 - 1
normal /= np.maximum(np.linalg.norm(normal, axis=2, keepdims=True), 1e-7)
put(Image.fromarray(np.uint8(np.clip(normal * 127.5 + 127.5, 0, 255))), "normal")
occlusion = np.asarray(picture(mat["occlusionTexture"]["index"]).convert("RGB"))[:, :, 0]
gloss = np.asarray(picture(spec["specularGlossinessTexture"]["index"]))[:, :, 3]
rough = np.clip(255 - gloss, 83, 236)
put(Image.fromarray(np.stack((occlusion, rough, np.zeros_like(rough)), -1)), "packed", 512)

# Rasterize anatomical coordinates in the donor's UV charts. A shared folded
# wing always takes the same dyes, both in flight and standing under its rider.
size = 768


def raster(vertex_values):
    out = np.zeros((size, size, vertex_values.shape[1]), np.float32)
    used = np.zeros((size, size), bool)
    for f in tri:
        coords = uv[f] * size
        lo = np.maximum(0, np.floor(coords.min(0)).astype(int))
        hi = np.minimum(size, np.ceil(coords.max(0)).astype(int) + 1)
        a, b, c = coords
        det = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        if abs(det) < 1e-7:
            continue
        xx, yy = np.meshgrid(np.arange(lo[0], hi[0]) + 0.5, np.arange(lo[1], hi[1]) + 0.5)
        x, y = xx - a[0], yy - a[1]
        u = (x * (c[1] - a[1]) - y * (c[0] - a[0])) / det
        v = ((b[0] - a[0]) * y - (b[1] - a[1]) * x) / det
        bary = np.stack((1 - u - v, u, v), -1)
        inside = bary.min(-1) >= -1e-5
        sl = np.s_[lo[1] : hi[1], lo[0] : hi[0]]
        out[sl][inside] = (bary[inside, :, None] * vertex_values[f]).sum(1)
        used[sl] |= inside
    idx = distance_transform_edt(~used, return_distances=False, return_indices=True)
    return out[tuple(idx)]


# Subtle natural colour remains beneath each dye, with a separate root wash,
# outer finger band, and undyed eyes and tongue.
membrane = dyes[:, 0].copy()
x, y, z = fitted.T
span = abs(x)
# Pale inner sail, darker trailing-edge bars and dark crown tip. Motion
# carries the pattern in UV space; the six dye fields follow their exact
# creature-content order (pattern, wing base, horn, inner crest, sail, body).
sweep = z + 0.18 * span
bars = np.exp(-(((span - 2.10 + 0.38 * sweep) / 0.105) ** 2)) + 0.85 * np.exp(
    -(((span - 2.64 + 0.46 * sweep) / 0.12) ** 2)
)
rim = ease(2.94, 3.43, span)
pattern = np.clip(0.66 * bars + 0.72 * rim, 0, 1)
dyes[:, 0] = membrane * pattern
dyes[:, 1] = membrane * (1 - pattern) * (0.15 + 0.57 * ease(-0.45, 0.05, sweep))
dyes[:, 4] = membrane - dyes[:, 1] - dyes[:, 0]
crest = dyes[:, 2] * ease(1.46, 1.65, y) * (1 - ease(0.48, 0.72, z))
dyes[:, 2] -= crest
dyes[:, 3] = crest
fields = raster(np.column_stack((dyes, fitted)))
dye = np.uint8(np.clip(fields[:, :, :6] * 0.55 * 255, 0, 255))
put(Image.fromarray(dye[:, :, :3]), "mask", 512)
put(Image.fromarray(dye[:, :, 3:]), "mask2", 512)


def field(i):
    return np.asarray(Image.fromarray(fields[:, :, i]).resize(base.size, Image.Resampling.BILINEAR))


bars, sail, crown = field(0), field(4), field(3)
rgb = np.asarray(base, dtype=np.float32)
# Cool the dark outer bars, retain ochre light in the translucent-looking
# sail and pick out the swept crest tip against a bright sky.
rgb *= 1 - bars[:, :, None] * [0.34, 0.20, 0.10] - crown[:, :, None] * [0.25, 0.18, 0.12]
rgb += sail[:, :, None] * [4, 6, 7]
put(Image.fromarray(np.uint8(np.clip(rgb, 0, 255))), "base")
x, y, z = fields[:, :, 6:].transpose(2, 0, 1)
wound = np.exp(-(((abs(x) - 1.15) / 0.26) ** 2) - ((z + 0.28 - 0.17 * (abs(x) - 1.15)) / 0.026) ** 2)
wound += np.exp(-(((z + 0.22) / 0.16) ** 2) - ((y - 0.80 - 0.12 * z) / 0.018) ** 2) * (abs(x) < 0.32)
wound = np.uint8(np.clip(wound * 255, 0, 245))
hurt = Image.fromarray(wound).resize((256, 256), Image.Resampling.LANCZOS)
blood = Image.new("RGBA", hurt.size, (111, 31, 32, 0))
blood.putalpha(hurt)
put(blood, "hurt")
decay = Image.new("RGBA", hurt.size, (92, 83, 69, 0))
decay.putalpha(Image.fromarray(np.uint8(np.where(np.array(hurt) > 0, 0, 128))))
put(decay, "decay")

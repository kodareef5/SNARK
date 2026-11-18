"""Bake the canopy palette from the full-resolution CC0 Grab3D Brachiosaurus GLB."""

import io
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter
from scipy.ndimage import distance_transform_edt

folder = Path(__file__).resolve().parents[1] / "tex"
raw = Path(sys.argv[1]).read_bytes()
end = 20 + int.from_bytes(raw[12:16], "little")
g = json.loads(raw[20:end])
bin = memoryview(raw)[end + 8 :]


def accessor(i):
    a = g["accessors"][i]
    v = g["bufferViews"][a["bufferView"]]
    dt = np.dtype({5123: "<u2", 5125: "<u4", 5126: "<f4"}[a["componentType"]])
    n = {"VEC3": 3, "VEC2": 2, "SCALAR": 1}[a["type"]]
    return np.ndarray(
        (a["count"], n),
        dt,
        bin,
        v.get("byteOffset", 0) + a.get("byteOffset", 0),
        strides=(v.get("byteStride", dt.itemsize * n), dt.itemsize),
    )


def image(i):
    v = g["bufferViews"][g["images"][g["textures"][i]["source"]]["bufferView"]]
    a = v.get("byteOffset", 0)
    return Image.open(io.BytesIO(bin[a : a + v["byteLength"]])).convert("RGB")


def ramp(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    return a + (np.asarray(b) - a) * t[..., None]


def chart(vertices, uv, tri, n):
    # Rasterize triangles in bounded batches and pad into the unused gutters.
    q = uv[tri] * n
    lo = np.maximum(0, np.floor(q.min(1)).astype(int))
    hi = np.minimum(n, np.ceil(q.max(1)).astype(int))
    extent = np.maximum(hi - lo, 0)
    areas = extent.prod(1)
    keep = np.where(areas > 0)[0]
    out = np.zeros((n, n, 3), np.float32)
    seen = np.zeros((n, n), bool)
    for chunk in np.array_split(keep, max(1, len(keep) // 512)):
        count = areas[chunk]
        i = np.repeat(chunk, count)
        offset = np.arange(len(i)) - np.repeat(np.cumsum(count) - count, count)
        xx = lo[i, 0] + offset % extent[i, 0]
        yy = lo[i, 1] + offset // extent[i, 0]
        a, b, c = q[i].transpose(1, 0, 2)
        u = b - a
        v = c - a
        x = xx + 0.5 - a[:, 0]
        y = yy + 0.5 - a[:, 1]
        det = u[:, 0] * v[:, 1] - u[:, 1] * v[:, 0]
        det = np.where(abs(det) > 1e-10, det, np.nan)
        s = (x * v[:, 1] - y * v[:, 0]) / det
        t = (y * u[:, 0] - x * u[:, 1]) / det
        inside = (s >= 0) & (t >= 0) & (s + t <= 1)
        i, xx, yy, s, t = i[inside], xx[inside], yy[inside], s[inside, None], t[inside, None]
        a, b, c = vertices[tri[i]].transpose(1, 0, 2)
        out[yy, xx] = a + (b - a) * s + (c - a) * t
        seen[yy, xx] = 1
    return out[tuple(distance_transform_edt(~seen, return_distances=False, return_indices=True))]


pr = g["meshes"][0]["primitives"][0]
attr = pr["attributes"]
mat = g["materials"][0]
p, uv, tri = accessor(attr["POSITION"]), accessor(attr["TEXCOORD_0"]), accessor(pr["indices"]).reshape(-1, 3)
n = 2048
coords = chart(p, uv, tri, 1024)
x, y, z = [
    np.asarray(Image.fromarray(c).resize((n, n), Image.Resampling.BILINEAR))
    for c in coords.transpose(2, 0, 1)
]
texture = image(mat["pbrMetallicRoughness"]["baseColorTexture"]["index"]).resize(
    (n, n), Image.Resampling.LANCZOS
)
raw_rgb = np.asarray(texture, np.float32)
light = (raw_rgb * np.array([0.30, 0.59, 0.11], np.float32)).sum(2)
broad = np.asarray(texture.convert("L").filter(ImageFilter.GaussianBlur(12)), np.float32)
# Broad warm umber islands on a muted eucalyptus hide follow the donor.
# Preserve the iris and eyelid contrast in a small eye-shaped patch.
patch = 1 - ramp(57, 128, broad)
neck = ramp(4.5, 7.0, y)
head = ramp(10.7, 11.27, y)
limbs = (1 - ramp(1.15, 2.70, y)) * ramp(0.35, 0.72, abs(x))
throat = ramp(0.0, 0.68, z - (3.91 + 0.224 * (y - 6))) * neck
belly = (1 - ramp(2.15, 3.46, y - 0.18 * z)) * ramp(-3, 0, z) * (1 - limbs)
underside = np.maximum(throat, belly)
hide = mix(np.array([175, 158, 119]), [88, 104, 92], patch * 0.90)
hide = mix(hide, [207, 186, 145], underside * 0.70)
hide = mix(hide, [132, 121, 99], limbs * 0.58)
hide = mix(hide, [172, 148, 106], head * 0.16)
gain = np.clip(0.81 + 0.22 * light / 135 + 0.39 * (light - broad) / 128, 0.61, 1.32)
rgb = hide * gain[:, :, None]
eye = np.sqrt(((z - 6.11) / 0.145) ** 2 + ((y - 11.70) / 0.136) ** 2)
rgb = mix(rgb, raw_rgb, 1 - ramp(0.72, 1.55, eye))


def write(data, role, side=n):
    img = Image.fromarray(np.uint8(np.clip(data, 0, 255)))
    img.resize((side, side), Image.Resampling.LANCZOS).save(folder / f"{role}.png", optimize=True)


write(rgb, "base")
norm = (
    np.asarray(image(mat["normalTexture"]["index"]).resize((n, n), Image.Resampling.LANCZOS), np.float32)
    / 127.5
    - 1
)
norm[:, :, :2] *= 0.63
norm[:, :, 2] = np.sqrt(np.maximum(0.001, 1 - (norm[:, :, :2] ** 2).sum(2)))
write((norm + 1) * 127.5, "normal")
rough = np.asarray(
    image(mat["pbrMetallicRoughness"]["metallicRoughnessTexture"]["index"]).resize((n, n)), np.float32
)
write(
    np.stack(
        (
            222 + 23 * ramp(30, 174, light),
            np.clip(102 + 0.43 * rough[:, :, 1], 145, 215),
            np.zeros_like(light),
        ),
        -1,
    ),
    "packed",
    512,
)
m = np.stack(
    (
        (1 - patch) * (1 - underside) * (1 - limbs) * 0.4,
        underside * 0.42,
        neck * (1 - head) * 0.23,
        patch * (1 - underside) * 0.45,
        head * 0.34 * (ramp(0.8, 1.6, eye)),
        limbs * 0.43,
    ),
    -1,
)
m /= np.maximum(1, m.sum(2, keepdims=True))
write(m[:, :, :3] * 245, "mask", 512)
write(m[:, :, 3:] * 245, "mask2", 512)


# Woven slate blanket, chestnut leather, and small brass fittings share one saddle atlas.
def saddle_atlas():
    y, x = np.mgrid[:256, :256]
    patch = np.minimum(2, x * 3 // 256)
    grain = np.random.default_rng(17).normal(0, 2.8, x.shape)
    weave = (np.cos(x * np.pi / 2) + np.cos(y * np.pi / 2)) * 3
    colours = np.array([[61, 89, 83], [116, 77, 50], [166, 139, 89]])[patch]
    rgb = colours + np.where(patch == 0, weave + grain * 0.45, grain)[:, :, None]
    Image.fromarray(np.uint8(np.clip(rgb, 0, 255))).save(folder / "tack.png")


saddle_atlas()

# Reproject into the gameplay charts. Rotate source tangent normals into the new
# triangle basis; the face-to-UV correspondence follows the fitted skin.
from scipy.ndimage import map_coordinates

atlas = np.load(sys.argv[2])
source_uv, new_uv, points = atlas["source"], atlas["uv"], atlas["p"]


def basis(uv):
    a, b, c = uv.transpose(1, 0, 2)
    u, v = b - a, c - a
    dp, dq = points[:, 1] - points[:, 0], points[:, 2] - points[:, 0]

    def unit(p):
        return p / np.maximum(np.linalg.norm(p, axis=-1, keepdims=True), 1e-8)

    n = unit(np.cross(dp, dq))
    det = u[:, 0] * v[:, 1] - u[:, 1] * v[:, 0]
    tangent = unit((dp * v[:, 1, None] - dq * u[:, 1, None]) * np.sign(det[:, None]))
    bitangent = np.cross(n, tangent) * np.sign(-det[:, None])
    return tangent, bitangent


st, sb = basis(source_uv)
dt, db = basis(new_uv)
rotation = np.stack([(a * b).sum(1) for a, b in [(st, dt), (sb, dt), (st, db), (sb, db)]], 1)
ids = np.arange(len(points) * 3).reshape(-1, 3)
for side, roles in [(2048, ["base", "normal"]), (512, ["packed", "mask", "mask2"])]:
    mapping = chart(
        np.column_stack((source_uv.reshape(-1, 2), np.repeat(np.arange(len(points)), 3))).astype(np.float32),
        new_uv.reshape(-1, 2),
        ids,
        side,
    )
    pos = np.array([mapping[:, :, 1] * side - 0.5, mapping[:, :, 0] * side - 0.5])
    face = np.rint(mapping[:, :, 2]).astype(int)
    for role in roles:
        file = folder / f"{role}.png"
        pixels = np.asarray(Image.open(file), np.float32)
        value = np.stack(
            [map_coordinates(ch, pos, order=1, mode="nearest") for ch in pixels.transpose(2, 0, 1)], -1
        )
        if role == "base":
            # Small features are painted on the final chart, where the skull
            # keeps its assigned texels instead of passing through two resizes.
            surface = chart(points.reshape(-1, 3), new_uv.reshape(-1, 2), ids, side)
            _, height, forward = surface.transpose(2, 0, 1)
            u = (forward - 6.11) / 0.087
            v = (height - 11.70) / 0.074
            iris = np.sqrt(u * u + v * v)
            amber = mix(
                np.array([103, 68, 39]),
                [177, 129, 63],
                np.clip(0.55 - 0.32 * v + 0.1 * np.sin(9 * np.arctan2(v, u)), 0, 1),
            )
            value = mix(value, amber, (1 - ramp(0.72, 1, iris)) * 0.88)
            pupil = np.sqrt((u / 0.48) ** 2 + (v / 0.63) ** 2)
            value = mix(value, [39, 39, 31], 1 - ramp(0.68, 1, pupil))
            glint = np.sqrt(((u - 0.19) / 0.17) ** 2 + ((v - 0.24) / 0.15) ** 2)
            value = mix(value, [232, 219, 180], (1 - ramp(0.32, 1.08, glint)) * 0.83)
        if role == "normal":
            old = value[:, :, :2] / 127.5 - 1
            r = rotation[face]
            x, y = old[:, :, 0], old[:, :, 1]
            u, v = r[:, :, 0] * x + r[:, :, 1] * y, r[:, :, 2] * x + r[:, :, 3] * y
            value = (np.stack((u, v, np.sqrt(np.maximum(0, 1 - u * u - v * v))), -1) + 1) * 127.5
        Image.fromarray(np.uint8(np.clip(value, 0, 255))).save(file, optimize=True)

# Small skin abrasions and dry silt at the lower flanks share the native
# lifecycle overlay. They are fully transparent on a healthy animal.
at = chart(points.reshape(-1, 3), new_uv.reshape(-1, 2), ids, 256)
x, y, z = at.transpose(2, 0, 1)
scratch = np.zeros(x.shape)
for zz, yy in [(1.42, 3.22), (1.53, 3.26), (1.64, 3.30), (-0.43, 2.02), (-0.35, 2.03)]:
    scratch = np.maximum(
        scratch,
        np.exp(-(((z - zz + 0.25 * (y - yy)) / 0.032) ** 2) - ((y - yy) / 0.27) ** 2)
        * ramp(0.52, 0.78, abs(x)),
    )
for role, color, alpha in [
    ("hurt", [126, 80, 65], scratch * 153),
    ("decay", [112, 111, 77], np.where(np.uint8(scratch * 153) > 0, 0, 47 + 65 * (1 - ramp(1.0, 2.8, y)))),
]:
    rgba = np.empty((256, 256, 4), np.uint8)
    rgba[:, :, :3] = color
    rgba[:, :, 3] = np.uint8(alpha)
    Image.fromarray(rgba).save(folder / (role + ".png"), optimize=True)

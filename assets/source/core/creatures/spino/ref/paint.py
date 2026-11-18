"""Bake the river palette from the full-resolution CC0 Grab3D Spinosaurus GLB."""

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
    np.asarray(Image.fromarray(c).resize((n, n), Image.Resampling.BILINEAR)) for c in coords.transpose(2, 0, 1)
]
texture = image(mat["pbrMetallicRoughness"]["baseColorTexture"]["index"]).resize(
    (n, n), Image.Resampling.LANCZOS
)
raw_rgb = np.asarray(texture, np.float32)
light = (raw_rgb * np.array([0.30, 0.59, 0.11], np.float32)).sum(2)
broad = np.asarray(texture.convert("L").filter(ImageFilter.GaussianBlur(12)), np.float32)
sail = ramp(2.97, 3.63, y) * (1 - ramp(2.65, 3.53, z)) * ramp(-2.25, -1.28, z)
head = ramp(3.85, 4.77, z)
underside = 1 - ramp(1.38, 2.55, y - 0.18 * np.minimum(z, 0) - 0.15 * np.maximum(z - 3, 0))
limbs = (1 - ramp(1.05, 1.85, y)) * ramp(0.45, 0.92, abs(x))
# Keep the donor's uneven scales and rib barring. Cool the flank like a
# river monitor, with a warm sand throat and a terracotta crown on the sail.
bars = 1 - ramp(62, 146, broad)
hide = mix(np.array([112, 138, 123]), [62, 81, 77], bars * 0.83)
hide = mix(hide, [190, 178, 142], underside * 0.9)
ridge = ramp(3.75, 4.99, y)
sail_colour = mix(np.array([210, 170, 95]), [149, 81, 55], ridge)
sail_colour = mix(sail_colour, [103, 69, 59], ramp(4.72, 5.15, y) * 0.48)
hide = mix(hide, sail_colour, sail)
hide = mix(hide, [116, 130, 105], head * 0.32)
hide = mix(hide, [119, 114, 89], limbs * 0.49)
gain = np.clip(0.78 + 0.23 * (light / 147) + 0.34 * (light - broad) / 125, 0.51, 1.34)
rgb = hide * gain[:, :, None]
# Leave the eye, lips and natural enamel on their original local contrast.
facial = head * (1 - ramp(0.10, 0.25, abs(y - (3.15 - 0.31 * (z - 4.8))))) * 0.42
rgb = mix(rgb, raw_rgb, facial)


def write(data, role, side=n, oral=None):
    img = Image.fromarray(np.uint8(np.clip(data, 0, 255))).resize(
        (side, side - side // 32), Image.Resampling.BOX if side <= 512 else Image.Resampling.LANCZOS
    )
    result = Image.new(img.mode, (side, side))
    result.paste(img, (0, 0))
    if oral is not None:
        band = np.broadcast_to(np.array(oral, np.uint8), (side // 32, side, len(oral))).copy()
        if role == "base":
            for lo, hi, colour in [
                (0.635, 0.675, [101, 98, 65]),
                (0.675, 0.695, [52, 58, 47]),
                (0.695, 0.715, [30, 40, 36]),
                (0.715, 0.735, [153, 117, 64]),
                (0.735, 0.75, [191, 152, 83]),
                (0.75, 0.78, [162, 103, 98]),
                (0.78, 1, [221, 212, 184]),
            ]:
                band[:, int(lo * side) : int(hi * side)] = colour
        if role == "packed":
            band[:, int(0.675 * side) : int(0.75 * side), 1] = 88
        result.paste(Image.fromarray(band), (0, side - side // 32))
    result.save(folder / f"{role}.png", optimize=True)


write(rgb, "base", oral=[141, 93, 84])
norm = (
    np.asarray(image(mat["normalTexture"]["index"]).resize((n, n), Image.Resampling.LANCZOS), np.float32)
    / 127.5
    - 1
)
norm[:, :, :2] *= 0.63
norm[:, :, 2] = np.sqrt(np.maximum(0.001, 1 - (norm[:, :, :2] ** 2).sum(2)))
write((norm + 1) * 127.5, "normal", oral=[128, 128, 255])
rough = np.asarray(
    image(mat["pbrMetallicRoughness"]["metallicRoughnessTexture"]["index"]).resize((n, n)), np.float32
)
write(
    np.stack(
        (222 + 23 * ramp(30, 174, light), np.clip(102 + 0.43 * rough[:, :, 1], 145, 215), np.zeros_like(light)),
        -1,
    ),
    "packed",
    512,
    [239, 130, 0],
)
m = np.stack(
    (
        (1 - sail) * (1 - underside) * (1 - head) * (1 - limbs) * 0.39,
        underside * (1 - limbs) * 0.37,
        sail * 0.55,
        bars * (1 - sail) * 0.28,
        head * 0.34,
        limbs * 0.44,
    ),
    -1,
)
m /= np.maximum(1, m.sum(2, keepdims=True))
write(m[:, :, :3] * 245, "mask", 512, [0, 0, 0])
write(m[:, :, 3:] * 245, "mask2", 512, [0, 0, 0])


# Woven slate blanket, chestnut leather, and small brass fittings share one saddle atlas.
def saddle_atlas():
    y, x = np.mgrid[:256, :256]
    patch = np.minimum(2, x * 3 // 256)
    grain = np.random.default_rng(17).normal(0, 2.8, x.shape)
    weave = (np.cos(x * np.pi / 2) + np.cos(y * np.pi / 2)) * 3
    colours = np.array([[64, 91, 92], [116, 77, 50], [166, 139, 89]])[patch]
    rgb = colours + np.where(patch == 0, weave + grain * 0.45, grain)[:, :, None]
    Image.fromarray(np.uint8(np.clip(rgb, 0, 255))).save(folder / "tack.png")


saddle_atlas()

# Reproject into the gameplay charts. Rotate source tangent normals into the new
# triangle basis; the face-to-UV correspondence includes the separated mouth.
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
for zz, yy in [(1.42, 2.22), (1.53, 2.26), (1.64, 2.30), (-0.43, 2.02), (-0.35, 2.03)]:
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

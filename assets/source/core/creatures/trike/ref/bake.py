"""Resample the donor's PBR maps in the registered mesh's tangent frame."""

import io
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt, map_coordinates
from register import smooth


def unit(v):
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-8)


glb = Path(sys.argv[1]).read_bytes()
end = 20 + int.from_bytes(glb[12:16], "little")
doc = json.loads(glb[20:end])
material = doc["materials"][0]
pbr = material["pbrMetallicRoughness"]


def image(slot):
    view = doc["bufferViews"][doc["images"][doc["textures"][slot["index"]]["source"]]["bufferView"]]
    start = end + 8 + view.get("byteOffset", 0)
    return np.asarray(Image.open(io.BytesIO(glb[start : start + view["byteLength"]])).convert("RGB"))


base = image(pbr["baseColorTexture"])
normal = image(material["normalTexture"])
packed = image(pbr["metallicRoughnessTexture"])
d = dict(np.load(sys.argv[2]))
out = Path(sys.argv[3])
facial_skin = np.asarray(Image.open(out.parent / "trike_skin_base.png").convert("RGB"))
used = d["used"]
ids = d["ids"]
dest = {k: np.zeros((*used.shape, 3), np.uint8) for k in ("base", "normal", "packed", "mask", "mask2")}
layers = {k: np.zeros((*used.shape, 4), np.uint8) for k in ("hurt", "decay")}
yy, xx = np.where(used)
for start in range(0, len(ids), 65536):
    span = slice(start, start + 65536)
    fi = d["faces"][span]
    tri = d["source_tri"][fi]
    a, b, c = np.moveaxis(d["points"][tri], 1, 0)
    ba = b - a
    ca = c - a
    delta = d["q"][span] - a
    dot = lambda u, v: (u * v).sum(axis=1)
    bb = dot(ba, ba)
    bc = dot(ba, ca)
    cc = dot(ca, ca)
    den = np.maximum(bb * cc - bc * bc, 1e-18)
    u = (dot(delta, ba) * cc - dot(delta, ca) * bc) / den
    v = (dot(delta, ca) * bb - dot(delta, ba) * bc) / den
    bary = np.column_stack((1 - u - v, u, v))
    uvs = d["source_uv"][fi]
    uv = (uvs * bary[:, :, None]).sum(axis=1)

    def sample(img):
        h, w = img.shape[:2]
        coords = np.stack(((1 - uv[:, 1]) * h - 0.5, uv[:, 0] * w - 0.5))
        return np.column_stack(
            [map_coordinates(img[..., k], coords, order=1, mode="grid-wrap") for k in range(3)]
        )

    rows, cols = yy[span], xx[span]
    albedo = sample(base)
    # The movable cheek has its own sculpted pores and an actual orbital
    # rim and airway. Keep that local frequency and recess shading while
    # carrying the warmer hide colour forward from beneath the donor shield.
    native = (
        d["facial_uv"][ids[span]] * np.column_stack((1 - d["w"][span].sum(axis=1), d["w"][span]))[:, :, None]
    ).sum(axis=1)
    patch = native[:, 2] > 0.995
    if np.any(patch):
        fu, fv = native[patch, :2].T
        hh, ww = facial_skin.shape[:2]
        at = np.stack(((1 - fv) * hh - 0.5, fu * ww - 0.5))
        face = np.column_stack(
            [map_coordinates(facial_skin[..., k], at, order=1, mode="nearest") for k in range(3)]
        ).astype(float)
        # Restrict the donor to broad pigment on moving tissue. Small folds
        # and cavities follow their authored positions through jaw motion.
        lum = face.mean(axis=1, keepdims=True)
        donor_colour = albedo[patch].astype(float)
        # Native dye atlases carry near-white pigment. Transfer their
        # relative grain and cavity shading to the darker donor hide.
        face = (0.65 * donor_colour + 0.35 * np.array([79, 67, 52])) * np.clip(lum / 168, 0.36, 1.18)
        albedo[patch] = np.rint(face).clip(0, 255)
    dest["base"][rows, cols] = albedo
    mro = sample(packed)
    mro[:, 0] = 255  # the GLB provides metallic/roughness only
    dest["packed"][rows, cols] = mro
    # Tangents must follow the charts after refitting. Decode the original
    # tangent normal, transport through the donor surface into the new basis.
    tn = sample(normal).astype(np.float32) / 127.5 - 1
    du, dv = uvs[:, 1] - uvs[:, 0], uvs[:, 2] - uvs[:, 0]
    det = du[:, 0] * dv[:, 1] - dv[:, 0] * du[:, 1]
    n = unit((d["normal"][tri] * bary[:, :, None]).sum(axis=1))
    t = (ba * dv[:, 1, None] - ca * du[:, 1, None]) * np.sign(det[:, None])
    t = unit(t - n * dot(t, n)[:, None])
    bt = np.cross(n, t) * np.sign(det[:, None])
    bumped = unit(t * tn[:, 0, None] + bt * tn[:, 1, None] + n * tn[:, 2, None])
    w = d["w"][span]
    weights = np.column_stack((1 - w.sum(axis=1), w))
    basis = (d["target_basis"][ids[span]] * weights[:, :, None]).sum(axis=1)
    n2 = unit(basis[:, :3])
    t2 = unit(basis[:, 3:6])
    b2 = np.cross(n2, t2) * np.sign(basis[:, 6, None])
    tangent = unit(np.column_stack((dot(bumped, t2), dot(bumped, b2), np.maximum(0.55, dot(bumped, n2)))))
    # The source and target cheeks have different jowls. Retain the target's
    # anatomical form beneath the donor's fine-scale normal on that insert.
    tangent[patch, :2] *= 0.33
    tangent = unit(tangent)
    dest["normal"][rows, cols] = np.rint((tangent + 1) * 127.5).clip(0, 255).astype(np.uint8)
    x, my, h = ((d["rest"][d["target_tri"][ids[span]]] * weights[:, :, None]).sum(axis=1)).T
    z = -my
    # Six original colour regions: flank, ventral, dorsal, shield, limbs and
    # keratin. Keep the multicolour pigment between them visible on wild stock.
    horn = smooth(1.83, 2.12, z) * smooth(2.11, 2.38, h)
    crest = smooth(0.60, 0.97, z) * (1 - smooth(1.58, 1.96, z)) * smooth(1.96, 2.66, h)
    leg = (1 - smooth(0.81, 1.35, h)) * smooth(-2.25, -1.86, z)
    keratin = np.maximum(horn, leg * (1 - smooth(0.14, 0.23, h)))
    belly = (1 - smooth(1.33, 1.77, h)) * (1 - leg) * (1 - keratin)
    back = smooth(1.95, 2.60, h) * (1 - crest) * (1 - horn)
    side = (1 - leg) * (1 - belly) * (1 - back) * (1 - crest) * (1 - horn)
    mask = np.column_stack(
        (side * 0.37, belly * 0.42, back * 0.34, crest * 0.53, leg * (1 - keratin) * 0.32, keratin * 0.43)
    )
    mask = np.rint(255 * mask / np.maximum(1, mask.sum(axis=1, keepdims=True))).astype(np.uint8)
    dest["mask"][rows, cols] = mask[:, :3]
    dest["mask2"][rows, cols] = mask[:, 3:]
    # Irregular short gashes follow the ribcage on each side. Decay follows
    # soft tissue and the actual light/dark variation in the scales.
    cut = np.zeros(len(h))
    for cz, ch in [(-1.37, 1.67), (-0.55, 1.53), (0.40, 1.79)]:
        dx = z - cz
        cut = np.maximum(
            cut, np.exp(-(((h - ch - 0.62 * dx - 0.032 * np.sin(21 * dx)) / 0.024) ** 2) - (dx / 0.18) ** 2)
        )
    cut *= smooth(0.62, 0.84, abs(x))
    wound = np.zeros((len(h), 4), np.uint8)
    wound[:, :3] = [88, 29, 21]
    wound[:, 3] = np.where(cut > 0.24, 100 + 145 * cut, 0)
    layers["hurt"][rows, cols] = wound
    rot = np.zeros_like(wound)
    rot[:, :3] = np.clip(albedo * [0.52, 0.59, 0.43], 0, 255)
    rot[:, 3] = np.where(
        wound[:, 3] > 0, 0, (0.30 + 0.54 * (1 - albedo.mean(axis=1) / 255)) * (1 - 0.82 * keratin) * 255
    )
    layers["decay"][rows, cols] = rot
pad = distance_transform_edt(~used, return_distances=False, return_indices=True)
for name, arr in {**dest, **layers}.items():
    im = Image.fromarray(arr[tuple(pad)][::-1])
    size = 2048 if name in ("base", "normal") else 512 if name in layers else 1024
    im.resize((size, size), Image.Resampling.BOX).save(out / (name + ".png"))
# Each 512px gameplay texel can hold either wound or decay, including at a
# downsampled wound boundary. Give the wound priority after low-pass filtering.
rot = np.array(Image.open(out / "decay.png"))
cut = np.array(Image.open(out / "hurt.png"))
rot[cut[:, :, 3] > 0, 3] = 0
Image.fromarray(rot).save(out / "decay.png")

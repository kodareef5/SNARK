"""The pictures of the fleet's abandoned statics (../<vehicle>_abandoned), made from the live vehicles' own: Python 3
with NumPy and Pillow, run by hand before `bun run art` builds them (README "Abandoned road vehicles").

A static dyes region 0 only, so the upholstery and the wheels (regions 1 and 2) are painted in at the vehicle's sample
colours, as a dye would show them, and its mask keeps the paint alone. As years standing in a street leave a car, as the
compact's abandoned pictures have it (../compact/tex/paint.py `save_abandoned`): its first knocks and first rust, the
first third of its hurt and decay pictures, show, with no paint on them, rough and dull. Dust, oxidation and dull paint
are the street finish's, by the static's place (content/street-finishes.ts). The normal and height maps are the
vehicle's own, named by the asset.

    python3 assets/source/core/vehicles/parked_common/paint.py
"""

import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
VEHICLES = os.path.dirname(HERE)
# Palette colours (shared/pack/palette.ts) of the regions' samples in the live assets' `regions`.
PALETTE = {84: (62, 68, 72), 91: (174, 182, 191), 97: (94, 89, 82), 104: (212, 207, 196), 220: (150, 98, 66)}
# How far into the hurt and decay pictures an abandoned vehicle shows: their first third, as the compact's.
FIRST = 1 - 0.8 / 3
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
# The regions a region map paints, in order (tools/pack/mask.ts).
REGION_COLOURS = np.array([(1, 0, 0), (0, 1, 0), (0, 0, 1), (0, 1, 1), (1, 0, 1), (1, 1, 0), (0, 0, 0)], np.float32)


def material(base, packed, hurt, decay, mask=None, regions=None):
    return dict(base=base, packed=packed, hurt=hurt, decay=decay, mask=mask, regions=regions)


# Where each asset's pictures go, the samples of its regions 1 and 2, and each material's pictures in the live vehicle's
# folders. The two vans share one set, as the live ones do.
JOBS = {
    "fastback_abandoned/tex": ((220, 91), {
        "enamel": material("fastback/tex/enamel.png", "fastback/tex/enamel_orm.png", "fastback/tex/enamel_hurt.png", "fastback/tex/enamel_decay.png", mask="fastback/tex/enamel_mask.png"),
        "detail": material("fastback/tex/detail.png", "fastback/tex/detail_orm.png", "fastback/tex/detail_hurt.png", "fastback/tex/detail_decay.png", mask="fastback/tex/detail_mask.png"),
    }),
    "veloce_abandoned/tex": ((84, 91), {
        "coachwork": material("sports/tex/base.png", "sports/tex/finish.png", "sports/tex/hurt.png", "sports/tex/decay.png", regions="sports/tex/regions.png"),
    }),
    "berlinetta_abandoned/tex": ((97, 91), {
        "coachwork": material("sports/tex/base.png", "sports/tex/finish.png", "sports/tex/hurt.png", "sports/tex/decay.png", regions="sports/tex/regions.png"),
    }),
    "parked_common/tex": ((104, 91), {
        f"road_van_{m}": material(f"van_common/tex/{m}-base.png", f"van_common/tex/{m}-packed.png", f"van_common/tex/{m}-hurt.png", f"van_common/tex/{m}-decay.png", mask=f"van_common/tex/{m}-mask.png")
        for m in ("coach", "fittings", "cabin")
    }),
    "patrol_sedan_abandoned/tex": ((97, 91), {
        "cruiser": material("patrol_sedan/tex/base.png", "patrol_sedan/tex/packed.png", "patrol_sedan/tex/hurt.png", "patrol_sedan/tex/decay.png", mask="patrol_sedan/tex/mask.png"),
    }),
    "patrol_jeep_abandoned/tex": ((104, 91), {
        "patrol": material("patrol_jeep/tex/patrol.png", "patrol_jeep/tex/surface.png", "patrol_jeep/tex/hurt.png", "patrol_jeep/tex/decay.png", mask="patrol_jeep/tex/regions.png"),
    }),
}


def read(path, size=None):
    im = Image.open(os.path.join(VEHICLES, path))
    if size and im.size != size:
        im = im.resize(size, Image.BILINEAR)
    return np.asarray(im).astype(np.float32) / 255


def lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((np.clip(c, 0, None) + 0.055) / 1.055) ** 2.4)


def srgb(c):
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.clip(c, 0, None) ** (1 / 2.4) - 0.055)


def weights(spec, size):
    """Each pixel's share of regions 0 to 2, at `size`."""
    if spec["mask"]:
        return read(spec["mask"], size)[..., :3]
    painted = read(spec["regions"], size)[..., :3]
    nearest = ((painted[..., None, :] - REGION_COLOURS) ** 2).sum(-1).argmin(-1)
    return np.stack([(nearest == k).astype(np.float32) for k in range(3)], -1)


def save(rgb, path, alpha=None):
    out = np.clip(rgb, 0, 1)
    if alpha is not None:
        out = np.concatenate([out, alpha[..., None]], -1)
    Image.fromarray(np.round(out * 255).astype(np.uint8)).save(path, optimize=True)


def paint(folder, samples, name, spec):
    base = read(spec["base"])
    size = (base.shape[1], base.shape[0])
    alpha = base[..., 3] if base.shape[-1] == 4 else None
    albedo = lin(base[..., :3])
    mask = weights(spec, size)
    # The material's grey, as the pack measures it (tools/art/materials.ts), divides a sample colour into a dye.
    share = mask.sum(-1)
    grey = float((share * (albedo @ LUMA)).sum() / max(share.sum(), 1e-6))
    for k, colour in ((1, samples[0]), (2, samples[1])):
        dye = lin(np.array(PALETTE[colour], np.float32) / 255) / max(grey, 1e-6)
        albedo *= (1 - mask[..., k:k + 1]) + mask[..., k:k + 1] * dye
    mask[..., 1:] = 0
    albedo = srgb(albedo)
    hurt, decay = read(spec["hurt"], size), read(spec["decay"], size)
    knocked = hurt[..., 3] >= FIRST
    rusted = (decay[..., 3] >= FIRST) & ~knocked
    albedo[knocked] = hurt[knocked][:, :3]
    albedo[rusted] = decay[rusted][:, :3]
    mask[knocked | rusted, 0] = 0
    out = os.path.join(VEHICLES, folder)
    os.makedirs(out, exist_ok=True)
    save(albedo, os.path.join(out, f"{name}_base.png"), alpha)
    # The packed map (occlusion, roughness, metal) at its own size: a knock is primer, rust rough, neither metal.
    packed = read(spec["packed"])[..., :3].copy()
    small = (packed.shape[1], packed.shape[0])
    at = lambda m: np.asarray(Image.fromarray(m.astype(np.uint8) * 255).resize(small, Image.NEAREST)) > 127
    packed[at(knocked), 1], packed[at(knocked), 2] = 0.6, 0.0
    packed[at(rusted), 1], packed[at(rusted), 2] = 0.9, 0.0
    save(packed, os.path.join(out, f"{name}_packed.png"))
    msize = Image.open(os.path.join(VEHICLES, spec["mask"] or spec["regions"])).size
    save(np.asarray(Image.fromarray(np.round(mask * 255).astype(np.uint8)).resize(msize, Image.BILINEAR)).astype(np.float32) / 255, os.path.join(out, f"{name}_mask.png"))
    print(f"{folder}/{name}: grey {grey:.3f}, knocked {knocked.mean() * 100:.1f}%, rusted {rusted.mean() * 100:.1f}%, paint {mask[..., 0].mean() * 100:.1f}%")


if __name__ == "__main__":
    for folder, (samples, materials) in JOBS.items():
        for name, spec in materials.items():
            paint(folder, samples, name, spec)

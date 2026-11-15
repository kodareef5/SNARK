# The opaque crown materials. Every head of a broadleaf crown is an opaque core wearing its kind's crown skin
# (tex/crown_skins/, a periodic rectangle twice as wide as it is tall), with only a fringe of cut-out cards round it.
# A level may be drawn with three materials, so a kind's skin shares its picture with what the kind has besides bark
# and leaves:
#
#   oak_crown       the oak skin, two periods down, so it is square
#   fig_crown       the fig skin above, and below it what the figs and the banyan swallowed (tex/ruins/), re-laid
#   mangrove_crown  the mangrove skin above, and below it the prop roots' picture (tex/mangrove_roots/)
#
# Each layer is resampled region by region, normals as directions. Until the skins are made, a stand-in is taken from
# each leaf atlas's mass, lifted to a lit crown's colour. Run with python3 from this folder; writes tex/<name>/.

import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from layout import RUINS, RUINS_SOURCE  # noqa: E402

TEX = os.path.join(HERE, "tex")
ROLES = ("base", "normal", "orm", "height")
# A skin's leaf atlas, for the stand-in, and the colour its mass is lifted to.
STANDIN = {"oak": ("oak_leaves", (104, 114, 64)), "fig": ("fig_leaves", (92, 104, 58)), "mangrove": ("mangrove_leaves", (84, 104, 56))}
# Each skin's colours scaled towards its kind's flat crown colours (the LIGHT and MID of oaks.py, figs.py), so a crown
# keeps its green as it turns flat: the skins came yellower, and the figs' and mangroves' lighter, than those.
TINT = {"oak": (0.88, 1.0, 1.0), "fig": (0.78, 0.92, 0.95), "mangrove": (0.82, 0.95, 0.95)}


def linear(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055) * 255


def read(path, role):
    """A layer as floats: colours 0 to 255, normals as unit directions, height as stored."""
    im = Image.open(path)
    if role == "height":
        return np.asarray(im).astype(np.float32)
    a = np.asarray(im.convert("RGB")).astype(np.float32)
    if role == "normal":
        n = a / 255 * 2 - 1
        return n / np.linalg.norm(n, axis=-1, keepdims=True)
    return a


def resample(a, w, h):
    """`a` to `w` by `h`, by area, each channel apart; normals made unit again."""
    if a.shape[1] == w and a.shape[0] == h:
        return a
    chans = a[..., None] if a.ndim == 2 else a
    out = np.stack([np.asarray(Image.fromarray(np.ascontiguousarray(chans[..., k])).resize((w, h), Image.BOX if w <= a.shape[1] else Image.BICUBIC)) for k in range(chans.shape[-1])], -1)
    return out[..., 0] if a.ndim == 2 else out


def write(a, path, role):
    if role == "height":
        Image.fromarray(np.clip(a.round(), 0, 65535).astype(np.uint16)).save(path)
    elif role == "normal":
        n = a / np.maximum(np.linalg.norm(a, axis=-1, keepdims=True), 1e-6)
        Image.fromarray(((n + 1) / 2 * 255).round().astype(np.uint8)).save(path)
    else:
        Image.fromarray(np.clip(a.round(), 0, 255).astype(np.uint8)).save(path)


def skin(kind, role, light=None):
    """A kind's skin layer: the made one in tex/crown_skins/, or the stand-in from its leaf atlas's mass. Its base colour
    as sun leaves (`light` "sun") or shade leaves ("shade"): the made pictures for each where there are, else the skin's
    own leaves made lighter and warmer, or darker and cooler, by SUN and SHADE."""
    if light and role == "base":
        own = os.path.join(TEX, "crown_skins", f"{kind}_skin_{light}_base.png")
        if os.path.exists(own):
            return read(own, role)
        return srgb(linear(skin(kind, role)) * np.array(SUN if light == "sun" else SHADE))
    made = os.path.join(TEX, "crown_skins", f"{kind}_skin_{role}.png")
    if os.path.exists(made):
        return read(made, role)
    atlas, target = STANDIN[kind]
    a = read(os.path.join(TEX, atlas, f"{atlas}_{role}.png"), role)
    a = a[a.shape[0] // 2 :]
    if role == "base":
        lin = linear(a)
        a = srgb(lin * linear(np.array(target, float)) / lin.reshape(-1, 3).mean(0))
    return a


# What the sun leaves and the shade leaves of a skin are against its own leaves, in light: a tree grows its outer
# leaves smaller, thicker, lighter and yellower, and its inner ones darker and bluer.
SUN = (1.55, 1.42, 1.0)
SHADE = (0.72, 0.8, 0.95)


def region(a, rect, size):
    u0, v0, u1, v1 = rect
    return a[round(v0 * size) : round(v1 * size), round(u0 * size) : round(u1 * size)]


# The cells' height, metres, as the 16 bits of the picture.
CELL_LOW, CELL_HIGH = -0.15, 0.25
# The core's leaves against the shade skin's, as sRGB scales, and the light let into it: the dark deep in a crown.
CORE_TINT = (0.62, 0.68, 0.72)
CORE_OPEN = 0.42
# A head's bowl, the leaves under it: lit from below by the ground and the sky round it.
BOWL_TINT = (0.95, 1.0, 1.02)
BOWL_OPEN = 0.7


def build_cells(name, atlas):
    """A crown picture of heads (layout.py CROWN_CELLS): the cells by tier and variant (cells.py), and the core's
    rectangle of shade leaves, the kind's shade skin at its own scale."""
    import cells
    from layout import CROWN_CELLS, crown_cell

    out = os.path.join(TEX, name)
    os.makedirs(out, exist_ok=True)
    kind = name.split("_")[0]
    made = cells.cells(atlas)
    side = 2048
    core = CROWN_CELLS[name]["core"]
    for role in ROLES:
        n = side // 2 if role == "orm" else side
        if role == "normal":
            pic = np.zeros((n, n, 3), np.float32)
            pic[..., 2] = 1.0
        elif role == "height":
            pic = np.full((n, n), 0.5 * 65535, np.float32)
        else:
            pic = np.zeros((n, n, 3), np.float32)
        # The core's rectangle and the heads' bowls', the shade skin: the core's darker and closed in.
        for rect, tint, light in ((core, CORE_TINT, CORE_OPEN), (CROWN_CELLS[name]["bowl"], BOWL_TINT, BOWL_OPEN)):
            top = skin(kind, role, "shade" if role == "base" else None)
            if role == "base":
                top = top * np.array(TINT[kind], np.float32) * np.array(tint, np.float32)
            if role == "orm":
                top = top * np.array((light, 1.0, 1.0), np.float32)
            if role == "height":
                metres = top / 65535.0 * 0.12 - 0.06
                top = (metres - CELL_LOW) / (CELL_HIGH - CELL_LOW) * 65535
            u0, v0, u1, v1 = rect
            w, h = round((u1 - u0) * n), round((v1 - v0) * n)
            pic[round(v0 * n) : round(v0 * n) + h, round(u0 * n) : round(u0 * n) + w] = resample(top, w, h)
        for (tier, variant), c in made.items():
            u0, v0, u1, v1 = crown_cell(name, tier, variant)
            w = round((u1 - u0) * n)
            if role == "base":
                got = c["base"]
            elif role == "normal":
                got = c["normal"]
            elif role == "height":
                got = np.clip((c["height"] - CELL_LOW) / (CELL_HIGH - CELL_LOW), 0, 1) * 65535
            else:
                got = np.dstack([c["occlusion"] * 255, c["rough"] * 255, np.zeros_like(c["rough"])])
            pic[round(v0 * n) : round(v0 * n) + w, round(u0 * n) : round(u0 * n) + w] = resample(np.asarray(got, np.float32), w, w)
        write(pic, os.path.join(out, f"{name}_{role}.png"), role)
    print(name)


def build(name):
    from layout import CROWN_CELLS

    if name in CROWN_CELLS:
        return build_cells(name, STANDIN[name.split("_")[0]][0])
    out = os.path.join(TEX, name)
    os.makedirs(out, exist_ok=True)
    for role in ROLES:
        kind = name.split("_")[0]
        # The sun leaves over the shade leaves, each the whole skin.
        top = np.concatenate([skin(kind, role, "sun"), skin(kind, role, "shade")], axis=0)
        if role == "base":
            top = top * np.array(TINT[kind], np.float32)
        side = 1024 if name == "oak_crown" else 2048
        if role == "orm":
            side //= 2
        if name == "oak_crown":
            pic = resample(top, side, side)
        else:
            pic = np.zeros((side, side) + top.shape[2:], np.float32)
            pic[: side // 2] = resample(top, side, side // 2)
            if name == "fig_crown":
                src = read(os.path.join(TEX, "ruins", f"ruins_{role}.png"), role)
                n = src.shape[0]
                # What no region takes is the ruins' mean, so nothing dark bleeds into them as they shrink.
                pic[side // 2 :] = src.reshape(-1, *src.shape[2:]).mean(0)
                for key, rect in RUINS.items():
                    u0, v0, u1, v1 = rect
                    w, h = round((u1 - u0) * side), round((v1 - v0) * side)
                    pic[round(v0 * side) : round(v0 * side) + h, round(u0 * side) : round(u0 * side) + w] = resample(region(src, RUINS_SOURCE[key], n), w, h)
            else:
                src = read(os.path.join(TEX, "mangrove_roots", f"mangrove_roots_{role}.png"), role)
                pic[side // 2 :] = resample(src, side, side // 2)
            if role == "normal":
                # Where nothing is laid, a flat normal.
                empty = np.linalg.norm(pic, axis=-1) < 0.5
                pic[empty] = (0.0, 0.0, 1.0)
        write(pic, os.path.join(out, f"{name}_{role}.png"), role)
    print(name)


if __name__ == "__main__":
    for name in sys.argv[1:] or ("oak_crown", "fig_crown", "mangrove_crown"):
        build(name)

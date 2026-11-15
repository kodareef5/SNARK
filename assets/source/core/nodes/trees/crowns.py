# The crown pictures the figs' and the mangroves' heads of leaves wear. A level may be drawn with three materials, so a
# kind's crown picture shares itself with what the kind has besides bark and leaves:
#
#   fig_crown       the fig's heads of leaves above (tex/fig_heads/, layout.py HEAD_CELLS); below them what the figs and
#                   the banyan swallowed (tex/ruins/), re-laid
#   mangrove_crown  the mangrove's heads of leaves above (tex/mangrove_heads/), the prop roots' picture below
#                   (tex/mangrove_roots/)
#
# The oak's crown picture (tex/oak_crown/) is all heads and is painted whole. Each layer is resampled region by region,
# normals as directions. Run with python3 from this folder; writes tex/<name>/.

import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from layout import RUINS, RUINS_SOURCE  # noqa: E402

TEX = os.path.join(HERE, "tex")
ROLES = ("base", "normal", "orm", "height")


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


def region(a, rect, size):
    u0, v0, u1, v1 = rect
    return a[round(v0 * size) : round(v1 * size), round(u0 * size) : round(u1 * size)]


def build(name):
    out = os.path.join(TEX, name)
    os.makedirs(out, exist_ok=True)
    kind = name.split("_")[0]
    for role in ROLES:
        top = read(os.path.join(TEX, f"{kind}_heads", f"{kind}_heads_{role}.png"), role)
        side = 1024 if role == "orm" else 2048
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
    for name in sys.argv[1:] or ("fig_crown", "mangrove_crown"):
        build(name)

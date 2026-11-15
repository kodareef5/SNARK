"""Puts the painters' layers together into the dodo's maps, the pictures asset.ts names in tex/.

    python3 -I compose.py [--out DIR]

Each painting group (GROUPS) writes its layers in tex/paint/<group>/layers/ (BRIEF.md says what each holds) and
owns the pieces and card rectangles listed here; texels it does not own are ignored. A group that has not painted
yet is drawn plain grey, so a bird partly painted can be built and looked at. Writes to tex/ unless --out is given.

What it does that no single painter can: holds the mean grey of every dyed region at 0.50 in linear light (the game
divides the dye by it); computes the normal from the joined height at each texel's true size on the bird; multiplies
the painters' fine occlusion by the modeller's form occlusion; and pads every map past the pieces' edges so filtering
draws no seams at any mip, keeping black between regions that are not neighbours on the colour ring.
"""

import json
import os
import site
import sys

site.addsitedir(site.getusersitepackages())

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt, zoom
from scipy.sparse import coo_matrix
from scipy.sparse.linalg import spsolve

HERE = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.dirname(HERE)
BAKES = os.path.join(os.path.dirname(TEX), "ref", "bakes")
GREY = 0.50
SIZE = 2048
CARD_SIZE = 512
CARD_PAINT = 2048
# The cards' picture spans about 0.19 m on the bird (the asset check measures it), so at the painting size a texel is:
CARD_TEXEL_MM = 190.0 / CARD_PAINT
# Every map is spread past each piece's edge all the way to the next piece, so that every mip, down to the smallest
# the game draws textured, mixes a piece only with its neighbours and never with empty texture.
PAD = 4096
REGION = [(255, 0, 0), (0, 255, 0), (0, 0, 255), (0, 255, 255), (255, 0, 255), (255, 255, 0)]
RING = [0, 5, 1, 3, 2, 4]

GROUPS = {
    "body": {"pieces": ["shell_body", "wing_l_out", "wing_l_in", "shoulder_l"], "cards": ["body"]},
    "trousers": {"pieces": [], "cards": ["trousers"]},
    "hood": {"pieces": ["shell_hood"], "cards": ["hood", "forehead", "mane"]},
    "face": {"pieces": ["shell_face", "brow_l", "pouch_out", "pouch_in"], "cards": []},
    "eye": {"pieces": ["eye_l", "lid_l_out", "lid_l_in"], "cards": []},
    "beak": {"pieces": ["beak", "jaw", "beak_palate", "jaw_floor", "tongue"], "cards": []},
    "leg": {"pieces": ["leg_l", "toe4_+188", "toe4_+30", "toe4_+4", "toe4_-24"], "cards": []},
    "quills": {"pieces": [], "cards": ["tail", "finger"]},
}


def neighbours(a, b):
    i, j = RING.index(a), RING.index(b)
    return (i - j) % 6 in (1, 5)


def lin(s):
    return np.where(s <= 0.04045, s / 12.92, ((s + 0.055) / 1.055) ** 2.4)


def srgb(l):
    l = np.clip(l, 0, 1)
    return np.where(l <= 0.0031308, l * 12.92, 1.055 * l ** (1 / 2.4) - 0.055)


def load(path, size, channels=None):
    if not os.path.exists(path):
        return None
    im = Image.open(path)
    a = np.asarray(im)
    a = a.astype(np.float64) / (65535.0 if a.dtype == np.uint16 or im.mode.startswith("I") else 255.0)
    if a.shape[0] != size:
        raise SystemExit(f"{path}: {a.shape[0]} pixels across, wants {size}")
    if channels == 1 and a.ndim == 3:
        a = a[..., 0]
    return a


def region_index(rgb8):
    idx = np.full(rgb8.shape[:2], -1, np.int32)
    for r, c in enumerate(REGION):
        idx[(rgb8 == np.array(c)).all(-1)] = r
    return idx


def region_rgb(idx):
    out = np.zeros(idx.shape + (3,), np.uint8)
    for r, c in enumerate(REGION):
        out[idx == r] = c
    return out


def fill_out(arr, covered, reach=PAD):
    """Carries each covered texel's value out to the uncovered texels within `reach`, from the nearest covered one."""
    dist, (iy, ix) = distance_transform_edt(~covered, return_indices=True)
    out = arr[iy, ix]
    keep = covered | (dist <= reach)
    return out, keep


def normal_from_height(h_mm, texel_mm, piece, texel_mm_v=None):
    """OpenGL tangent normal (green up the picture) from height in millimetres, each texel its own size (across, and
    down if `texel_mm_v` is given), never differencing across two pieces."""
    def diff(axis, size):
        a, b = np.roll(h_mm, -1, axis), np.roll(h_mm, 1, axis)
        pa, pb = np.roll(piece, -1, axis), np.roll(piece, 1, axis)
        ok_a, ok_b = pa == piece, pb == piece
        d = np.where(ok_a & ok_b, (a - b) / 2, np.where(ok_a, a - h_mm, np.where(ok_b, h_mm - b, 0.0)))
        return d / np.maximum(size, 1e-3)
    dx, dy = diff(1, texel_mm), diff(0, texel_mm if texel_mm_v is None else texel_mm_v)
    n = np.stack([-dx, dy, np.ones_like(h_mm)], -1)
    return n / np.linalg.norm(n, axis=-1, keepdims=True)


def hold_grey(base_lin, idx, mask, label, report):
    """Scales each dyed region, in linear light, so its mean grey is GREY. Painters aim for it; this holds it."""
    lum = (base_lin * [0.2126, 0.7152, 0.0722]).sum(-1)
    for r in range(6):
        m = (idx == r) & mask
        if not m.any():
            continue
        mean = lum[m].mean()
        k = GREY / max(mean, 1e-6)
        base_lin[m] = np.clip(base_lin[m] * k, 0, 1)
        report.append(f"{label} region {r}: mean grey {mean:.4f}, held at {GREY} (x{k:.3f})")
        if abs(k - 1) > 0.05:
            report.append(f"  warning: region {r} was more than 5% off; its painter should fix it")
    return base_lin


def ring_breaks(idx):
    bad = 0
    for a, b in ((idx[:-1], idx[1:]), (idx[:, :-1], idx[:, 1:])):
        touch = (a >= 0) & (b >= 0) & (a != b)
        for x, y in zip(*np.nonzero(touch)):
            if not neighbours(int(a[x, y]), int(b[x, y])):
                bad += 1
    return bad


CLASH = np.zeros((7, 7), bool)
for _a in range(6):
    for _b in range(6):
        CLASH[_a, _b] = _a != _b and not neighbours(_a, _b)


def separate(idx, original):
    """Puts black between padded texels of regions that are not ring neighbours, never touching painted texels."""
    for _ in range(4):
        bad = np.zeros(idx.shape, bool)
        for axis in (0, 1):
            for shift in (1, -1):
                other = np.roll(idx, shift, axis)
                bad |= CLASH[idx, other] & (idx >= 0) & (other >= 0)
        bad &= ~original
        if not bad.any():
            break
        idx = np.where(bad, -1, idx)
    return idx


def carried(value, hole, piece):
    """`value` carried into the texels of `hole` from the texels round them on the same piece: each the mean of its
    neighbours, so it is smooth and meets what is round it without a step. A hole with nothing round it is 0."""
    ys, xs = np.nonzero(hole)
    index = np.full(hole.shape, -1)
    index[ys, xs] = np.arange(len(ys))
    rows, cols = [], []
    known = np.zeros(len(ys))
    count = np.full(len(ys), 1e-6)
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        ny, nx = np.clip(ys + dy, 0, hole.shape[0] - 1), np.clip(xs + dx, 0, hole.shape[1] - 1)
        same = (piece[ny, nx] == piece[ys, xs]) & ((ny != ys) | (nx != xs))
        count += same
        inner = same & hole[ny, nx]
        rows.append(np.nonzero(inner)[0])
        cols.append(index[ny, nx][inner])
        outer = same & ~hole[ny, nx]
        known[outer] += value[ny, nx][outer]
    rows, cols = np.concatenate(rows), np.concatenate(cols)
    a = coo_matrix((np.concatenate([count, -np.ones(len(rows))]), (np.concatenate([np.arange(len(ys)), rows]),
                                                                  np.concatenate([np.arange(len(ys)), cols]))))
    out = np.zeros(hole.shape)
    out[ys, xs] = spsolve(a.tocsr(), known)
    return out


def form_occlusion(piece):
    """The modeller's form occlusion (ref/bakes/bake.py) at the maps' size. What a folded wing or a leg hides at rest,
    the flank under the wing, the skin a leg goes into, the wing's inner face and the top of the leg, bakes black, and
    the clips lift them off it. There it is the bake with them apart, brought to meet the skin round it."""
    whole, apart, hidden = (np.asarray(Image.open(os.path.join(BAKES, f"dodo_{name}.png")).convert("L")).astype(np.float64) / 255.0
                            for name in ("occlusion", "occlusion_apart", "covered"))
    k = SIZE // whole.shape[0]
    small = piece[::k, ::k]
    # The pieces with more than a few hidden texels: a neighbour's faces drawn a texel over a piece's edge are not its.
    named, count = np.unique(small[hidden > 0.5], return_counts=True)
    on = named[(count > 64) & (named > 0)]
    hidden = (hidden > 0.5) & np.isin(small, on)
    form = np.where(hidden, np.clip(apart + carried(whole - apart, hidden, small), 0, 1), whole)
    return np.where(np.isin(piece, on), zoom(form, k, order=1), zoom(whole, k, order=1))


def compose_dodo(out, report):
    meta = json.load(open(os.path.join(HERE, "pieces.json")))
    number = {p["name"]: p["number"] for p in meta["pieces"]}
    piece = np.asarray(Image.open(os.path.join(HERE, "pieces.png")))[..., 0].astype(np.int32)
    texel_mm = np.asarray(Image.open(os.path.join(HERE, "texel_mm.png"))).astype(np.float64) / 1000.0
    bake_idx = region_index(np.asarray(Image.open(os.path.join(BAKES, "dodo_regions.png")).convert("RGB")))
    form = form_occlusion(piece)
    covered = piece > 0

    base = np.full((SIZE, SIZE, 3), lin(188 / 255.0))
    height = np.zeros((SIZE, SIZE))
    rough = np.full((SIZE, SIZE), 0.8)
    occl = np.ones((SIZE, SIZE))
    idx = bake_idx.copy()
    for group, spec in GROUPS.items():
        own = np.isin(piece, [number[n] for n in spec["pieces"] if n in number])
        if not own.any():
            continue
        folder = os.path.join(HERE, group, "layers")
        b = load(os.path.join(folder, "dodo_base.png"), SIZE)
        if b is None:
            report.append(f"{group}: not painted yet; its pieces are plain grey")
            continue
        info = json.load(open(os.path.join(folder, "layers.json")))
        h = load(os.path.join(folder, "dodo_height.png"), SIZE, 1)
        ro = load(os.path.join(folder, "dodo_rough.png"), SIZE, 1)
        oc = load(os.path.join(folder, "dodo_occlusion.png"), SIZE, 1)
        rg = np.asarray(Image.open(os.path.join(folder, "dodo_regions.png")).convert("RGB"))
        if b.shape[-1] == 4:
            gaps = own & (b[..., 3] < 0.5)
            if gaps.any():
                report.append(f"{group}: {gaps.sum() / own.sum() * 100:.2f}% of its pieces' texels left unpainted; drawn grey")
            own = own & ~gaps
        base[own] = lin(b[..., :3][own])
        if h is not None:
            height[own] = h[own] * float(info["height_mm"])
        if ro is not None:
            rough[own] = ro[own]
        if oc is not None:
            occl[own] = oc[own]
        # A painter may change the regions on its own pieces where the design asks (the bars on the body, the neck's
        # last feathers over the face's margin); the ring rule is checked on the result.
        theirs = region_index(rg)
        changed = own & (theirs != bake_idx)
        if changed.any():
            pairs = {}
            for a, b in zip(bake_idx[changed], theirs[changed]):
                pairs[(int(a), int(b))] = pairs.get((int(a), int(b)), 0) + 1
            report.append(f"{group}: regions changed from the bake on {changed.sum()} texels: " + ", ".join(f"{a}->{b} {n}" for (a, b), n in sorted(pairs.items())))
        idx[changed] = theirs[changed]
        report.append(f"{group}: painted {own.sum()} texels")

    base = hold_grey(base, idx, covered, "dodo", report)
    packed_r = np.clip(occl * np.clip(form, 0, 1), 0, 1)
    # Each piece's relief about its own middle: pieces painted at different levels would otherwise meet in steps where
    # the padding of one runs into another's, and the stored height would no longer match the normals there.
    for k in np.unique(piece[covered]):
        m = piece == k
        height[m] -= np.median(height[m])

    base_f, keep = fill_out(base, covered)
    rough_f, _ = fill_out(rough, covered)
    occ_f, _ = fill_out(packed_r, covered)
    h_f, _ = fill_out(height, covered)
    # The normal everywhere, padding too, is the slope of the height as it is stored, each texel at the size of the
    # piece it was carried out from, so normal and height agree past the edges as well as on the pieces.
    piece_f, _ = fill_out(piece, covered)
    size_f, _ = fill_out(texel_mm, covered)
    normal_f = normal_from_height(h_f, size_f, piece_f)
    # Regions are carried out as far as the colour is, so that filtering across a piece's edge, and the far mips, mix
    # a region with itself and never with the undyed grey. Never-dyed texels inside a piece (eye, claws, mouth) stay
    # black; black is kept only where two regions that are not ring neighbours would meet.
    # Where two pieces touch in the layout with regions that are not ring neighbours (the beak and the face, under the
    # culmen), the face's texels there go black: they are inside the sheath, where nothing shows.
    face = piece == number.get("shell_face", -1)
    for axis in (0, 1):
        for shift in (1, -1):
            other, other_piece = np.roll(idx, shift, axis), np.roll(piece, shift, axis)
            touch = face & (other_piece != piece) & (other_piece > 0) & (idx >= 0) & (other >= 0) & CLASH[idx, other]
            if touch.any():
                report.append(f"dodo regions: {touch.sum()} face texels touching another piece's clashing region made black")
                idx = np.where(touch, -1, idx)
    dyed = covered & (idx >= 0)
    idx_f, _ = fill_out(idx, covered, reach=PAD)
    idx_f = np.where(covered, idx, np.where(keep, idx_f, -1))
    idx_f = separate(idx_f, dyed | (covered & (idx < 0)))
    breaks = ring_breaks(idx_f)
    report.append(f"dodo regions: {breaks} side-by-side texel pairs break the ring rule")

    grey_bg = lin(188 / 255.0)
    base_f = np.where(keep[..., None], base_f, grey_bg)
    normal_f = np.where(keep[..., None], normal_f, [0, 0, 1])
    span = max(float(h_f[covered].max() - h_f[covered].min()), 1e-6)
    lo = float(h_f[covered].min())
    write(out, "dodo", base_f, normal_f, np.where(keep, (h_f - lo) / span, 0.0), np.where(keep, occ_f, 1.0), np.where(keep, rough_f, 0.8), idx_f)
    report.append(f"dodo height: full range {span:.3f} mm")
    return {"height_mm": round(span, 4)}


def compose_cards(out, report):
    rects = json.load(open(os.path.join(BAKES, "bakes.json")))["material dodo_cards"]["rectangles"]
    n = CARD_PAINT
    owner = np.full((n, n), "", object)
    for group, spec in GROUPS.items():
        for kind in spec["cards"]:
            u0, v0, u1, v1 = rects[kind]
            owner[int(round((1 - v1) * n)):int(round((1 - v0) * n)), int(round(u0 * n)):int(round(u1 * n))] = group
    bake_rg = np.asarray(Image.open(os.path.join(BAKES, "dodo_cards_regions.png")).convert("RGB"))
    bake_idx = region_index(np.asarray(Image.fromarray(bake_rg).resize((n, n), Image.NEAREST)))
    rgb = np.full((n, n, 3), lin(188 / 255.0))
    alpha = np.zeros((n, n))
    height = np.zeros((n, n))
    rough = np.full((n, n), 0.85)
    occl = np.ones((n, n))
    idx = bake_idx.copy()
    for group in GROUPS:
        own = owner == group
        if not own.any():
            continue
        folder = os.path.join(HERE, group, "layers")
        b = load(os.path.join(folder, "cards_base.png"), n)
        if b is None:
            report.append(f"{group}: cards not painted yet; drawn as solid grey rectangles")
            alpha[own] = 1.0
            continue
        info = json.load(open(os.path.join(folder, "layers.json")))
        rgb[own] = lin(b[..., :3][own])
        alpha[own] = b[..., 3][own]
        h = load(os.path.join(folder, "cards_height.png"), n, 1)
        if h is not None:
            height[own] = h[own] * float(info.get("cards_height_mm", info["height_mm"]))
        ro = load(os.path.join(folder, "cards_rough.png"), n, 1)
        if ro is not None:
            rough[own] = ro[own]
        oc = load(os.path.join(folder, "cards_occlusion.png"), n, 1)
        if oc is not None:
            occl[own] = oc[own]
        theirs = region_index(np.asarray(Image.open(os.path.join(folder, "cards_regions.png")).convert("RGB")))
        mine = own & (theirs >= 0)
        idx[mine] = theirs[mine]
        report.append(f"{group}: painted its cards")
    solid = alpha >= 0.5
    rgb = hold_grey(rgb, idx, solid, "dodo_cards", report)
    for kind, (u0, v0, u1, v1) in rects.items():
        box = np.s_[int(round((1 - v1) * n)):int(round((1 - v0) * n)), int(round(u0 * n)):int(round(u1 * n))]
        if solid[box].any():
            height[box] -= np.median(height[box][solid[box]])
    # Everything carried past the cut from the nearest solid texel: colour, so filtering draws no fringe, and height,
    # roughness and occlusion, so the edge does not fall away into a rim that catches the light.
    rgb, _ = fill_out(rgb, solid, reach=n)
    height, _ = fill_out(height, solid, reach=n)
    rough, _ = fill_out(rough, solid, reach=n)
    occl, _ = fill_out(occl, solid, reach=n)
    piece = np.zeros((n, n), np.int32)
    size_u = np.full((n, n), CARD_TEXEL_MM)
    size_v = np.full((n, n), CARD_TEXEL_MM)
    measured = json.load(open(os.path.join(HERE, "pieces.json"))).get("cards", {})
    for k, kind in enumerate(rects, 1):
        u0, v0, u1, v1 = rects[kind]
        box = np.s_[int(round((1 - v1) * n)):int(round((1 - v0) * n)), int(round(u0 * n)):int(round(u1 * n))]
        piece[box] = k
        if kind in measured:
            size_u[box], size_v[box] = measured[kind]["mm_per_texel"]
    normal = normal_from_height(height, size_u, piece, size_v)
    f = n // CARD_SIZE

    def down(a):
        return a.reshape(CARD_SIZE, f, CARD_SIZE, f, *a.shape[2:]).mean(axis=(1, 3))

    nd = down(normal)
    nd /= np.linalg.norm(nd, axis=-1, keepdims=True)
    # Regions: each solid texel's own, carried out past the cut from the nearest solid texel (so the dye never mixes
    # with undyed grey where the cut is filtered), then the most common region in each small texel.
    idx_full, _ = fill_out(np.where(solid, idx, -1), solid, reach=n)
    small_idx = np.full((CARD_SIZE, CARD_SIZE), -1, np.int32)
    blocks = idx_full.reshape(CARD_SIZE, f, CARD_SIZE, f).transpose(0, 2, 1, 3).reshape(CARD_SIZE, CARD_SIZE, f * f)
    top = np.zeros((CARD_SIZE, CARD_SIZE), np.int64)
    for r in range(6):
        count = (blocks == r).sum(-1)
        take = count > top
        small_idx[take] = r
        top = np.maximum(top, count)
    small_solid = solid.reshape(CARD_SIZE, f, CARD_SIZE, f).mean(axis=(1, 3)) >= 0.5
    small_idx = separate(small_idx, small_solid)
    report.append(f"dodo_cards regions: {ring_breaks(small_idx)} side-by-side texel pairs break the ring rule")
    span = max(float(height.max() - height.min()), 1e-6)
    write(out, "dodo_cards", down(rgb), nd, down((height - height.min()) / span), down(occl), down(rough), small_idx, alpha=down(alpha))
    return {"cards_height_mm": round(span, 4)}


def write(out, name, base_lin, normal, height01, occl, rough, idx, alpha=None):
    b = np.round(srgb(base_lin) * 255).astype(np.uint8)
    if alpha is not None:
        b = np.dstack([b, np.round(np.clip(alpha, 0, 1) * 255).astype(np.uint8)])
    Image.fromarray(b).save(os.path.join(out, f"{name}_base.png"))
    Image.fromarray(np.round((normal * 0.5 + 0.5) * 255).astype(np.uint8)).save(os.path.join(out, f"{name}_normal.png"))
    Image.fromarray(np.round(np.clip(height01, 0, 1) * 65535).astype(np.uint16)).save(os.path.join(out, f"{name}_height.png"))
    packed = np.dstack([occl, rough, np.zeros_like(occl)])
    Image.fromarray(np.round(np.clip(packed, 0, 1) * 255).astype(np.uint8)).save(os.path.join(out, f"{name}_packed.png"))
    Image.fromarray(region_rgb(idx)).save(os.path.join(out, f"{name}_regions.png"))


def main():
    out = TEX
    if "--out" in sys.argv:
        out = sys.argv[sys.argv.index("--out") + 1]
        os.makedirs(out, exist_ok=True)
    report = []
    facts = {}
    facts.update(compose_dodo(out, report))
    facts.update(compose_cards(out, report))
    json.dump(facts, open(os.path.join(out, "maps.json"), "w"), indent=1)
    print("\n".join(report))


if __name__ == "__main__":
    main()

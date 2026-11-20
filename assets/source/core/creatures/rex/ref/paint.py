# Paints the Rex's dye regions, its dyed base, and its hurt and decay pictures, from tex/rex_source.png (ref/prepare.py).
#   blender -b --factory-startup --python-exit-code 1 -P assets/source/core/creatures/rex/ref/paint.py [-- preview]
#
# The regions are worked out on each vertex of the rest pose, from the bone that moves it most and which way its skin
# faces, then baked onto the texture by Cycles through the model's own UVs. Where a region dyes, the base becomes grey
# with the source's light and dark: the game multiplies it by the region's colour (client/core/render/surface.ts). The
# mouth, teeth and eyes are never dyed; they are found by their colour within the head. It prints each region's mean
# colour in the source; content/creatures/rex.ts gives a wild Rex the palette's nearest browns to them.
# With "preview", it also writes small pictures of the masks to var/rex/paint/ to look at.

import math
import os
import runpy
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
FOLDER = os.path.dirname(HERE)
TEX = os.path.join(FOLDER, "tex")
ROOT = os.path.abspath(os.path.join(FOLDER, "../../../../.."))
PREVIEW = "preview" in sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else False
REGIONS = ["Flanks", "Throat and belly", "Dorsal bars", "Face and nasal ridges", "Limbs and tail bands", "Claws and brow scutes"]
MASK = 2048  # the masks are stored one size under the 4K base
LAYER = 256  # hurt and decay


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def open_rest_pose():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    sys.path.insert(0, FOLDER)
    sys.dont_write_bytecode = True
    runpy.run_path(os.path.join(FOLDER, "import.py"), run_name="__main__")
    body = bpy.data.objects["rex_body"]
    for pb in bpy.data.objects["rex"].pose.bones:
        pb.location, pb.rotation_quaternion, pb.scale = (0, 0, 0), (1, 0, 0, 0), (1, 1, 1)
    bpy.context.view_layer.update()
    return body


def vertex_fields(body):
    """Per vertex: position, normal, the bone that moves it most, and how much the head bones move it."""
    me = body.data
    n = len(me.vertices)
    co = np.empty(n * 3, np.float32)
    me.vertices.foreach_get("co", co)
    nor = np.empty(n * 3, np.float32)
    me.vertices.foreach_get("normal", nor)
    co, nor = co.reshape(n, 3), nor.reshape(n, 3)
    names = {g.index: g.name for g in body.vertex_groups}
    owner = np.empty(n, object)
    head = np.zeros(n, np.float32)
    for v in me.vertices:
        best, top = "", -1.0
        for g in v.groups:
            name = names[g.group]
            if name in ("skull", "jaw"):
                head[v.index] += g.weight
            if g.weight > top:
                best, top = name, g.weight
        owner[v.index] = best
    return co, nor, owner, np.clip(head, 0, 1)


def regions(co, nor, owner, head):
    """Six weights a vertex, in the order of REGIONS, summing to 1. Forward is -Y, up is +Z, the Rex's left is +X."""
    fwd, up = -co[:, 1], co[:, 2]
    nz = nor[:, 2]
    kind = np.array([o.split("_")[0] if o else "" for o in owner])
    limb = np.isin(kind, ["thigh", "shank", "metatarsus", "toes", "humerus", "forearm"]).astype(np.float32)
    tail = (kind == "tail").astype(np.float32)
    tail_n = np.array([int(o.split("_")[1]) if o.startswith("tail_") else 0 for o in owner])
    # Claws: the front of each toe and the hand's tip. The brow: the bony ridge above each eye.
    toe_front = np.zeros_like(fwd)
    for side in ("l", "r"):
        on = owner == f"toes_{side}"
        if on.any():
            toe_front[on] = smooth(-0.15, 0.05, fwd[on] - np.percentile(fwd[on], 80))
    hand = np.zeros_like(fwd)
    for side in ("l", "r"):
        on = owner == f"forearm_{side}"
        if on.any():
            hand[on] = smooth(0.6, 0.9, (fwd[on] - fwd[on].min()) / max(1e-6, np.ptp(fwd[on])))
    skull_top = head * smooth(0.45, 0.8, nz) * smooth(-0.3, 0.1, -(fwd - (np.percentile(fwd[head > 0.5], 35) if (head > 0.5).any() else 0)))
    claws = np.maximum(np.maximum(toe_front, hand) * limb, skull_top * 0.8)
    face = head * (1 - smooth(-0.15, -0.5, nz))  # the throat under the jaw is belly
    limbs = limb.copy()
    # Bands round the tail's last three segments.
    rings = tail * (tail_n >= 3) * smooth(0.2, 0.55, np.sin(fwd * 2 * math.pi / 0.85))
    limbs = np.maximum(limbs, rings)
    belly = (1 - limb) * smooth(-0.2, -0.6, nz)
    # Dorsal bars across the top of the neck, back and tail.
    top = (1 - limb) * (1 - head) * smooth(0.35, 0.75, nz)
    bars = top * smooth(0.1, 0.45, np.sin(fwd * 2 * math.pi / 1.1 + 0.6 * np.sin(fwd * 0.9)))
    w = np.zeros((len(fwd), 6), np.float32)
    left = np.ones_like(fwd)
    # The more particular regions take their share first.
    for index, raw in ((5, claws), (3, face), (4, limbs), (1, belly), (2, bars)):
        share = np.clip(raw, 0, 1) * left
        w[:, index] = share
        left = left - share
    w[:, 0] = left
    return w


def bake(body, layers, size):
    """Bakes per-vertex colours onto pictures of `size`, through the body's UVs. layers: name -> (n, 3) array.
    Returns name -> (size, size, 3) array, rows top to bottom."""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 1
    scene.cycles.device = "CPU"
    me = body.data
    out = {}
    material = bpy.data.materials.new("bake")
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    attribute = nodes.new("ShaderNodeAttribute")
    emit = nodes.new("ShaderNodeEmission")
    output = nodes.new("ShaderNodeOutputMaterial")
    target = nodes.new("ShaderNodeTexImage")
    links.new(attribute.outputs["Color"], emit.inputs["Color"])
    links.new(emit.outputs["Emission"], output.inputs["Surface"])
    nodes.active = target
    body.data.materials.clear()
    body.data.materials.append(material)
    # The bake must not deform the body.
    for m in body.modifiers:
        m.show_render = False
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    for name, values in layers.items():
        attr = me.color_attributes.new(name, "FLOAT_COLOR", "POINT")
        rgba = np.ones((len(me.vertices), 4), np.float32)
        rgba[:, :3] = values
        attr.data.foreach_set("color", rgba.ravel())
        attribute.attribute_name = name
        image = bpy.data.images.new(name, size, size, alpha=False, float_buffer=True)
        image.colorspace_settings.name = "Non-Color"
        target.image = image
        bpy.ops.object.bake(type="EMIT", margin=8, margin_type="EXTEND", use_clear=True)
        px = np.empty(size * size * 4, np.float32)
        image.pixels.foreach_get(px)
        out[name] = px.reshape(size, size, 4)[::-1, :, :3].copy()
        print(f"paint: baked {name} at {size}")
    return out


def load(name):
    image = bpy.data.images.load(os.path.join(TEX, name))
    image.colorspace_settings.name = "Non-Color"
    w, h = image.size
    px = np.empty(w * h * 4, np.float32)
    image.pixels.foreach_get(px)
    return px.reshape(h, w, 4)[::-1].copy()


def save(name, rgba):
    """rgba: (h, w, 3 or 4) floats 0..1, rows top to bottom."""
    h, w, c = rgba.shape
    full = np.ones((h, w, 4), np.float32)
    full[:, :, :c] = rgba
    image = bpy.data.images.new(name, w, h, alpha=c == 4)
    image.colorspace_settings.name = "Non-Color"
    image.pixels.foreach_set(full[::-1].ravel())
    path = os.path.join(TEX, f"{name}.png") if not name.startswith("preview") else os.path.join(ROOT, "var/rex/paint", f"{name}.png")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    image.filepath_raw = path
    image.file_format = "PNG"
    image.save()
    print(f"paint: wrote {path}")


def up(a, factor):
    return np.repeat(np.repeat(a, factor, axis=0), factor, axis=1)


def down(a, factor):
    h, w = a.shape[0] // factor, a.shape[1] // factor
    return a.reshape(h, factor, w, factor, *a.shape[2:]).mean(axis=(1, 3))


def blur(a, r):
    """A box average over (2r + 1) texels each way."""
    def along(x, axis):
        c = np.cumsum(np.pad(x, [(r + 1, r) if i == axis else (0, 0) for i in range(x.ndim)], mode="edge"), axis=axis, dtype=np.float64)
        n = x.shape[axis]
        hi = np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis)
        lo = np.take(c, np.arange(0, n), axis=axis)
        return ((hi - lo) / (2 * r + 1)).astype(np.float32)
    return along(along(a, 0), 1)


def to_linear(s):
    return np.where(s <= 0.04045, s / 12.92, ((s + 0.055) / 1.055) ** 2.4)


def to_srgb(l):
    return np.where(l <= 0.0031308, l * 12.92, 1.055 * np.power(np.maximum(l, 0), 1 / 2.4) - 0.055)


def wounds(co, nor):
    """Claw rakes on the flanks and thigh, as a 0..1 field a vertex: four parallel scores in each of three places."""
    fwd, up_ = -co[:, 1], co[:, 2]
    side = np.abs(nor[:, 0])
    w = np.zeros(len(fwd), np.float32)
    for cf, cu, length, slope in ((1.2, 3.7, 0.9, -0.5), (-0.4, 3.3, 0.7, 0.6), (2.3, 4.4, 0.6, -0.3)):
        along = (fwd - cf) / length
        feather = np.clip(1 - along**2, 0, 1)
        for k in range(4):
            d = np.abs(up_ - cu - k * 0.13 - (fwd - cf) * slope)
            w = np.maximum(w, feather * (1 - smooth(0.02, 0.05, d)))
    return w * smooth(0.5, 0.8, side)


def main():
    body = open_rest_pose()
    co, nor, owner, head = vertex_fields(body)
    w = regions(co, nor, owner, head)
    wound = wounds(co, nor)
    baked = bake(body, {"mask": w[:, 0:3], "mask2": w[:, 3:6], "head": np.repeat(head[:, None], 3, 1),
                        "wound": np.repeat(wound[:, None], 3, 1)}, MASK)
    source = load("rex_source.png")[:, :, :3]  # sRGB values, 4096
    n = source.shape[0]
    k = n // MASK
    # The mouth, teeth and eyes in the head: pink and red flesh, bright pale teeth, and the saturated orange eye.
    head4 = up(baked["head"][:, :, 0], k)
    r, g, b = source[:, :, 0], source[:, :, 1], source[:, :, 2]
    hi, lo = source.max(axis=2), source.min(axis=2)
    sat = (hi - lo) / np.maximum(hi, 1e-4)
    # Measured on the source: the mouth's flesh has red over green 1.36 to 1.47 and green over blue 1.14 to 1.29; the
    # face's skin red over green 1.22 to 1.32 and green over blue 1.42 to 1.53.
    flesh = smooth(1.3, 1.38, r / np.maximum(g, 1e-3)) * (1 - smooth(1.3, 1.38, g / np.maximum(b, 1e-3))) * smooth(0.15, 0.22, r)
    teeth = smooth(0.74, 0.85, hi) * (1 - smooth(0.1, 0.2, sat))
    eye = smooth(0.55, 0.7, sat) * smooth(0.35, 0.5, r)
    raw = head4 * np.maximum(np.maximum(flesh, teeth), eye)
    # Pale scales on the face read as teeth one texel at a time. Averaged over a few texels they fade, while the mouth,
    # each tooth and the eye stay solid.
    keep = smooth(0.35, 0.6, blur(raw, 6))
    dye = 1 - keep
    masks = np.concatenate([up(baked["mask"], k), up(baked["mask2"], k)], axis=2) * dye[:, :, None]
    dyed = masks.sum(axis=2)
    # Each region's mean colour in the source, in linear light, where it alone dyes.
    lin = to_linear(source)
    print("paint: mean source colour of each region; a wild Rex's first colours are the palette's nearest browns:")
    for i, name in enumerate(REGIONS):
        weight = masks[:, :, i] * (masks[:, :, i] > 0.6)
        total = weight.sum()
        mean = (lin * weight[:, :, None]).sum(axis=(0, 1)) / max(total, 1)
        rgb = (to_srgb(mean) * 255).round().astype(int)
        print(f"  {i} {name}: 0x{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}, {100 * total / n / n:.1f}% of the picture")
    # The base: grey with the source's lightness where dyed, the source's own colour elsewhere.
    luma = (lin * np.array([0.2126, 0.7152, 0.0722])).sum(axis=2)
    grey = to_srgb(luma)[:, :, None].repeat(3, 2)
    base = source * (1 - dyed[:, :, None]) + grey * dyed[:, :, None]
    save("rex_base", base)
    save("rex_mask", down(masks[:, :, 0:3], k))
    save("rex_mask2", down(masks[:, :, 3:6], k))
    # Hurt: dark red scores where the claws raked. Decay: dull grey-brown everywhere else.
    rake = down(up(baked["wound"][:, :, 0], k), n // LAYER)
    shade = down(luma, n // LAYER)
    hurt = np.zeros((LAYER, LAYER, 4), np.float32)
    hurt[:, :, 0], hurt[:, :, 1], hurt[:, :, 2] = 0.33 + 0.1 * shade, 0.11 + 0.05 * shade, 0.10 + 0.04 * shade
    hurt[:, :, 3] = np.where(rake > 0.08, 0.33 + 0.6 * rake, 0)
    save("rex_hurt", hurt)
    decay = np.zeros_like(hurt)
    decay[:, :, 0], decay[:, :, 1], decay[:, :, 2] = 0.27 + 0.1 * shade, 0.25 + 0.1 * shade, 0.19 + 0.08 * shade
    noise = np.random.default_rng(7).random((LAYER, LAYER)).astype(np.float32)
    decay[:, :, 3] = np.where(hurt[:, :, 3] > 0, 0, 0.18 + 0.25 * noise)
    save("rex_decay", decay)
    if PREVIEW:
        save("preview_mask", down(masks[:, :, 0:3], 4 * k))
        save("preview_mask2", down(masks[:, :, 3:6], 4 * k))
        save("preview_keep", down(np.repeat(keep[:, :, None], 3, 2), 4 * k))
        save("preview_base", down(base, 4 * k))


main()

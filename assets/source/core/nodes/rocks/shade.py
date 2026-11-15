# The materials the carved rocks are baked from. Each is a Blender node tree on
# the high solid: the surface pictures in tex/<kind>/ laid on from three sides,
# blended by the marks forms.py left on the solid (its beds, its cups, which
# way it faces, how high it stands) into one base colour, roughness, bump and
# metalness, which make.py bakes into each rock's own pictures.

import os

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))


class Tree:
    """A small helper for building a node tree by hand."""

    def __init__(self, mat):
        self.nodes = mat.node_tree.nodes
        self.links = mat.node_tree.links
        self.nodes.clear()

    def node(self, kind, **inputs):
        n = self.nodes.new(kind)
        for k, v in inputs.items():
            if isinstance(k, str) and k.startswith("_"):
                setattr(n, k[1:], v)
                continue
            self.set(n.inputs[k], v)
        return n

    def set(self, socket, v):
        if hasattr(v, "is_output") or isinstance(v, bpy.types.NodeSocket):
            self.links.new(v, socket)
        elif isinstance(v, bpy.types.Node):
            self.links.new(v.outputs[0], socket)
        else:
            socket.default_value = v

    def math(self, op, a, b=0.0, clamp=False):
        n = self.node("ShaderNodeMath", _operation=op, _use_clamp=clamp)
        self.set(n.inputs[0], a)
        self.set(n.inputs[1], b)
        return n.outputs[0]

    def mix(self, a, b, f, blend="MIX"):
        n = self.node("ShaderNodeMix", _data_type="RGBA", _blend_type=blend)
        self.set(n.inputs[0], f)
        self.set(n.inputs[6], a)
        self.set(n.inputs[7], b)
        return n.outputs[2]

    def mixf(self, a, b, f):
        n = self.node("ShaderNodeMix", _data_type="FLOAT")
        self.set(n.inputs[0], f)
        self.set(n.inputs[2], a)
        self.set(n.inputs[3], b)
        return n.outputs[0]

    def ramp(self, f, a, b):
        """0 at a, 1 at b, smooth between, held beyond; a may be above b."""
        n = self.node("ShaderNodeMapRange", _interpolation_type="SMOOTHSTEP")
        self.set(n.inputs["Value"], f)
        n.inputs["From Min"].default_value = min(a, b)
        n.inputs["From Max"].default_value = max(a, b)
        if a > b:
            n.inputs["To Min"].default_value = 1.0
            n.inputs["To Max"].default_value = 0.0
        return n.outputs[0]

    def noise(self, vec, scale, detail=3.0, rough=0.55, out=0):
        n = self.node("ShaderNodeTexNoise", _noise_dimensions="3D")
        self.set(n.inputs["Vector"], vec)
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = rough
        return n.outputs[out]

    def picture(self, path, vec, data=False):
        img = bpy.data.images.load(path, check_existing=True)
        if data:
            img.colorspace_settings.name = "Non-Color"
        n = self.node("ShaderNodeTexImage", _projection="BOX", _projection_blend=0.3, _interpolation="Cubic")
        n.image = img
        self.set(n.inputs["Vector"], vec)
        return n.outputs[0]

    def rgb(self, r, g, b):
        n = self.node("ShaderNodeRGB")
        n.outputs[0].default_value = (srgb(r), srgb(g), srgb(b), 1)
        return n.outputs[0]


def srgb(c):
    """A display value 0 to 255 as light."""
    c = c / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


# The marks forms.py leaves on a solid, four to a colour on each vertex of the high mesh, by attribute.
MARKS = (("marks", ("tone", "groove", "sunk", "bark")), ("marks2", ("fresh", "vein", "rust", "paint")), ("marks3", ("crown", "crest", "spare1", "spare2")))


class Inputs:
    """What every rock's material starts from: its coordinates in metres and in pictures, which way it faces, its marks."""

    def __init__(self, name, span):
        self.mat = bpy.data.materials.new(name)
        self.mat.use_nodes = True
        t = self.t = Tree(self.mat)
        self.out = t.node("ShaderNodeOutputMaterial")
        self.out.name = "out"
        self.bsdf = t.node("ShaderNodeBsdfPrincipled")
        self.bsdf.name = "bsdf"
        t.set(self.out.inputs["Surface"], self.bsdf.outputs[0])
        self.coords = t.node("ShaderNodeTexCoord").outputs["Object"]
        vec = t.node("ShaderNodeVectorMath", _operation="SCALE")
        t.set(vec.inputs[0], self.coords)
        vec.inputs["Scale"].default_value = 1 / span
        self.uvw = vec.outputs[0]
        geo = t.node("ShaderNodeNewGeometry")
        sep_n = t.node("ShaderNodeSeparateXYZ")
        t.set(sep_n.inputs[0], geo.outputs["Normal"])
        sep_p = t.node("ShaderNodeSeparateXYZ")
        t.set(sep_p.inputs[0], self.coords)
        self.nz, self.z = sep_n.outputs[2], sep_p.outputs[2]
        self.marks = {}
        for attr, keys in MARKS:
            a = t.node("ShaderNodeAttribute", _attribute_name=attr, _attribute_type="GEOMETRY")
            sep = t.node("ShaderNodeSeparateColor")
            t.set(sep.inputs[0], a.outputs["Color"])
            self.marks.update(zip(keys, (sep.outputs[0], sep.outputs[1], sep.outputs[2], a.outputs["Alpha"])))

    def finish(self, colour, rough, height, distance, metal=0.0):
        """The surface, and two emissions make.py bakes through: the base colour (a metal's, too) and the metalness."""
        t = self.t
        t.set(self.bsdf.inputs["Base Color"], colour)
        t.set(self.bsdf.inputs["Roughness"], rough)
        t.set(self.bsdf.inputs["Metallic"], metal)
        bump = t.node("ShaderNodeBump", Strength=1.0, Distance=distance)
        t.set(bump.inputs["Height"], height)
        t.set(self.bsdf.inputs["Normal"], bump.outputs[0])
        e = t.node("ShaderNodeEmission")
        e.name = "emit_metal"
        t.set(e.inputs["Color"], (metal, metal, metal, 1.0) if isinstance(metal, float) else metal)
        c = t.node("ShaderNodeEmission")
        c.name = "emit_colour"
        t.set(c.inputs["Color"], colour)
        return self.mat


def emit(ob, which=None):
    """Shows the surface as one of its emissions, `emit_colour` or `emit_metal`, for a bake to read, or as itself."""
    nodes = ob.data.materials[0].node_tree.nodes
    links = ob.data.materials[0].node_tree.links
    links.new(nodes[which or "bsdf"].outputs[0], nodes["out"].inputs["Surface"])


def limestone(name, span=1.5):
    """The pale limestone: clean skin on the sides, grey-black crust on the tops and in the cups, sand low down."""
    i = Inputs(name, span)
    t, coords, uvw, nz, z = i.t, i.coords, i.uvw, i.nz, i.z
    tone, groove, sunk, bark, fresh = (i.marks[k] for k in ("tone", "groove", "sunk", "bark", "fresh"))

    tex = os.path.join(HERE, "tex", "limestone")
    clean = t.picture(os.path.join(tex, "weathered_base.png"), uvw)
    crust_c = t.picture(os.path.join(tex, "weathered_crust_base.png"), uvw)
    height = t.picture(os.path.join(tex, "weathered_height.png"), uvw, data=True)
    rough = t.picture(os.path.join(tex, "weathered_rough.png"), uvw, data=True)

    crown, crest = i.marks["crown"], i.marks["crest"]
    # The crust: the crown, where the mass faces the sky and the spray, goes grey, darkest in patches; the flanks stay
    # pale honey. Its edge is ragged, reaching down the upper flanks in streaks where rain has run off the crown and
    # further into hollows; its sharpest crests are worn paler.
    patches = t.noise(coords, 1.4, 3)
    streak = t.node("ShaderNodeVectorMath", _operation="MULTIPLY")
    t.set(streak.inputs[0], coords)
    streak.inputs[1].default_value = (7.0, 7.0, 0.7)
    runs = t.ramp(t.noise(streak.outputs[0], 1.0, 2), 0.5, 0.68)
    # By exposure: the crown, every small up-facing step, and the hollows where water sits.
    crust = t.math("ADD", t.math("MULTIPLY", crown, 1.6), t.math("MULTIPLY", t.math("SUBTRACT", patches, 0.5), 0.7))
    crust = t.math("ADD", crust, t.math("MULTIPLY", t.ramp(nz, 0.55, 0.9), 0.35))
    crust = t.math("ADD", crust, t.math("MULTIPLY", t.math("SUBTRACT", 0.5, height), 0.4))
    crust = t.math("ADD", crust, t.math("MULTIPLY", sunk, 0.3))
    # A broken edge, graded over a hand or two, and rain streaks running down from it below every pit and ledge.
    crust = t.math("ADD", crust, t.math("MULTIPLY", t.math("SUBTRACT", t.noise(coords, 9, 3), 0.5), 0.5))
    crust = t.ramp(crust, 0.45, 0.85)
    stain = t.math("MULTIPLY", runs, t.math("MULTIPLY", t.ramp(crown, 0.02, 0.4), t.math("SUBTRACT", 1.0, crust)))
    crust = t.math("MAXIMUM", crust, t.math("MULTIPLY", stain, 0.75))
    # The steepest teeth of the crown worn back to honey; pale scars where a piece of the crust has fallen.
    crust = t.math("MULTIPLY", crust, t.math("SUBTRACT", 1.0, t.math("MULTIPLY", crest, 0.55)))
    vor = t.node("ShaderNodeTexVoronoi", _voronoi_dimensions="3D")
    t.set(vor.inputs["Vector"], coords)
    vor.inputs["Scale"].default_value = 4.0
    pick = t.node("ShaderNodeSeparateColor")
    t.set(pick.inputs[0], vor.outputs["Color"])
    scar = t.ramp(pick.outputs[0], 0.93, 0.945)
    crust = t.math("MULTIPLY", crust, t.math("SUBTRACT", 1.0, t.math("MULTIPLY", scar, 0.85)))
    crust = t.math("MULTIPLY", crust, t.ramp(z, 0.12, 0.45))
    clean = t.mix(clean, t.rgb(246, 222, 176), 0.58)
    dark = t.node("ShaderNodeMix", _data_type="RGBA", _blend_type="MULTIPLY")
    t.set(dark.inputs[0], 1.0)
    t.set(dark.inputs[6], crust_c)
    t.set(dark.inputs[7], t.rgb(205, 212, 218))
    crust_colour = t.mix(dark.outputs[2], t.rgb(56, 61, 57), t.math("MULTIPLY", t.ramp(patches, 0.45, 0.7), 0.75))
    # Each bed of the clean stone its own shade, greyer or warmer; the crust over them is one skin.
    clean = t.mix(clean, t.rgb(206, 202, 188), t.math("MULTIPLY", t.ramp(tone, 0.5, 0.0), 0.3))
    clean = t.mix(clean, t.rgb(230, 206, 160), t.math("MULTIPLY", t.ramp(tone, 0.5, 1.0), 0.25))
    colour = t.mix(clean, crust_colour, crust)
    # Dirt along the bedding grooves and deep in the big cups.
    colour = t.mix(colour, t.rgb(112, 100, 82), t.math("MULTIPLY", groove, 0.5))
    # Deep pits go nearly black; shallow ones stay the stone's colour, their shadow is in the relief.
    colour = t.mix(colour, t.rgb(52, 46, 38), t.math("MULTIPLY", t.ramp(sunk, 0.25, 0.85), 0.8))
    # A little darker at the foot, with sand caught in its hollows.
    colour = t.mix(colour, t.rgb(186, 168, 136), t.math("MULTIPLY", t.ramp(z, 0.22, 0.0), 0.2))
    sandy = t.math("MULTIPLY", t.ramp(z, 0.3, 0.02), t.ramp(t.math("ADD", t.noise(coords, 5, 3), t.math("MULTIPLY", t.math("SUBTRACT", 0.5, height), 0.8)), 0.45, 0.62))
    colour = t.mix(colour, t.rgb(222, 205, 170), t.math("MULTIPLY", sandy, 0.8))
    # A fresh break: new pale stone, with a little dust settled in its hollows.
    fresh_c = t.picture(os.path.join(tex, "fresh_base.png"), uvw)
    fresh_h = t.picture(os.path.join(tex, "fresh_height.png"), uvw, data=True)
    fresh_r = t.picture(os.path.join(tex, "fresh_rough.png"), uvw, data=True)
    colour = t.mix(colour, fresh_c, fresh)
    height = t.mixf(height, fresh_h, fresh)
    rough = t.mixf(rough, fresh_r, fresh)
    # Fig roots: smooth grey bark, its own pictures at 0.75 m across, its relief a quarter of the stone's.
    sc = t.node("ShaderNodeVectorMath", _operation="SCALE")
    t.set(sc.inputs[0], coords)
    sc.inputs["Scale"].default_value = 1 / 0.75
    roots = os.path.join(HERE, "tex", "roots")
    bark_c = t.picture(os.path.join(roots, "bark_base.png"), sc.outputs[0])
    bark_h = t.picture(os.path.join(roots, "bark_height.png"), sc.outputs[0], data=True)
    bark_r = t.picture(os.path.join(roots, "bark_rough.png"), sc.outputs[0], data=True)
    # Bark: grey-brown, dark in its creases, with relief enough to read.
    bark_c = t.mix(t.mix(bark_c, t.rgb(116, 106, 92), 0.35), t.rgb(70, 62, 52), t.math("MULTIPLY", t.math("SUBTRACT", 1.0, bark_h), 0.55))
    colour = t.mix(colour, bark_c, bark)
    height = t.mixf(height, t.math("ADD", t.math("MULTIPLY", bark_h, 0.7), 0.15), bark)
    return i.finish(colour, t.mixf(rough, bark_r, bark), height, 0.04)


def ore(name, span=1.5):
    """The ore stone: dark mottled skin, brassy seams of ore that are metal, rust bled down below them, pale fresh breaks."""
    i = Inputs(name, span)
    t, coords, uvw, nz, z = i.t, i.coords, i.uvw, i.nz, i.z
    tone, vein, rust, fresh, crack = (i.marks[k] for k in ("tone", "vein", "rust", "fresh", "groove"))
    tex = os.path.join(HERE, "tex", "ore")

    def layer(kind):
        return [t.picture(os.path.join(tex, f"{kind}_{k}.png"), uvw, data=k != "base") for k in ("base", "height", "rough")]

    colour, height, rough = layer("stone")
    # Blue-black and grey-green in broad patches, a little dust low down.
    colour = t.mix(colour, t.rgb(40, 48, 44), t.math("MULTIPLY", t.ramp(tone, 0.45, 0.1), 0.4))
    colour = t.mix(colour, t.rgb(80, 92, 74), t.math("MULTIPLY", t.ramp(tone, 0.55, 0.95), 0.5))
    colour = t.mix(colour, t.rgb(150, 136, 110), t.math("MULTIPLY", t.ramp(z, 0.25, 0.0), t.ramp(t.noise(coords, 4, 3), 0.48, 0.66)))
    # Rust from the seams, in its own streaks.
    rc = t.mix(t.picture(os.path.join(tex, "rust_base.png"), uvw), t.rgb(158, 86, 40), 0.45)
    cover = t.picture(os.path.join(tex, "rust_cover.png"), uvw, data=True)
    colour = t.mix(colour, rc, t.math("MULTIPLY", t.math("MULTIPLY", rust, 1.7), t.math("ADD", t.math("MULTIPLY", cover, 0.8), 0.35), clamp=True))
    # The seam's hairline, open and dark where no ore fills it.
    colour = t.mix(colour, t.rgb(26, 28, 26), t.math("MULTIPLY", crack, 0.85))
    # A fresh break is the stone's cool grey-green heart, lighter than its weathered skin.
    fc, fh, fr = layer("fresh")
    colour = t.mix(colour, t.mix(fc, t.rgb(156, 165, 151), 0.55), fresh)
    height = t.mixf(height, fh, fresh)
    rough = t.mixf(rough, fr, fresh)
    vc, vh, vr = layer("vein")
    metal = t.picture(os.path.join(tex, "vein_metal.png"), uvw, data=True)
    seam = t.ramp(vein, 0.2, 0.6)
    colour = t.mix(colour, vc, seam)
    height = t.mixf(height, vh, seam)
    rough = t.mixf(rough, vr, seam)
    metal = t.math("MULTIPLY", metal, seam)
    return i.finish(colour, rough, height, 0.02, metal)


# The paints a wall's stucco may carry, by the mark `tone`: chalky pink, faded mint, faded aqua, pale yellow.
PAINT_COLOURS = ((202, 148, 137), (157, 180, 157), (135, 179, 175), (213, 188, 122))


def rubble(name, span=1.5):
    """Old concrete, cast and broken; stucco with flaking paint; coral stone; cinder block; rusted rebar; grime and sand."""
    i = Inputs(name, span)
    t, coords, uvw, nz, z = i.t, i.coords, i.uvw, i.nz, i.z
    tone, broken, kind, rust, paint, fresh = (i.marks[k] for k in ("tone", "groove", "vein", "rust", "paint", "fresh"))
    tex = os.path.join(HERE, "tex", "rubble")

    def layer(kind_, scale=None):
        vec = uvw
        if scale is not None:
            v = t.node("ShaderNodeVectorMath", _operation="SCALE")
            t.set(v.inputs[0], coords)
            v.inputs["Scale"].default_value = 1 / scale
            vec = v.outputs[0]
        return [t.picture(os.path.join(tex, f"{kind_}_{k}.png"), vec, data=k != "base") for k in ("base", "height", "rough")]

    def blend(a, b, f):
        return [t.mix(a[0], b[0], f), t.mixf(a[1], b[1], f), t.mixf(a[2], b[2], f)]

    # Concrete: cast faces, and broken ones where it snapped (and where a pick has just broken it).
    cut = t.math("MAXIMUM", t.ramp(broken, 0.3, 0.7), fresh)
    s = blend(layer("cast"), layer("broken"), cut)
    s = blend(s, layer("coral"), t.ramp(kind, 0.2, 0.35))
    s = blend(s, layer("block"), t.ramp(kind, 0.7, 0.85))
    # Stucco and its paint, on a wall's outer face.
    face = t.ramp(paint, 0.3, 0.7)
    s = blend(s, layer("stucco"), face)
    hue = t.rgb(*PAINT_COLOURS[0])
    for k in range(1, 4):
        hue = t.mix(hue, t.rgb(*PAINT_COLOURS[k]), t.ramp(tone, (k - 0.5) / 3 - 0.02, (k - 0.5) / 3 + 0.02))
    left = t.picture(os.path.join(tex, "stucco_paint.png"), uvw, data=True)
    fade = t.picture(os.path.join(tex, "stucco_paint_tone.png"), uvw, data=True)
    painted_c = t.node("ShaderNodeMix", _data_type="RGBA", _blend_type="MULTIPLY")
    t.set(painted_c.inputs[0], 1.0)
    # Chalky: the sun has faded every paint toward the white of its lime.
    t.set(painted_c.inputs[6], t.mix(hue, t.rgb(242, 234, 222), 0.22))
    t.set(painted_c.inputs[7], t.math("MULTIPLY", fade, 2.0))
    colour = t.mix(s[0], painted_c.outputs[2], t.math("MULTIPLY", face, left))
    # Rain-dark grime low down and in the hollows between pieces; sand blown in at the foot.
    colour = t.mix(colour, t.rgb(96, 90, 78), t.math("MULTIPLY", t.ramp(z, 0.35, 0.0), 0.25))
    sandy = t.math("MULTIPLY", t.ramp(z, 0.22, 0.02), t.ramp(t.math("ADD", t.noise(coords, 4, 3), t.math("MULTIPLY", t.math("SUBTRACT", 0.5, s[1]), 0.8)), 0.5, 0.65))
    colour = t.mix(colour, t.rgb(214, 196, 160), t.math("MULTIPLY", sandy, 0.6))
    # Rebar: rusted iron.
    r = layer("rust", 0.25)
    colour = t.mix(colour, r[0], rust)
    return i.finish(colour, t.mixf(s[2], r[2], rust), t.mixf(s[1], r[1], rust), 0.03)

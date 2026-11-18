"""Bake an unlit lateral hide reference from each full-resolution Grab3D donor.

blender -b --disable-autoexec -P tools/dinosaurs/bake-flanks.py -- /path/to/downloads
"""
from pathlib import Path
import hashlib
import sys

import bpy
from mathutils import Vector

source = Path(sys.argv[sys.argv.index("--") + 1])
creatures = Path(__file__).resolve().parents[2] / "assets/source/core/creatures"
donors = [
    ("trike", "triceratops", "380dcd7f850db5d5e42b17425bbeb327cc6a5e4d1cf89d0898893b7271225f0e"),
    ("stego", "stegosaurus", "eab01a7bb9355e205144f56c0f495657e1f09cad9ef4b10735ad862a05317145"),
]
for species, name, digest in donors:
    path = source / (name + ".glb")
    if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        raise ValueError(f"Expected the full detail {name}.glb")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    material = bpy.context.object.data.materials[0]
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    surface = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    output = next(n for n in nodes if n.type == "OUTPUT_MATERIAL")
    emit = nodes.new("ShaderNodeEmission")
    links.new(surface.inputs["Base Color"].links[0].from_socket, emit.inputs["Color"])
    links.new(emit.outputs[0], output.inputs["Surface"])
    # Screen right follows +Z in the game. Both lateral swatches span
    # z=-3..3 m and y=.35..3.35 m, with transparent margins off the hide.
    bpy.ops.object.camera_add(location=(-12, 0, 1.85))
    cam = bpy.context.object
    cam.rotation_euler = Vector((1, 0, 0)).to_track_quat("-Z", "Y").to_euler()
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 6
    scene = bpy.context.scene
    scene.camera = cam
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 2
    scene.render.resolution_x = 2048
    scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "Standard"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.filepath = str(creatures / species / "ref/donor-flank.png")
    bpy.ops.render.render(write_still=True)

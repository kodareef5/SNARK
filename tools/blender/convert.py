# Turns a model in another format into a glTF binary, and does nothing else:
# no reduction, no renaming of bones, no change to the animation. Everything
# that decides how the game sees the model is done afterwards in TypeScript
# (tools/pack/creature.ts), where it can be tested.
#
#   blender --background --factory-startup --disable-autoexec \
#       --python tools/blender/convert.py -- in.fbx out.glb
#
# Every action in the file is written as an animation of its own, named as
# the action is, sampled at every frame.

import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1 :]
source, out = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=source)

# One track for each action, so that the exporter writes each as an animation.
for obj in bpy.context.scene.objects:
    if obj.type != "ARMATURE":
        continue
    if obj.animation_data is None:
        obj.animation_data_create()
    obj.animation_data.action = None
    for action in sorted(bpy.data.actions, key=lambda a: a.name):
        track = obj.animation_data.nla_tracks.new()
        track.name = action.name.split("|")[-1]
        track.strips.new(track.name, int(action.frame_range[0]), action)

bpy.ops.export_scene.gltf(
    filepath=out,
    export_format="GLB",
    export_yup=True,
    export_apply=False,
    export_skins=True,
    export_animations=True,
    export_animation_mode="NLA_TRACKS",
    export_force_sampling=True,
    export_materials="EXPORT",
    export_image_format="NONE",
)

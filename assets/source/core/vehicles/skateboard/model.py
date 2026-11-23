"""Mount the imported deck and running gear on the board's trick pivot."""

from pathlib import Path
import bpy

bpy.ops.import_scene.gltf(filepath=str(Path(__file__).with_name("deck.glb")))
board = next(obj for obj in bpy.context.scene.objects if obj.type == "MESH")
# Separate the two mirrored veneer edges within the atlas gutter at the nose and tail.
uv = board.data.uv_layers.active.data
for face in board.data.polygons:
    patch = uv[face.loop_start].uv
    if face.center.x < 0 and patch.x < 0.5 and 1 - 608/1024 < patch.y < 0.5:
        for loop in face.loop_indices:
            uv[loop].uv.x += 1/1024
armature = bpy.data.armatures.new("board")
rig = bpy.data.objects.new("board", armature)
bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
bone = armature.edit_bones.new("deck")
bone.head = (0, 0, 0.08)
bone.tail = (0, 0, 0.18)
bpy.ops.object.mode_set(mode="OBJECT")
group = board.vertex_groups.new(name="deck")
group.add(list(range(len(board.data.vertices))), 1.0, "REPLACE")
board.parent = rig
board.modifiers.new("board", "ARMATURE").object = rig

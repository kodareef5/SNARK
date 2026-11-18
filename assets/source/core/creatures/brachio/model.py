"""Load the fitted canopy skin onto its native skeleton."""

from pathlib import Path
import bpy
from mathutils import Matrix
import rig

with bpy.data.libraries.load(str(Path(__file__).with_name("canopy.blend"))) as (_, lib):
    lib.objects = ["Canopy Brachiosaurus"]
body = lib.objects[0]
bpy.context.collection.objects.link(body)
body.name = "brachio_body"
body.data.transform(Matrix.Translation(rig.SUPPORT_SHIFT))
body.parent = rig.armature()
body.modifiers.new("skin", "ARMATURE").object = body.parent

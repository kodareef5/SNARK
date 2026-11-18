"""Load the fitted river skin onto its native skeleton."""

from pathlib import Path
import bpy
import rig

with bpy.data.libraries.load(str(Path(__file__).with_name("river.blend"))) as (_, lib):
    lib.objects = ["River Spinosaurus"]
body = lib.objects[0]
bpy.context.collection.objects.link(body)
body.name = "spino_body"
body.parent = rig.armature()
body.modifiers.new("skin", "ARMATURE").object = body.parent

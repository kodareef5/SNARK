"""Attach the fitted Stegosaurus to its gameplay armature."""

from pathlib import Path
import bpy
import rig

with bpy.data.libraries.load(str(Path(__file__).with_name("stegosaurus.blend"))) as (_, library):
    library.objects = ["stego_body"]
body = library.objects[0]
bpy.context.collection.objects.link(body)
body.parent = rig.armature()
body.modifiers.new("skin", "ARMATURE").object = body.parent

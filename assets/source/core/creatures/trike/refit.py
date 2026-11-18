"""Bind the refitted Grab3D skin to the authored trike armature."""

from pathlib import Path
import bpy
import rig

folder = Path(__file__).resolve().parent
with bpy.data.libraries.load(str(folder / "triceratops.blend")) as (_, library):
    library.objects = ["Triceratops"]
body = library.objects[0]
bpy.context.collection.objects.link(body)
rig.bind(body)

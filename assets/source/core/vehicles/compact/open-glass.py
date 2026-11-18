# The live compact's clear panes also admit sight on a tier without alpha textures.
# Retain the outer band on its existing UVs. Wrecks use the complete weathered panes from model.py.
import os
import sys

import bmesh
import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parts import TAG

for obj in bpy.data.objects:
    if obj.type != "MESH":
        continue
    mesh = bmesh.new()
    mesh.from_mesh(obj.data)
    tag = mesh.faces.layers.int.get("tag")
    if tag:
        clear = []
        for face in mesh.faces:
            if face[tag] not in (TAG["glass"], TAG["glass_in"]):
                continue
            point = face.calc_center_median()
            z = -point.y
            if abs(point.x) < .58 and (.27 < z < .70 or -1.34 < z < -.73):
                clear.append(face)
        if clear:
            bmesh.ops.delete(mesh, geom=clear, context="FACES")
            # Join the inside and outside rims of each pane so the simplified levels keep a closed shell.
            boundary = [edge for edge in mesh.edges if edge.is_boundary]
            for front in (True, False):
                edges = [edge for edge in boundary if (-edge.verts[0].co.y > 0) == front]
                if edges:
                    faces = bmesh.ops.bridge_loops(mesh, edges=edges)["faces"]
                    uv = mesh.loops.layers.uv.active
                    for rim in faces:
                        rim.smooth = False
                        # A new inner edge has a separate UV island; interpolating between the two
                        # original panes would stretch the entire picture across this 7 mm strip.
                        coords = ((.001, .001), (.002, .001), (.002, .002), (.001, .002))
                        for index, loop in enumerate(rim.loops):
                            loop[uv].uv = coords[index % 4]
            mesh.to_mesh(obj.data)
    mesh.free()

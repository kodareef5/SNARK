"""Blender geometry review before native pack review. Never substitutes for the game's rendered sheets."""
import math
import os
import runpy
import sys
import bpy
from mathutils import Vector

FOLDER=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0,FOLDER)
os.environ["HELICOPTER_LAYOUT"]="new"
bpy.ops.wm.read_factory_settings(use_empty=True)
for source in ("rig.py","model.py"):
    runpy.run_path(os.path.join(FOLDER,source),run_name="__main__")
from parts import TAGS

palette={"paint":(.66,.62,.51),"jamb":(.35,.34,.30),"glass":(.13,.21,.22),"glass_in":(.1,.2,.2),"leather":(.36,.34,.29),"metal":(.32,.34,.35),"chrome":(.52,.54,.56),"panel":(.38,.39,.36),"headliner":(.48,.48,.42),"amber":(.95,.55,.06),"headlamp":(.43,.68,.70),"taillamp":(.60,.03,.01)}
mats=[]
for tag,_ in TAGS:
    m=bpy.data.materials.new("review-"+tag);m.use_nodes=True
    p=m.node_tree.nodes.get("Principled BSDF")
    p.inputs["Base Color"].default_value=(*palette.get(tag,(.045,.05,.05)),1)
    p.inputs["Roughness"].default_value=.37 if tag in ("paint","metal","chrome") else .7
    if tag in ("glass","glass_in"):
        p.inputs["Alpha"].default_value=.045
        p.inputs["Roughness"].default_value=.1
    p.inputs["Metallic"].default_value=.8 if tag in ("metal","chrome","exhaust") else 0
    mats.append(m)
for o in bpy.data.objects:
    if o.type!="MESH":continue
    o.data.materials.clear()
    for m in mats:o.data.materials.append(m)
    tags=o.data.attributes["tag"].data
    for p in o.data.polygons:p.material_index=tags[p.index].value

scene=bpy.context.scene
scene.render.engine="CYCLES";scene.cycles.samples=24
scene.cycles.use_denoising=True
scene.world=bpy.data.worlds.new("studio")
scene.world.use_nodes=True
scene.world.node_tree.nodes["Background"].inputs[0].default_value=(.6,.65,.70,1)
scene.world.node_tree.nodes["Background"].inputs[1].default_value=.6
for loc,power,size in (((6,-5,9),1700,7),((-5,-1,6),1200,6),((1,7,8),2000,5)):
    data=bpy.data.lights.new("softbox","AREA");data.energy=power;data.shape="DISK";data.size=size
    o=bpy.data.objects.new("softbox",data);scene.collection.objects.link(o);o.location=loc
    o.rotation_euler=(Vector((0,0,1.3))-o.location).to_track_quat("-Z","Y").to_euler()
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.005))
floor=bpy.context.object;mat=bpy.data.materials.new("floor");mat.diffuse_color=(.60,.59,.56,1);floor.data.materials.append(mat)
camdata=bpy.data.cameras.new("review");cam=bpy.data.objects.new("review",camdata);scene.collection.objects.link(cam)
cam.location=(8,-12,6.6);target=Vector((0,1.1,1.2));cam.rotation_euler=(target-cam.location).to_track_quat("-Z","Y").to_euler()
camdata.type="ORTHO";camdata.ortho_scale=11.2;scene.camera=cam
scene.render.resolution_x=1280;scene.render.resolution_y=800;scene.render.resolution_percentage=100
scene.render.image_settings.file_format="PNG";scene.view_settings.view_transform="AgX"
scene.render.filepath=os.path.join(FOLDER,"ref","geometry-review.png")
bpy.ops.render.render(write_still=True)

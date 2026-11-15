"""Render the actual revised masters as the drawing under the paintings."""
import bpy, math, json, os, sys
from pathlib import Path
from mathutils import Vector, Matrix
ROOT=Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'source/tool_masters.blend'))
sc=bpy.context.scene
sc.render.engine='CYCLES';sc.cycles.samples=96;sc.cycles.use_denoising=True
sc.render.resolution_x=1254;sc.render.resolution_y=1254
sc.render.film_transparent=True;sc.render.image_settings.color_mode='RGBA'
sc.view_settings.view_transform='AgX';sc.view_settings.look='AgX - Medium High Contrast';sc.view_settings.exposure=-.45
for m in bpy.data.materials:
    if m.use_nodes and m.node_tree.nodes.get('HERO_SWITCH'):
        m.node_tree.nodes['HERO_SWITCH'].inputs[0].default_value=1
world=sc.world;world.use_nodes=True
world.node_tree.nodes['Background'].inputs['Color'].default_value=(.78,.82,.88,1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value=.55
lights=[]
for name,power,size in [('Broad upper left daylight',220,1.5),('Gentle fill',45,2)]:
    bpy.ops.object.light_add(type='AREA');ob=bpy.context.object;ob.name=name
    ob.data.energy=power;ob.data.shape='DISK';ob.data.size=size;lights.append(ob)
cam=sc.camera;cam.data.type='ORTHO';cam.data.clip_end=20
obs=[o for o in bpy.data.objects if o.get('tool')]
camera_records={}
for name,tool,back,roll in [
    ('pick','pick',(1,.42,.47),-.38),
    ('hatchet','hatchet',(1,.38,.48),-.38),
    ('spear_head','spear',(.32,1,.32),-.36),
    ('spear_inventory','spear',(.25,1,.25),-.64),
    ('first_person','hatchet',(1,-.65,.52),-.50)]:
    requested=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    if requested and name not in requested:continue
    for o in obs:o.hide_render=o.get('tool')!=tool
    # A temporary mesh copy clips only the head-guide shaft at z=1.10.
    original_data=None;shaft=None
    if name=='spear_head':
        shaft=next(o for o in obs if o.get('tool')=='spear' and o.get('component')=='haft')
        original_data=shaft.data;me=original_data.copy();shaft.data=me
        import bmesh
        bm=bmesh.new();bm.from_mesh(me)
        bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=1e-7,plane_co=(0,0,1.10),plane_no=(0,0,1),clear_inner=True,clear_outer=False)
        bm.to_mesh(me);bm.free();me.update()
        for o in obs:
            if o.get('tool')=='spear' and o.get('component') in ['bark','knot']:o.hide_render=True
    target=Vector((0,0,.14 if tool!='spear' else (1.285 if name=='spear_head' else .435)))
    back=Vector(back).normalized()
    rot=(-back).to_track_quat('-Z','Y').to_matrix()@Matrix.Rotation(roll,3,'Z')
    right=rot.col[0];up=rot.col[1]
    coords=[o.matrix_world@v.co for o in obs if not o.hide_render for v in o.data.vertices]
    u=[p.dot(right) for p in coords];v=[p.dot(up) for p in coords]
    target+=right*((min(u)+max(u))/2-target.dot(right))+up*((min(v)+max(v))/2-target.dot(up))
    cam.rotation_euler=rot.to_euler();cam.location=target+back*3
    scale=max(max(u)-min(u),max(v)-min(v))/ .84
    cam.data.ortho_scale=scale
    sc.render.resolution_x=1254;sc.render.resolution_y=1254
    if name=='first_person':
        # Camera basis is behind the striking side; compose grip below frame.
        sc.render.resolution_y=706;cam.data.ortho_scale=.84
        # Grip lands near (1050,690), the blade toward the image centre.
        anchor=Vector((0,0,0));target=anchor-right*((1050-627)/1254*.84)+up*((690-353)/1254*.84)
        cam.location=target+back*3
    for light,offset in zip(lights,[(-.75,.9,1.1),(.8,-.2,.8)]):
        light.location=target+right*offset[0]+up*offset[1]+back*offset[2]
        light.rotation_euler=(target-light.location).to_track_quat('-Z','Y').to_euler()
    camera_records[name]={'tool':tool,'orthographic_scale_m':cam.data.ortho_scale,'camera_location_m':list(cam.location),'right':list(right),'up':list(up),'back':list(back),'canvas_px':[sc.render.resolution_x,sc.render.resolution_y]}
    sc.render.filepath=str(ROOT/'guides'/f'{name}_rgba.png')
    bpy.ops.render.render(write_still=True)
    if original_data:shaft.data=original_data
(ROOT/'checks/paint_cameras.json').write_text(json.dumps(camera_records,indent=2))
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'source/paint_guide_scene.blend'))
if os.environ.get('TOOL_CONCEPT_BATCH')=='1':sys.stdout.flush();sys.stderr.flush();os._exit(0)

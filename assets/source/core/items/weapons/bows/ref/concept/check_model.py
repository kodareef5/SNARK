"""Independent evaluated-mesh and isolated raster verification.

blender -b concept_models.blend -t 16 --python check_model.py
No model mutations are saved. Check passes are evidence, not alternate designs.
"""
import bpy, json, math, sys, os
from pathlib import Path
from mathutils import Vector, Matrix

ROOT=Path(__file__).resolve().parent
CHECKS=ROOT/'checks'; OUT=CHECKS/'feature_masks'; OUT.mkdir(exist_ok=True)
SPEC=json.loads((CHECKS/'projection_spec.json').read_text())
SCENE=bpy.context.scene
DEPS=bpy.context.evaluated_depsgraph_get()
CACHE={}

def get(prefix):
    obs=[o for o in SCENE.objects if o.type=='MESH' and o.name.startswith(prefix)]
    if not obs: raise RuntimeError('Missing geometry: '+prefix)
    return obs

def geometry(prefix):
    if prefix in CACHE:return CACHE[prefix]
    verts=[];edges=[]
    for o in get(prefix):
        ev=o.evaluated_get(DEPS);me=ev.to_mesh();offset=len(verts)
        verts.extend([o.matrix_world@v.co for v in me.vertices])
        edges.extend([(a+offset,b+offset) for a,b in [e.vertices for e in me.edges]])
        ev.to_mesh_clear()
    CACHE[prefix]=(verts,edges);return verts,edges

def bounds(prefix):
    vs,_=geometry(prefix)
    return [[min(v[k] for v in vs),max(v[k] for v in vs)] for k in range(3)]

def section(prefix,axis,value):
    vs,edges=geometry(prefix);pts=[]
    for v in vs:
        if abs(v[axis]-value)<1e-7:pts.append(v)
    for a,b in edges:
        u,v=vs[a],vs[b]
        if (u[axis]-value)*(v[axis]-value)<0:
            pts.append(u+(v-u)*((value-u[axis])/(v[axis]-u[axis])))
    if not pts:raise RuntimeError(f'Empty section {prefix} {axis} {value}')
    return [[min(v[k] for v in pts),max(v[k] for v in pts)] for k in range(3)]

ROWS=[]
def check(name,actual,target,unit='m',note=''):
    error=abs(actual-target);rel=error/abs(target)
    ROWS.append(dict(name=name,actual=actual,target=target,unit=unit,absolute_error=error,
                     relative_error=rel,within_3_percent=rel<=.030001,note=note))

def dim(b,axis):return b[axis][1]-b[axis][0]
def mid(b,axis):return sum(b[axis])/2

grip=bounds('Single overlapping spiral hide strip')
check('Bow grip depth',dim(grip,0),.040);check('Bow grip width',dim(grip,2),.030)
check('Bow grip height',dim(grip,1),.150);check('Bow grip front X',grip[0][1],.015);check('Bow grip rear X',grip[0][0],-.025)
for prefix,sign in [('Upper',1),('Lower',-1)]:
    limb=prefix+' sweeping wood limb';ear=prefix+' rigid ear and carved nock knob'
    for y,w,d in [(.075,.036,.018),(.5,.026,.013)]:
        b=section(limb,1,sign*y)
        check(prefix+f' limb width at |Y|={y}',dim(b,2),w)
        check(prefix+f' limb depth at |Y|={y}',dim(b,0),d)
    check(prefix+' limb joint X',mid(section(limb,1,sign*.5),0),-.145)
    b=section(ear,1,sign*.55)
    check(prefix+' ear width',dim(b,2),.024);check(prefix+' ear depth',dim(b,0),.020)
    b=section(ear,1,sign*.66)
    check(prefix+' tip centre X',mid(b,0),-.165)
    check(prefix+' tip Y',mid(b,1),sign*.660)
    check(prefix+' nock knob width',dim(bounds(ear),2),.030)
    b=bounds(prefix+' ear joint continuous binding')
    check(prefix+' binding length along Y',dim(b,1),.040)
    check(prefix+' binding crest width',dim(b,2),.042,note='26 mm limb width plus 8 mm cord buildup per side; helical groove widths vary between crests.')
    b=section(prefix+' ear joint continuous binding',1,sign*.5)
    check(prefix+' binding depth at joint',dim(b,0),.029,note='13 mm limb depth plus 8 mm cord buildup per side.')
string=bounds('Straight twisted bowstring')
check('Bow straight string diameter',dim(string,0),.005)
check('Bow straight string X',mid(string,0),-.172)
check('Bow string tip-to-tip',dim(string,1),1.320)
shelf=bounds('Integral left arrow shelf')
check('Arrow shelf height',dim(shelf,1),.020)
check('Arrow shelf protrusion beyond 18 mm limb half-width',-.018-shelf[2][0],.010)
stock='Grooved honey wood tiller with flared square butt';b=bounds(stock)
check('Tiller length',dim(b,2),.680);check('Butt Z',b[2][0],-.220);check('Nose Z',b[2][1],.460)
b=section(stock,2,.2);check('Tiller width',dim(b,0),.040);check('Tiller height',dim(b,1),.058)
check('Tiller deck Y',b[1][1],.018);check('Tiller bottom Y',b[1][0],-.040)
b=section(stock,2,-.22);check('Butt height',dim(b,1),.090);check('Butt width',dim(b,0),.046)
check('Butt top Y',b[1][1],.020);check('Butt bottom Y',b[1][0],-.070)
b=bounds('Raked wood pistol grip');check('Pistol grip thickness',dim(b,0),.030);check('Pistol grip heel Y',b[1][0],-.125)
b=section('Raked wood pistol grip',1,-.125);check('Pistol grip heel Z',mid(b,2),-.030);check('Pistol grip fore/aft depth',dim(b,2),.040)
b=bounds('Forged trigger lever');check('Trigger lowest Y',b[1][0],-.075)
b=bounds('Notched steel roller nut');check('Nut centre Z',mid(b,2),.040);check('Nut standing above deck',b[1][1]-.018,.012)
b=bounds('Faceted bowed steel leaf spring prod');check('Prod overall span',dim(b,0),.600)
for x,h,d,z in [(0,.038,.013,.430),(.299,.026,.008,.370),(-.299,.026,.008,.370)]:
    b=section('Faceted bowed steel leaf spring prod',0,x)
    note='Tip sections 1 mm inboard of the terminal edge chamfer.' if x else ''
    check(f'Prod height at X={x}',dim(b,1),h,note=note);check(f'Prod depth at X={x}',dim(b,2),d,note=note)
    check(f'Prod Z at X={x}',mid(b,2),z,note=note);check(f'Prod centre Y at X={x}',mid(b,1),.005)
b=bounds('Forged blunt steel foot stirrup');check('Stirrup width',dim(b,0),.090);check('Stirrup section height',dim(b,1),.012)
check('Stirrup furthest Z',b[2][1],.560)
check('Stirrup exposed forward length',b[2][1]-.460,.100,note='Hidden stems enter the wood; exposed loop begins at the nose plane.')
b=bounds('Figure eight binding')
check('Figure eight binding width',dim(b,0),.060)
check('Figure eight binding along nose',dim(b,2),.060)
check('Figure eight rear limit Z',b[2][0],.400)
check('Figure eight forward limit Z',b[2][1],.460)
for prefix,sign in [('Left',-1),('Right',1)]:
    vs,_=geometry(prefix+' drawn string leg')
    a=Vector((sign*.300,.005,.370));b=Vector((0,.027,.040));direction=(b-a).normalized()
    radii=[((v-a)-direction*(v-a).dot(direction)).length for v in vs]
    check(prefix+' crossbow string diameter',2*max(radii),.006)
# Groove vertices are inspected independently of the construction parameters.
vs,_=geometry(stock);inner=[v for v in vs if abs(v.z)<1e-7 and abs(v.x)<.00401]
groove_width=max(v.x for v in inner)-min(v.x for v in inner)
groove_depth=max(v.y for v in inner)-min(v.y for v in inner)
check('Machined-free carved groove width',groove_width,.008);check('Carved groove depth',groove_depth,.005)

# Isolated masks use the exact delivery cameras and geometry. Alpha is measured
# by finish_validation.py; projection bounds are not substituted for raster data.
FEATURES=[
 ('bow_grip_side','bow_grip_side',['Single overlapping spiral hide strip','Hide covered grip core']),
 ('bow_grip_back','bow_grip_back',['Single overlapping spiral hide strip','Hide covered grip core']),
 ('bow_string','bow_side',['Straight twisted bowstring']),
 ('bow_ear','bow_ear_side',['Upper rigid ear and carved nock knob']),
 ('bow_binding','bow_ear_side',['Upper ear joint continuous binding']),
 ('crossbow_stock_side','crossbow_side',[stock]),
 ('crossbow_stock_top','crossbow_top',[stock]),
 ('crossbow_prod_top','crossbow_top',['Faceted bowed steel leaf spring prod']),
 ('crossbow_prod_front','crossbow_front',['Faceted bowed steel leaf spring prod']),
 ('crossbow_nut','crossbow_side',['Notched steel roller nut']),
 ('crossbow_stirrup','crossbow_top',['Forged blunt steel foot stirrup']),
 ('crossbow_string','crossbow_top',['Left drawn string leg','Right drawn string leg']),
 ('crossbow_binding','crossbow_top',['Figure eight binding']),
]
feature_data={}
SCENE.cycles.samples=16;SCENE.cycles.use_denoising=False
SCENE.render.film_transparent=True;SCENE.render.resolution_x=SCENE.render.resolution_y=1254
SCENE.view_settings.view_transform='Standard'
white=bpy.data.materials.new('Validation white coverage');white.use_nodes=True
nt=white.node_tree;nt.nodes.clear();em=nt.nodes.new('ShaderNodeEmission');out=nt.nodes.new('ShaderNodeOutputMaterial');nt.links.new(em.outputs[0],out.inputs[0])
SCENE.view_layers[0].material_override=white
cam=SCENE.camera
for name,view,prefixes in FEATURES:
    cfg=SPEC['views'][view];visible={o for p in prefixes for o in get(p)}
    for o in SCENE.objects:
        if o.type=='MESH':o.hide_render=o not in visible
    up=Vector(cfg['up']);direction=Vector(cfg['view']);right=up.cross(direction);desired=Vector(cfg['right'])
    target=Vector(cfg['centre'])+desired*((627-cfg['origin'][0])/cfg['ppm'])-up*((627-cfg['origin'][1])/cfg['ppm'])
    cam.location=target+direction*4;cam.rotation_euler=Matrix((right,up,direction)).transposed().to_euler()
    cam.data.type='ORTHO';cam.data.ortho_scale=1254/cfg['ppm']
    SCENE.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True)
    vs=[v for p in prefixes for v in geometry(p)[0]]
    px=[(cfg['origin'][0]+cfg['ppm']*(v-Vector(cfg['centre'])).dot(desired),cfg['origin'][1]-cfg['ppm']*(v-Vector(cfg['centre'])).dot(up)) for v in vs]
    feature_data[name]={'view':view,'prefixes':prefixes,'mirror_x':cfg['mirror_x'],'ppm':cfg['ppm'],
        'projected_evaluated_mesh_bbox_px':[min(v[0] for v in px),min(v[1] for v in px),max(v[0] for v in px),max(v[1] for v in px)]}
report={'method':'Dimensions measured from evaluated Blender mesh vertices and edge-plane intersections, independent of landmark declarations.',
    'checks':ROWS,'all_within_3_percent':all(r['within_3_percent'] for r in ROWS),'features':feature_data,
    'tail_notes':{'crossbow_cut_tail_centreline_end_distance_m':math.sqrt(.023**2+.017**2+.008**2),
    'bow_tails_per_joint':2,'crossbow_tails_at_nose':2}}
(CHECKS/'model_measurements.json').write_text(json.dumps(report,indent=2))
print('ACTUAL MESH MEASUREMENTS:',len(ROWS),'PASS:',report['all_within_3_percent'])
for r in ROWS:
    if not r['within_3_percent']:print('FAIL',r)
# Avoid the host audio destructor after all evidence files have been closed.
if bpy.app.background:
    sys.stdout.flush();sys.stderr.flush();os._exit(0)

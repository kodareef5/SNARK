from pathlib import Path
p=Path('build_concepts.py');s=p.read_text()
s=s.replace("START=time.time()", "START=time.time()\nATLAS_PATH=ROOT/'material_atlas.png'")
s=s.replace("return m\nM=", """# Painted albedo is sampled from one saved eight-tile atlas. UVs are shared by all cameras.
 tile={'wood':(0,1),'hide':(1,1),'flint':(2,1),'flint flake scar':(2,1),'steel':(3,1),'brass':(0,0),'cord':(1,0),'stone':(2,0),'hide cut edge':(3,0)}.get(name)
 if tile and ATLAS_PATH.exists():
  uv=n.new('ShaderNodeTexCoord');scale=n.new('ShaderNodeVectorMath');scale.operation='MULTIPLY';scale.inputs[1].default_value=(.24,.48,1);l.new(uv.outputs['UV'],scale.inputs[0])
  offset=n.new('ShaderNodeVectorMath');offset.operation='ADD';offset.inputs[1].default_value=(tile[0]/4+.005,tile[1]/2+.01,0);l.new(scale.outputs[0],offset.inputs[0])
  img=n.new('ShaderNodeTexImage');img.image=bpy.data.images.load(str(ATLAS_PATH),check_existing=True);img.interpolation='Linear';l.new(offset.outputs[0],img.inputs['Vector'])
  blend=n.new('ShaderNodeMixRGB');blend.blend_type='MIX';blend.inputs[0].default_value=.72 if name in ['wood','hide','brass'] else .60;l.new(ramp.outputs[0],blend.inputs[1]);l.new(img.outputs['Color'],blend.inputs[2]);l.new(blend.outputs[0],diffuse.inputs['Color'])
  detail=n.new('ShaderNodeRGBToBW');l.new(img.outputs['Color'],detail.inputs[0]);l.new(detail.outputs[0],bump.inputs['Height']);bump.inputs['Distance'].default_value=.00009
 return m
M=""")
s=s.replace("me=bpy.data.meshes.new(name); me.from_pydata(verts,[],faces); me.update()", """me=bpy.data.meshes.new(name); me.from_pydata(verts,[],faces); me.update()
 # Per-face planar UVs, formed before any pose transforms. Surface images never affect geometry.
 uv=me.uv_layers.new(name='painted_albedo')
 lo=[min(v[i] for v in verts) for i in range(3)];hi=[max(v[i] for v in verts) for i in range(3)]
 for face in me.polygons:
  ax=max(range(3),key=lambda j:abs(face.normal[j]));axes=(1,2) if ax==0 else ((0,2) if ax==1 else (0,1))
  for li in face.loop_indices:
   v=me.vertices[me.loops[li].vertex_index].co
   uv.data[li].uv=tuple((v[a]-lo[a])/max(hi[a]-lo[a],.00001) for a in axes)""")
s=s.replace("default_value=.55\nld=", "default_value=.32\nld=")
s=s.replace("ld.energy=8;ld.shape='DISK';ld.size=2.2", "ld.energy=15;ld.shape='DISK';ld.size=1.8")
# Surface creases stay restrained. The stones no longer poke through pouch faces.
s=s.replace("(-.015,.029),(0,.032),(.016,.027)","(-.015,.028),(0,.031),(.016,.026)")
# Keep width exact with a denser but still clearly faceted pouch around each rock.
p.write_text(s)

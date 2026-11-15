from pathlib import Path
p=Path('build_concepts.py');s=p.read_text()
# Use actual diffuse form lighting; there is no reflective/specular closure.
s=s.replace("scene.cycles.samples=16", "scene.cycles.samples=48")
s=s.replace("l.new(mix.outputs[0],emit.inputs[0])", "l.new(mix.outputs[0],emit.inputs[0])\n diffuse=n.new('ShaderNodeBsdfDiffuse'); diffuse.inputs['Roughness'].default_value=.7\n l.new(ramp.outputs[0],diffuse.inputs['Color']);l.new(bump.outputs[0],diffuse.inputs['Normal']);l.new(diffuse.outputs[0],out.inputs['Surface'])\n if name in ['steel','brass']:\n  bev=n.new('ShaderNodeBevel');bev.inputs['Radius'].default_value=.00025;bev.samples=4;l.new(bev.outputs[0],bump.inputs['Normal'])")
s=s.replace("M['hide_cut']=", "M['flint_scar']=mat('flint flake scar','57535A',.18)\nM['steel_wear']=mat('steel rubbed arris','737374',.11)\nM['hide_cut']=")
s=s.replace("for z in [-.015,.015]:", "for z in [-.015,-.005,.015]:")
old="for i in range(N-1): fs.extend([(i,i+1,N+i+1,N+i),(2*N+i,3*N+i,3*N+i+1,2*N+i+1),(N+i,N+i+1,3*N+i+1,3*N+i),(i,2*N+i,2*N+i+1,i+1)])\nfs.extend([(0,N,3*N,2*N),(N-1,2*N-1,4*N-1,3*N-1)])"
new="""for k in range(2):
 a=2*N*k;b=a+2*N
 for i in range(N-1):fs.extend([(a+N+i,a+N+i+1,b+N+i+1,b+N+i),(a+i,b+i,b+i+1,a+i+1)])
 fs.extend([(a,a+N,b+N,b),(a+N-1,b+N-1,b+2*N-1,a+2*N-1)])
for i in range(N-1):fs.extend([(i,i+1,N+i+1,N+i),(4*N+i,5*N+i,5*N+i+1,4*N+i+1)])"""
s=s.replace(old,new)
s=s.replace("v.x+=.056*sin(pi*t)*sin(2*pi*t)","v.x+=.063*sin(pi*t)*sin(2*pi*t)")
s=s.replace("bend=.078*sin(pi*t)*sin(2*pi*t)","bend=.067*sin(pi*t)*sin(2*pi*t)")
s=s.replace("(['flint_edge','flint'],ids)","(['flint_edge','flint_scar'],ids)")
# Thin real chamfers on the cast iron arrises; brighter metal remains the same material family.
s=s.replace("def grad(z):", "body.data.materials.append(M['steel_wear']);mod=body.modifiers.new('worn cast arrises','BEVEL');mod.width=.00022;mod.segments=1;mod.material=1\nbpy.context.view_layer.objects.active=body;bpy.ops.object.modifier_apply(modifier=mod.name)\ndef grad(z):")
s=s.replace("VIEWS=[]", """scene.world.use_nodes=True
scene.world.node_tree.nodes.get('Background').inputs[0].default_value=(1,1,1,1)
scene.world.node_tree.nodes.get('Background').inputs[1].default_value=.55
ld=bpy.data.lights.new('broad neutral frontal softbox','AREA');light=bpy.data.objects.new('broad neutral frontal softbox',ld);scene.collection.objects.link(light)
ld.energy=8;ld.shape='DISK';ld.size=2.2
VIEWS=[]""")
s=s.replace("cam.rotation_euler=Matrix", "light.location=target+normal*1.4+up*.40-right*.22;light.rotation_euler=(target-light.location).to_track_quat('-Z','Y').to_euler()\n cam.rotation_euler=Matrix")
s=s.replace('All orthographic surface illumination is a diffuse normal-based matte shader. No reflections or cast shadows.','All orthographic surface illumination uses rough diffuse shaders, uniform ambient fill, and a broad near-frontal softbox. No reflective shaders or ground plane.')
p.write_text(s)

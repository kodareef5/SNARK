"""Manual fixture/cell export for aquatheater.ts; never writes the supplied art tree."""
import sys,json,hashlib,importlib.util,os
from pathlib import Path
args=sys.argv[sys.argv.index('--')+1:]
S=Path(args[0]).resolve();helper=Path(args[1]).resolve();out=Path(args[2]).resolve();out.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(S))
from parts import Mesh
from model_parts import D,build
import model_cells as mc
spec=importlib.util.spec_from_file_location('fixture_candidate',helper);candidate=importlib.util.module_from_spec(spec);spec.loader.exec_module(candidate)
P={p['id']:p for p in D['prototypes']};forms={}
for name in('aquadome_pod_1_0','aquatheater_seating_1_0','aquatheater_stage'):
 inst=next(i for i in D['instances'] if i['id']==name);p=P[inst['prototype']];forms[name]={}
 for stage in range(6):
  m=Mesh(stage)
  if stage<2:
   assert not candidate.fitting(m,p,inst) and not m.v,'fine geometry changed'
   build(m,p)
  else:assert candidate.fitting(m,p,inst)
  for q in m.v:assert all(p['visualBounds']['min'][k]-1e-6<=q[k]<=p['visualBounds']['max'][k]+1e-6 for k in range(3)),(name,stage,q)
  mc.orient(m);m.direct_uv=True;obj=m.object('fixture',[0,0,0])
  assert all(len(f.vertices)==3 for f in obj.data.polygons)
  forms[name][stage]={'positions':[x for v in obj.data.vertices for x in(v.co.x,v.co.z,-v.co.y)],'indices':[i for f in obj.data.polygons for i in f.vertices]}
layout=S.parents[3]/'content/landmarks/cruise-layout.json'
sources={'layout':hashlib.sha256(layout.read_bytes()).hexdigest(),'helper':hashlib.sha256(helper.read_bytes()).hexdigest()}
for name in('parts.py','model_aquatheater.py','model_interiors.py','model_cells.py'):
 sources[name]=hashlib.sha256((S/name).read_bytes()).hexdigest()
(out/'forms.json').write_text(json.dumps({'sources':sources,'forms':forms}))
baseform=mc.source_form;basevisible=mc.visible
mc.source_form=lambda mesh,prototype,build,instance=None:None if instance and candidate.fitting(mesh,prototype,instance) else baseform(mesh,prototype,build,instance)
mc.visible=lambda i,p,l:(i['section']=='aquatheater' and p['art']['kind'] in('aquadome_pod','furniture')) or basevisible(i,p,l)
# Exact existing ownership/member lists; no synthetic re-placement in this audit.
ids={i['id'] for i in D['instances'] if i['section']=='aquatheater' and P[i['prototype']]['art']['kind'] in('aquadome_pod','furniture')}
D['cells']=[c for c in D['cells'] if any(m['instance'] in ids for m in c['members'])]
os.environ.update(CRUISE_CENSUS='1',CRUISE_CELL_START='0',CRUISE_CELL_LIMIT=str(len(D['cells'])),CRUISE_CANDIDATE_START='2',CRUISE_RAW_DIR=str(out))
mc.render(D,build,S)
if '--visibility' in args:
 # Separate namespace keeps the full frozen world rather than D's bounded cells.
 env={'__name__':'__main__','__file__':str(Path(__file__).with_name('aquatheater_visibility.py')),'SOURCE':S,'CANDIDATE':out,'OUTPUT':out/'visibility.json'}
 exec(compile(Path(env['__file__']).read_text(),env['__file__'],'exec'),env)

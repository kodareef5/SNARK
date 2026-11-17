import sys,os,inspect,json,hashlib,ast,subprocess
from pathlib import Path
args=sys.argv[sys.argv.index('--')+1:]
if len(args)!=2:raise ValueError('expected SOURCE_DIR OUTPUT_DIR')
S=Path(args[0]).resolve();O=Path(args[1]).resolve();O.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(S))
from model_parts import D,build
import model_cells as mc
patched=inspect.getsource(mc.distant_shell)
baseline=subprocess.check_output(['git','show','7a673712:assets/source/landmarks/cruise/model_cells.py'],cwd=S.parents[3],text=True)
node=next(n for n in ast.parse(baseline).body if isinstance(n,ast.FunctionDef) and n.name=='distant_shell')
source=ast.get_source_segment(baseline,node);env=dict(mc.__dict__);exec(compile(source,'<committed-baseline>','exec'),env);original=env['distant_shell']
def fingerprint(m):return hashlib.sha256(json.dumps([m.v,m.f,m.tags],separators=(',',':')).encode()).hexdigest()
same={str(level):fingerprint(original(D,'dome_dense',level))==fingerprint(mc.distant_shell(D,'dome_dense',level))for level in(0,1,2,4,5)}
assert all(same.values())
a=original(D,'dome_dense',3);b=mc.distant_shell(D,'dome_dense',3)
a0,a1,af0,af1=a.islands[-1];b0,b1,bf0,bf1=b.islands[-1]
assert a.v[a0:a1]==b.v[b0:b1] and [[i-a0 for i in f]for f in a.f[af0:af1]]==[[i-b0 for i in f]for f in b.f[bf0:bf1]], 'C rim changed'
bounds={'min':[min(p[k]for p in b.v)for k in range(3)],'max':[max(p[k]for p in b.v)for k in range(3)]}
assert abs(bounds['max'][0]-bounds['min'][0]-57)<1e-8 and abs(bounds['max'][1]-bounds['min'][1]-17)<1e-8
P={p['id']:p for p in D['prototypes']}
D['cells']=[c for c in D['cells']if any(P[m['prototype']]['art']['kind']=='dome_dense'for m in c['members'])]
assert len(D['cells'])==36
os.environ.update(CRUISE_CENSUS='1',CRUISE_CELL_START='0',CRUISE_CELL_LIMIT=str(len(D['cells'])),CRUISE_CANDIDATE_START='3',CRUISE_RAW_DIR=str(O))
(O/'experiment.json').write_text(json.dumps({'scope':'Private stage3 balanced closed shell; no canonical source edits','originalFunctionSHA256':hashlib.sha256(source.encode()).hexdigest(),'patchedFunctionSHA256':hashlib.sha256(patched.encode()).hexdigest(),'otherStagesExactlyEqual':same,'source':str(S),'wholeDomeBounds':bounds,'lowerCRimExactlyEqual':True},indent=2))
mc.render(D,build,S)

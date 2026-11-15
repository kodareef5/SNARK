import site,sys,json
site.addsitedir(site.getusersitepackages())
from pathlib import Path
import numpy as np
from scipy.optimize import minimize
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT));import measure
ph=json.loads((ROOT/'underlay/points.json').read_text())['keys']
targets={
'dawn':[[108,155,214],[174,203,237],[248,223,202],[231,214,215]],
'morning':[[53,112,182],[117,165,214],[233,226,202],[209,231,227]],
'noon':[[61,113,178],[150,190,230],[224,238,230],[216,235,234]],
'afternoon':[[81,126,183],[143,175,212],[237,218,190],[222,219,211]],
'golden':[[89,116,160],[139,155,189],[249,187,115],[206,184,180]],
'sunset':[[52,75,119],[114,116,155],[233,142,96],[178,144,164]],
'dusk':[[37,66,122],[65,101,161],[234,150,106],[163,125,162]],
'night':[[12,24,44],[24,44,75],[54,79,116],[49,73,109]],
}
out={};e=np.array([87,30,3,3]);t=np.array([0,0,1,0])
for n,tar in targets.items():
 p=np.array([ph[n][x] for x in measure.SKY]);tar=np.array(tar,float)
 sc,q=measure.fit(p,tar,e,t)
 # Find model capacity independently of the supplied validator's random-search convergence.
 def cost(q):
  dd=np.linalg.norm(measure.oklab(measure.grade(p,q,e,t))-measure.oklab(tar),axis=1)
  return np.sum(dd**6)**(1/6)
 r=minimize(cost,q,method='Powell',bounds=[(-5,3)]*3+[(-1.7,1.8),(-.95,15),(-.9,5)],options={'maxiter':250})
 graded=measure.grade(p,r.x,e,t)
 d=np.linalg.norm(measure.oklab(graded)-measure.oklab(tar),axis=1).max()
 blend=0 if sc <= 5.7 else max(0,1-4.5/d)
 proposed=measure.to_srgb(measure.lin(tar)*(1-blend)+measure.lin(graded)*blend)
 ns,nq=measure.fit(p,proposed,e,t)
 while ns>5.7:
  blend=min(1,blend+.05)
  proposed=measure.to_srgb(measure.lin(tar)*(1-blend)+measure.lin(graded)*blend)
  ns,nq=measure.fit(p,proposed,e,t)
  if blend==1:break
 out[n]={'requested':tar.tolist(),'modelApproximation':graded.round(2).tolist(),'blend':round(blend,3),'target':proposed.round(2).tolist(),'afterBestGrade':round(ns,2),'gradeParams':nq.tolist(),'initialScore':round(sc,2)}
 print(n,json.dumps(out[n]),flush=True)
(ROOT/'reports/palette-candidates.json').write_text(json.dumps(out,indent=2))

import sys,site,json
site.addsitedir(site.getusersitepackages())
from pathlib import Path
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import measure
meta=json.loads((ROOT/'base/points.json').read_text())
ph=json.loads((ROOT/'underlay/points.json').read_text())['keys']
out={}
for i,k in enumerate(meta['keys'],4):
 a=np.array(Image.open(ROOT/f"originals/{i:02d}-{k['name']}-panorama.png").convert('RGB').resize((2048,1024),Image.Resampling.LANCZOS))
 reads={n:measure.read(a,p,13) for n,p in k['points'].items()}
 src=np.array([reads[n] for n in measure.SKY]);phys=np.array([ph[k['name']][n] for n in measure.SKY]);elev=np.array([87,30,3,3]);tow=np.array([0,0,1,0])
 score,pars=measure.fit(phys,src,elev,tow)
 out[k['name']]={'source':src.round(1).tolist(),'fit':round(score,2),'fitted':measure.grade(phys,pars,elev,tow).round(1).tolist(),'params':pars.tolist()}
 print(k['name'],json.dumps(out[k['name']]))
(ROOT/'reports/source-fit.json').write_text(json.dumps(out,indent=2))

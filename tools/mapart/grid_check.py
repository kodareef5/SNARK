"""Compare the engine's 2 m samples to native vector masks at finest zoom."""
import json
import numpy as np
from PIL import Image
from scipy import ndimage as nd
from common import ROOT
from reference import grid_at
from measure import score

def main():
    result={}
    # Compare input classes separately, before surface occlusion priorities.
    for name in ['water','buildings','roads']:
        base=grid_at(name,8192)
        if name=='roads':base=(base>0)&(base<4)
        else:base=base>0
        native=np.asarray(Image.open(ROOT/'references/z3'/f'{name}.png'))>0
        result[name]=score(base,native)
        print(name,result[name],flush=True)
    fine={}
    for name in ['water','buildings','roads']:
        a=np.asarray(Image.open(ROOT/f'base/{name}_fine.png'))
        a=((a>0)&(a<4)) if name=='roads' else a>0
        b=np.asarray(Image.open(ROOT/f'references/z3/{name}.png'))>0
        different=int((a!=b).sum())
        assert different==0,(name,different)
        fine[name]={'differing_pixels':different,'iou':1.0,'max_boundary_px':0.0}
    result['canonical_fine']=fine
    (ROOT/'checks/base_grid_agreement.json').write_text(json.dumps(result,indent=2))

if __name__=='__main__':main()

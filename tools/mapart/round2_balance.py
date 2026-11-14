"""Share broad-pigment differences between four independent continuous paintings.

No geometric resampling of final ink. Reductions are only used to estimate RGB
wash corrections; each native painting keeps its own high-frequency drawing.
"""
import json
import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as nd
from common import ROOT
from round2_symbols import wreck_symbols


def scores(images):
    return [float(np.abs(nd.gaussian_filter(cv2.resize(images[z+1],(len(images[z]),)*2,interpolation=cv2.INTER_AREA)-images[z],(8,8,0))).mean()) for z in range(3)]


def main():
    images=[np.array(Image.open(ROOT/f'paintings/z{z}/unbalanced-master.png'),np.float32) for z in range(4)]
    log={'method':'symmetric continuous-canvas broad RGB wash relaxation, sigma 8 at each parent scale; native marks stay in place','initial':scores(images),'passes':[]}
    print('initial',log['initial'],flush=True)
    for step in range(14):
        # Alternate traversal prevents the last pair from dominating the chain.
        for z in ([2,1,0] if step%2==0 else [0,1,2]):
            parent=images[z];child=images[z+1];n=len(parent)
            small=cv2.resize(child,(n,n),interpolation=cv2.INTER_AREA)
            field=nd.gaussian_filter(small-parent,(8,8,0))
            field=np.clip(field,-12,12)
            parent+=field*.48
            # Chunking channel updates avoids a second full RGB 8k allocation.
            for k in range(3):
                big=cv2.resize(field[...,k],(n*2,n*2),interpolation=cv2.INTER_LINEAR)
                child[...,k]-=big*.52
            np.clip(parent,0,255,out=parent);np.clip(child,0,255,out=child)
        err=scores(images);log['passes'].append(err);print('pass',step+1,err,flush=True)
        if max(err)<1.65:break
    for z,a in enumerate(images):
        im=wreck_symbols(Image.fromarray(np.uint8(np.clip(np.rint(a),0,255))),z)
        im.save(ROOT/f'paintings/z{z}/final-master.png')
        for y in range(2**z):
            for x in range(2**z):im.crop((x*1024,y*1024,(x+1)*1024,(y+1)*1024)).save(ROOT/f'tiles/z{z}/{x}_{y}.png')
        im.resize((1024,1024),Image.Resampling.LANCZOS).save(ROOT/f'checks/overview_z{z}.png')
    log['final_float']=scores(images)
    log['symbols']='After wash balancing, z0/z1 receive enlarged wreck symbols at the four saved centers/directions. See exported RGB measurements for final errors.'
    (ROOT/'reports/round2-balance.json').write_text(json.dumps(log,indent=2))

if __name__=='__main__':main()

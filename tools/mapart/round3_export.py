"""Share broad wash differences, then draw saved stories and cut 85 exact tiles."""
import json
import cv2
import numpy as np
from PIL import Image
from common import ROOT
from round3_symbols import wrecks

def blur(a,s=8):return cv2.GaussianBlur(a,(0,0),s,borderType=cv2.BORDER_REFLECT)
def scores(images):
    return [float(np.abs(blur(cv2.resize(images[z+1],(len(images[z]),)*2,interpolation=cv2.INTER_AREA)-images[z])).mean()) for z in range(3)]

def main():
    images=[np.array(Image.open(ROOT/f'paintings/z{z}/unbalanced-master.png'),np.float32) for z in range(4)]
    log=dict(method='Symmetric continuous-canvas RGB broad-wash relaxation; sigma 8 parent pixels; no resampling of native ink.',initial=scores(images),passes=[])
    print('initial',log['initial'],flush=True)
    for step in range(10):
        for z in ([2,1,0] if step%2==0 else [0,1,2]):
            parent=images[z];child=images[z+1];n=len(parent)
            small=cv2.resize(child,(n,n),interpolation=cv2.INTER_AREA)
            field=np.clip(blur(small-parent),-10,10)
            parent+=field*.46
            for k in range(3):child[...,k]-=cv2.resize(field[...,k],(n*2,n*2),interpolation=cv2.INTER_LINEAR)*.54
            np.clip(parent,0,255,out=parent);np.clip(child,0,255,out=child)
        err=scores(images);log['passes'].append(err);print('pass',step+1,err,flush=True)
        if max(err)<1.65:break
    for z,a in enumerate(images):
        im=wrecks(Image.fromarray(np.uint8(np.clip(np.rint(a),0,255))),z)
        im.save(ROOT/f'paintings/z{z}/final-master.png')
        for y in range(2**z):
            for x in range(2**z):im.crop((x*1024,y*1024,(x+1)*1024,(y+1)*1024)).save(ROOT/f'tiles/z{z}/{x}_{y}.png')
        im.resize((1024,1024),Image.Resampling.LANCZOS).save(ROOT/f'reports/round3/z{z}-final.png')
        print('export',z,flush=True)
    log['final_float']=scores(images)
    (ROOT/'reports/round3/balance.json').write_text(json.dumps(log,indent=2))

if __name__=='__main__':main()

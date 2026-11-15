#!/usr/bin/env python3
"""Write reproducible native horizon crops and views aimed at high bodies."""
import site, sys
site.addsitedir(site.getusersitepackages())
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build_keys import ROOT, META, perspective, contact, save, font, ICC


def main():
    dest=ROOT/'reports/round-4-review'
    dest.mkdir(parents=True,exist_ok=True)
    horizons=[]
    for k in META['keys']:
        name=k['name']
        im=Image.open(ROOT/k['file'])
        path=dest/f'{name}-horizon.png'
        im.crop((0,450,2048,610)).save(path)
        horizons.append((name,path))
    contact(horizons,dest/'horizons.png',1024,80,1,'NATIVE HORIZON CROPS SAVED SEPARATELY AT 2048 PIXELS')
    aimed=[]
    for name,body in [('noon','sun'),('sunset','moon'),('dusk','moon'),('night','moon')]:
        k=next(k for k in META['keys'] if k['name']==name)
        p=k[body]
        im=np.array(Image.open(ROOT/k['file']),float)
        view=perspective(im,p['heading'],p['elevation'])
        path=dest/f'{name}-{body}-aimed.png'
        save(view,path)
        aimed.append((name+' / '+body,path))
        if name in ('noon','night'):
            out=Image.fromarray(np.rint(view).clip(0,255).astype('uint8'))
            out.save(ROOT/'views'/f'{name}-{body}.jpg',quality=95,subsampling=0,icc_profile=ICC)
    contact(aimed,dest/'celestials.png',640,360,2,'100 DEGREE CAMERAS CENTRED ON EACH BODY')
    # Paired noon/golden comparison for the shared game palette.
    contact([('noon',ROOT/'noon.png'),('golden',ROOT/'golden.png')],dest/'noon-beside-golden.png',1024,512,1,'ROUND FOUR NOON / APPROVED GOLDEN SKY')
    print('Round-four review crops and body-centred player views written.')


if __name__=='__main__':
    main()

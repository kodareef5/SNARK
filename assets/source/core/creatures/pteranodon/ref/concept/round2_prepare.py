"""Crop the supplied head projections at 1000 px/m, preserving projection."""
from pathlib import Path
from PIL import Image
import json
R=Path(__file__).resolve().parent
D=R/'round2_inputs';D.mkdir(exist_ok=True)
spec={'head_side':('side',(240,610,880,1090),(1800,1300),(100,50)), 'head_front':('front',(1420,560,1780,1040),(1100,1300),(100,50))}
for name,(src,box,size,offset) in spec.items():
    im=Image.open(R/'blockout_guides'/f'guide_{src}.png').convert('RGB').crop(box)
    im=im.resize((round(im.width*2.5),round(im.height*2.5)),Image.Resampling.LANCZOS)
    out=Image.new('RGB',size,(214,212,206));out.paste(im,offset);out.save(D/f'{name}_guide.png')
    m=Image.open(R/'blockout_guides'/f'guide_{src}_mask.png').convert('L').crop(box)
    m=m.resize(im.size,Image.Resampling.LANCZOS);o=Image.new('L',size);o.paste(m,offset);o.save(D/f'{name}_mask.png')
(D/'head_registration.json').write_text(json.dumps(spec,indent=2))

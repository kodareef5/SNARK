from PIL import Image,ImageDraw
from pathlib import Path
import json
root=Path(__file__).resolve().parent
plans={}
for folded in [False,True]:
 name='saddled_folded_side' if folded else 'saddled_side'
 src='folded_side_fix' if folded else 'side'
 im=Image.open(root/'originals'/f'{src}.png').convert('RGB').resize((1600,1600),Image.Resampling.LANCZOS)
 d=ImageDraw.Draw(im)
 def p(z,y):return(900-400*z,1450-400*y)
 hip=(-.19,1.06) if folded else (-.08,.95)
 dz=hip[0]+.08;dy=hip[1]-.95
 lm={'hip':hip,'shoulder':(-.12+dz,1.49+dy),'head_centre':(-.10+dz,1.70+dy),'head_top':(-.10+dz,1.81+dy),'knee':(.27+dz,.74+dy),'ankle':(.26+dz,.31+dy),'toe':(.41+dz,.28+dy),'elbow':(.10+dz,1.24+dy),'palm':(.28+dz,1.12+dy)}
 plans[name]=lm
 # outline guide only, generated painting will replace.
 d.line([p(*lm[k]) for k in ['hip','shoulder']],fill='#9D7F60',width=64)
 d.line([p(*lm[k]) for k in ['hip','knee','ankle','toe']],fill='#75604A',width=35,joint='curve')
 d.line([p(*lm[k]) for k in ['shoulder','elbow','palm']],fill='#9D7F60',width=26,joint='curve')
 cx,cy=p(*lm['head_centre']);d.ellipse((cx-29,cy-44,cx+29,cy+44),fill='#B99A7A')
 im.save(root/'guides'/f'{name}.png')
(root/'checks'/'rider_plan.json').write_text(json.dumps(plans,indent=2))

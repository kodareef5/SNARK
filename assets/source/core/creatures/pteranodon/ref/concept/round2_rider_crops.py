"""Isolate the rider head at 4x for local imagegen refinement, no warping."""
from pathlib import Path
from PIL import Image
import json
R=Path(__file__).resolve().parent
spec={'saddled_side':(865,640,1035,845),'saddled_folded_side':(925,675,1085,875)}
for n,b in spec.items():
    for suffix,src in [('paint',R/f'{n}.png'),('guide',R/'blockout_guides'/f'guide_{n}.png')]:
        im=Image.open(src).crop(b);im.resize((im.width*4,im.height*4),Image.Resampling.LANCZOS).save(R/'round2_inputs'/f'{n}_head_{suffix}.png')
(R/'round2_inputs'/'rider_head_boxes.json').write_text(json.dumps(spec,indent=2))

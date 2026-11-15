"""Registered 2x head crops for a final generated surface repair."""
from pathlib import Path
from PIL import Image
import json
R=Path(__file__).resolve().parent
box=(280,640,840,970)
for n in ['side','saddled_side']:
    for label,source in [('paint',R/f'{n}.png'),('guide',R/'blockout_guides'/f'guide_{n}.png')]:
        Image.open(source).crop(box).resize((1120,660),Image.Resampling.LANCZOS).save(R/'round2_inputs'/f'{n}_common_head_{label}.png')
(R/'round2_inputs'/'common_head_box.json').write_text(json.dumps({'box':box,'scale':2,'folded_translation':[72,-44]},indent=2))

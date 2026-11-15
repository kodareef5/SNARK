"""Check deliverable inventory, masks and background; make complete inspection sheets."""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import json,numpy as np,hashlib
ROOT=Path(__file__).resolve().parents[1]
views=json.loads((ROOT/'checks/cameras.json').read_text())
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',17)
mask_sheet=Image.new('RGB',(1254,1840),(240,239,235));d=ImageDraw.Draw(mask_sheet)
for i,name in enumerate(views):
 im=Image.open(ROOT/f'{name}_mask.png').convert('RGB');im.thumbnail((418,418));x=i%3*418;y=i//3*460;mask_sheet.paste(im,(x,y+32));d.text((x+15,y+6),name+' mask',font=font,fill=(30,42,45))
mask_sheet.save(ROOT/'checks/mask_contact.png')
# Material details and every small end projection at original or integer scale.
items=[('pick_side',(900,380,1120,920)),('hatchet_side',(820,510,1130,850)),('spear_head_edge',(435,565,990,680)),('pick_end',(550,380,705,920)),('hatchet_end',(555,520,710,850)),('spear_head_end',(555,580,700,680))]
sheet=Image.new('RGB',(1600,1254),(240,239,235));d=ImageDraw.Draw(sheet)
positions=[(40,60),(330,60),(760,60),(40,690),(330,690),(760,690)]
for (name,box),(x,y) in zip(items,positions):
 im=Image.open(ROOT/(name+'.png')).crop(box)
 if name.startswith('spear'):im=im.resize((im.width*1,im.height*1),Image.Resampling.NEAREST)
 sheet.paste(im,(x,y));d.text((x,y-28),name+' / original pixels',font=font,fill=(30,42,45))
sheet.save(ROOT/'checks/details_contact.png')
required=[n+s+'.png' for n in views for s in ['', '_mask']]+['lineup.png','hero.png','read_sizes.png']
m=json.loads((ROOT/'checks/measurements.json').read_text())
assert not m['summary']['dimension_failures'], m['summary']['dimension_failures']
assert not m['summary']['cross_view_failures'], m['summary']['cross_view_failures']
assert all(v['background_is_exact_rgb_214_212_206'] and v['mask_support_matches_color'] for v in m['views'].values())
manifest={}
for name in required:
 p=ROOT/name;im=Image.open(p);assert im.size==(1254,1254),(name,im.size)
 if name.endswith('_mask.png'):assert im.mode=='L'
 manifest[name]={'size_px':list(im.size),'mode':im.mode,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
(ROOT/'checks/deliverables.json').write_text(json.dumps(manifest,indent=2))
print('Verified',len(required),'PNGs, all 1254 x 1254.')

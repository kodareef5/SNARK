"""Lossless layout/alpha compositing; all creative painting is by imagegen."""
from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
import json
import numpy as np
R=Path(__file__).resolve().parents[1];OUT=R.parent;BG=(214,212,206)
def flat(im):
    bg=Image.new('RGBA',im.size,BG+(255,));bg.alpha_composite(im.convert('RGBA'));return bg.convert('RGB')
def matte(im):
    im=im.convert('RGBA')
    # Remove near-zero alpha export noise, retaining visible fibre hairs.
    im.putalpha(im.getchannel('A').point(lambda a:0 if a<=8 else a))
    return im
for name in ['pick','hatchet','spear_head']:
    p=R/'paint_sources'/f'{name}_paint_rgba.png'
    if not p.exists():continue
    im=matte(Image.open(p))
    if im.size!=(1254,1254):im=im.resize((1254,1254),Image.Resampling.LANCZOS)
    flat(im).save(OUT/f'paint_{name}.png')
fp=R/'paint_sources/first_person_paint.png'
if fp.exists():
    im=Image.open(fp).convert('RGB');im=im.resize((1254,706),Image.Resampling.LANCZOS);im.save(OUT/'paint_first_person.png')

# Three paintings in a single continuous field; tiny icons are literally 64 px,
# not large illustrative substitutes. Cropping/rotation/resampling are layout.
if all((OUT/f'paint_{n}.png').exists() for n in ['pick','hatchet','spear_head']) and (R/'paint_sources/spear_inventory_paint_rgba.png').exists():
    sheet=Image.new('RGB',(2400,1024),BG)
    icon_info={}
    for i,(tool,painting,angle) in enumerate([('pick','pick',20),('hatchet','hatchet',20),('spear','spear_head',0)]):
        im=Image.open(OUT/f'paint_{painting}.png');im=im.resize((800,800),Image.Resampling.LANCZOS)
        sheet.paste(im,(i*800,0))
        name=tool if tool!='spear' else 'spear_inventory'
        src=matte(Image.open(R/'paint_sources'/f'{name}_paint_rgba.png'))
        if angle:src=src.rotate(angle,resample=Image.Resampling.BICUBIC,expand=True)
        # Use alpha support (including fine cord hairs) rather than colour keys.
        b=src.getchannel('A').point(lambda a:255 if a>=128 else 0).getbbox();src=src.crop(b)
        factor=64/max(src.size);size=tuple(max(1,round(v*factor)) for v in src.size)
        icon=src.resize(size,Image.Resampling.LANCZOS)
        canvas=Image.new('RGBA',(64,64),(0,0,0,0));canvas.alpha_composite(icon,((64-size[0])//2,(64-size[1])//2))
        canvas.save(R/'paint_sources'/f'{tool}_inventory_64.png')
        sheet.paste(flat(canvas),(i*800+368,860))
        icon_info[tool]={'canvas_px':[64,64],'fitted_object_extent_px':list(size),'rotation_ccw_degrees':angle,'sheet_top_left_px':[i*800+368,860],'source':str((R/'paint_sources'/f'{name}_paint_rgba.png').relative_to(R)),'view':'three quarter, broad head face visible'}
    sheet.save(OUT/'paint_sheet.png')
    (R/'checks/paint_inventory.json').write_text(json.dumps(icon_info,indent=2))
    # Native 64px icons plus nearest-neighbour magnification for honest review.
    check=Image.new('RGB',(1254,640),BG);d=ImageDraw.Draw(check)
    font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',20)
    for i,tool in enumerate(['pick','hatchet','spear']):
        icon=Image.open(R/'paint_sources'/f'{tool}_inventory_64.png')
        check.paste(flat(icon),(i*418+175,75))
        # Host Pillow's nearest-neighbour upscaler fails for RGB; explicit
        # integer repetition is exactly equivalent and keeps pixels honest.
        large=Image.fromarray(np.repeat(np.repeat(np.asarray(flat(icon)),5,axis=0),5,axis=1))
        check.paste(large,(i*418+49,200))
        d.text((i*418+50,30),tool+' | native 64 px',font=font,fill=(30,40,45))
    d.text((50,565),'Below: 5x nearest-neighbour enlargement; no sharpening or added pixels.',font=font,fill=(30,40,45))
    check.save(R/'checks/paint_inventory_check.png')

from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
R=Path(__file__).resolve().parents[1];BG=(214,212,206)
contact=Image.new('RGB',(1500,1000),BG)
for i,name in enumerate(['pick','hatchet','spear_head','spear_inventory','first_person']):
    if not (R/'guides'/f'{name}_rgba.png').exists():continue
    im=Image.open(R/'guides'/f'{name}_rgba.png').convert('RGBA')
    bg=Image.new('RGBA',im.size,BG+(255,));bg.alpha_composite(im)
    bg.convert('RGB').save(R/'guides'/f'{name}.png')
    thumb=bg.convert('RGB');thumb.thumbnail((500,500));contact.paste(thumb,(i%3*500,i//3*500))
contact.save(R/'checks/paint_guide_contact.png')

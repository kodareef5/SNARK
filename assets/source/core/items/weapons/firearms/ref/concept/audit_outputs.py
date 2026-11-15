"""Independent file, pixel, mask and icon audit. No renderer dependency."""
from pathlib import Path
from PIL import Image,ImageOps
import numpy as np
import hashlib,json
ROOT=Path(__file__).resolve().parent
guns=['revolver','rifle','shotgun','flare']
names=[g+'_'+v for g in guns for v in ['side','top','front']]+['rifle_action_side','rifle_action_top']
out={'views':{},'sheets':{},'icon_comparison':{}}
for name in names:
    raw=ImageOps.mirror(Image.open(ROOT/'renders'/(name+'.png')).convert('RGBA'))
    if name.startswith('rifle_action'):
        a=np.array(raw);a[:,:20,3]=0;a[:,1220:,3]=0;raw=Image.fromarray(a)
    color=Image.open(ROOT/(name+'.png'));mask=Image.open(ROOT/(name+'_mask.png'))
    expected=Image.new('RGB',raw.size,(214,212,206));expected.paste(raw,(0,0),raw)
    a=np.asarray(raw.getchannel('A'));m=np.asarray(mask);c=np.asarray(color)
    b=c[a==0]
    out['views'][name]={'canvas_correct':color.size==mask.size==(1254,1254),'mask_exact_rgba_coverage':bool(np.array_equal(a,m)),'composite_pixel_exact':bool(np.array_equal(np.asarray(expected),c)),'empty_background_exact':bool(np.all(b==np.array([214,212,206]))),'mask_foreground_pixels':int(np.sum(m>=128)),'sha256':hashlib.sha256((ROOT/(name+'.png')).read_bytes()).hexdigest()}
for name in ['hero','lineup','sights','read_sizes']:
    im=Image.open(ROOT/(name+'.png'));out['sheets'][name]={'size':list(im.size),'canvas_correct':im.size==(1254,1254),'mode':im.mode,'sha256':hashlib.sha256((ROOT/(name+'.png')).read_bytes()).hexdigest()}
icons={}
for gun in guns:
    m=Image.open(ROOT/(gun+'_side_mask.png'));m=m.crop(m.getbbox());r=32/max(m.size);m=m.resize((round(m.width*r),round(m.height*r)),Image.Resampling.LANCZOS)
    p=Image.new('L',(32,32),0);p.paste(m,((32-m.width)//2,(32-m.height)//2));icons[gun]=np.array(p)>64
for i,g in enumerate(guns):
    for h in guns[i+1:]:
        a,b=icons[g],icons[h];out['icon_comparison'][g+' / '+h]={'different_pixels':int(np.sum(a!=b)),'silhouette_iou':float(np.sum(a&b)/np.sum(a|b))}
out['all_file_checks_pass']=all(all(v[k] for k in ['canvas_correct','mask_exact_rgba_coverage','composite_pixel_exact','empty_background_exact']) for v in out['views'].values()) and all(v['canvas_correct'] for v in out['sheets'].values())
(ROOT/'checks/file_audit.json').write_text(json.dumps(out,indent=2))
print(json.dumps({'all_file_checks_pass':out['all_file_checks_pass'],'colour_views':len(names),'masks':len(names),'sheets':len(out['sheets']),'icon_comparison':out['icon_comparison']},indent=2))

# All fourteen silhouettes in one check sheet, preserving each full canvas.
sheet=Image.new('RGB',(4*418,4*418),(214,212,206))
from PIL import ImageDraw,ImageFont
d=ImageDraw.Draw(sheet);f=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',16)
for i,name in enumerate(names):
    im=Image.open(ROOT/(name+'_mask.png')).convert('RGB').resize((418,418),Image.Resampling.LANCZOS)
    x=i%4*418;y=i//4*418;sheet.paste(im,(x,y));d.text((x+10,y+10),name,fill=(210,190,130),font=f)
sheet.save(ROOT/'checks/masks_review.png')

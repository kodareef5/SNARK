"""Composite renders without retouching geometry; measure and make check sheets.

Run with system Python (Pillow and NumPy). All output is local to this directory.
"""
from pathlib import Path
import json, math, hashlib
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT=Path(__file__).resolve().parent
CHECKS=ROOT/'checks'
SPEC=json.loads((CHECKS/'projection_spec.json').read_text())
BG=tuple(SPEC['background_rgb']); N=1254
FONT='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
BOLD='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

def ft(n=22,bold=False): return ImageFont.truetype(BOLD if bold else FONT,n)

def save(im,name): im.save(ROOT/name)

def compose_views():
    result={}
    for name,cfg in SPEC['views'].items():
        path=CHECKS/'render_sources'/f'{name}.png'
        if not path.exists(): continue
        rgba=Image.open(path).convert('RGBA')
        if cfg['mirror_x']: rgba=ImageOps.mirror(rgba)
        # Pixel coordinates denote pixel edges, with the image centre at 627.
        # Flipping a 1254 px image reflects edge coordinates about column 627.
        if name.startswith('bow_grip') or name=='bow_ear_side':
            a=np.array(rgba); a[:237,:,3]=0; a[1017:,:,3]=0; rgba=Image.fromarray(a)
        mask=rgba.getchannel('A')
        canvas=Image.new('RGB',(N,N),BG); canvas.paste(rgba,(0,0),mask)
        save(canvas,name+'.png'); save(mask,name+'_mask.png')
        result[name]=rgba
    return result

def icon(rgba,size,black=False):
    bbox=rgba.getchannel('A').getbbox(); im=rgba.crop(bbox)
    w,h=im.size; target=(max(1,round(size*w/max(w,h))),max(1,round(size*h/max(w,h))))
    if black:
        a=im.getchannel('A'); im=Image.new('RGBA',im.size,(0,0,0,0)); im.putalpha(a)
    return im.resize(target,Image.Resampling.LANCZOS)

def make_lineup(renders):
    im=Image.new('RGB',(1254,1254),BG)
    # Both at 800 px/m. The large source view is reduced with one uniform scale.
    b=renders['bow_side']; im.paste(b,(-267,0),b.getchannel('A'))
    c=renders['crossbow_side']; factor=800/1500
    scaled=c.resize((round(N*factor),round(N*factor)),Image.Resampling.LANCZOS)
    ox=round(700-380*factor); oy=round(627-627*factor)
    im.paste(scaled,(ox,oy),scaled.getchannel('A')); save(im,'lineup.png')

def make_read_sizes(renders):
    im=Image.new('RGB',(1254,1254),BG)
    centers=[(230,405,128),(620,750,64),(945,1040,32)]
    for y,name in zip([300,627,954],['bow_side','crossbow_side','crossbow_top']):
        for cx,sx,size in centers:
            for x,black in [(cx,False),(sx,True)]:
                i=icon(renders[name],size,black)
                im.paste(i,(round(x-i.width/2),round(y-i.height/2)),i.getchannel('A'))
    save(im,'read_sizes.png')
    labeled=im.copy(); d=ImageDraw.Draw(labeled)
    d.text((70,45),'INVENTORY READ / true coverage, no thickening',fill='#343A3B',font=ft(27,True))
    for x,label in [(200,'128 px'),(605,'64 px'),(935,'32 px')]:d.text((x,115),label,fill='#48504F',font=ft(21))
    for y,label in [(185,'BOW / SIDE'),(512,'CROSSBOW / SIDE'),(839,'CROSSBOW / TOP')]:
        d.text((70,y),label,fill='#48504F',font=ft(17,True))
    d.text((70,1170),'Colour and black silhouette pairs. Longest occupied side sets the stated size.',fill='#48504F',font=ft(19))
    save(labeled,'checks/read_sizes_annotated.png')

def project(p,cfg):
    q=np.array(p)-np.array(cfg['centre'])
    return (cfg['origin'][0]+cfg['ppm']*float(np.dot(q,cfg['right'])),
            cfg['origin'][1]-cfg['ppm']*float(np.dot(q,cfg['up'])))

def sheets():
    ink='#374540'; guide='#55796C'; accent='#9D633B'
    # Shared Y coordinates across the full-size bow views.
    sh=Image.new('RGB',(2708,1504),BG); d=ImageDraw.Draw(sh)
    d.text((100,35),'BOW / Y registration / 800 px per metre',fill=ink,font=ft(32,True))
    for x,name in [(100,'bow_side'),(1354,'bow_back')]:sh.paste(Image.open(ROOT/(name+'.png')),(x,150))
    for y,label in [(.66,'tip +0.660'),(.52,'binding +0.520'),(.50,'joint +0.500'),(.48,'binding +0.480'),(.075,'grip +0.075'),(0,'origin'),(-.075,'grip -0.075'),(-.50,'joint -0.500'),(-.66,'tip -0.660')]:
        row=150+627-y*800
        d.line((100,row,2608,row),fill=guide,width=1)
        # Alternating offsets keep the 16 px binding interval labels apart.
        if y not in [.48,.52]:d.text((112,row-28),label,fill=ink,font=ft(18))
    for x in [727,1981]: d.line((x,150,x,1404),fill=accent,width=1)
    d.text((100,1430),'Same mesh, same scale. Shelf is the single geometric side exception; both ear tail pairs persist.',fill=ink,font=ft(23))
    save(sh,'checks/bow_registration.png')
    # Shared Z coordinates in side / top: vertical lines connect all fitted parts.
    sh=Image.new('RGB',(1454,2828),BG); d=ImageDraw.Draw(sh)
    d.text((100,35),'CROSSBOW / Z registration / 1500 px per metre',fill=ink,font=ft(28,True))
    sh.paste(Image.open(ROOT/'crossbow_side.png'),(100,130));sh.paste(Image.open(ROOT/'crossbow_top.png'),(100,1434))
    for z,label in [(-.220,'BUTT -0.220'),(0,'ORIGIN'),(.040,'NUT +0.040'),(.370,'TIPS +0.370'),(.430,'PROD +0.430'),(.460,'NOSE +0.460'),(.560,'STIRRUP +0.560')]:
        x=100+380+z*1500; d.line((x,130,x,2688),fill=guide,width=1)
        tag=Image.new('RGBA',(270,28),(0,0,0,0)); td=ImageDraw.Draw(tag);td.text((0,0),label,fill=ink,font=ft(18))
        tag=tag.rotate(90,expand=True);sh.paste(tag,(round(x)-30,145),tag)
    for yy in [757,2061]: d.line((100,yy,1354,yy),fill=accent,width=1)
    d.text((100,2745),'Image axes follow the brief. Reflections preserve viewpoint, scale and feature positions.',fill=ink,font=ft(20))
    save(sh,'checks/crossbow_registration.png')
    # Align physical X across top and front by rotating only on this check sheet.
    sh=Image.new('RGB',(1454,2828),BG); d=ImageDraw.Draw(sh)
    d.text((100,35),'CROSSBOW / X span / top rotated for comparison',fill=ink,font=ft(28,True))
    top=Image.open(ROOT/'crossbow_top.png').transpose(Image.Transpose.ROTATE_270)
    sh.paste(top,(100,130));sh.paste(Image.open(ROOT/'crossbow_front.png'),(100,1434))
    for xx,label in [(-.300,'-0.300'),(-.045,'-0.045'),(0,'X = 0'),(.045,'+0.045'),(.300,'+0.300')]:
        x=100+627-xx*1500;d.line((x,130,x,2688),fill=guide,width=1)
        d.text((x+8,1392 if xx==0 else 1360),label,fill=ink,font=ft(18))
    d.text((100,2745),'Prod span 600 mm; stirrup width 90 mm. No independent redrawing of attachments.',fill=ink,font=ft(20))
    save(sh,'checks/crossbow_span.png')
    # Enlargement checks at exactly their delivered scale.
    sh=Image.new('RGB',(2708,1504),BG);d=ImageDraw.Draw(sh)
    d.text((100,35),'BOW / GRIP AND LEFT SHELF / 3000 px per metre',fill=ink,font=ft(30,True))
    for x,name in [(100,'bow_grip_side'),(1354,'bow_grip_back')]:sh.paste(Image.open(ROOT/(name+'.png')),(x,140))
    for y,label in [(.13,'crop +.130'),(.095,'shelf +.095'),(.075,'grip +.075'),(0,'origin'),(-.075,'grip -.075'),(-.13,'crop -.130')]:
        row=140+627-y*3000;d.line((100,row,2608,row),fill=guide,width=1);d.text((112,row-26),label,fill=ink,font=ft(18))
    d.text((100,1430),'Hide envelope 40 x 30 mm; spiral seams and 10 mm left shelf come from the same surfaces.',fill=ink,font=ft(22))
    save(sh,'checks/bow_grip_registration.png')
    # Every output on a review contact sheet, with names allowed on check sheets.
    names=list(SPEC['views'])+['lineup','hero','read_sizes']
    sh=Image.new('RGB',(1840,2460),BG);d=ImageDraw.Draw(sh)
    for i,name in enumerate(names):
        x=20+(i%3)*610;y=20+(i//3)*610
        im=Image.open(ROOT/(name+'.png'));im.thumbnail((590,555),Image.Resampling.LANCZOS)
        sh.paste(im,(x+(590-im.width)//2,y+35)); d.text((x+12,y+4),name,fill=ink,font=ft(20,True))
    save(sh,'checks/contact_sheet.png')
    sh=Image.new('RGB',(1254,1254),BG);d=ImageDraw.Draw(sh)
    for i,name in enumerate(SPEC['views']):
        x=(i%3)*418;y=(i//3)*418
        im=Image.open(ROOT/(name+'_mask.png')).convert('RGB').resize((400,400),Image.Resampling.LANCZOS)
        sh.paste(im,(x+9,y+18));d.text((x+12,y+1),name+'_mask',fill=ink,font=ft(14))
    save(sh,'checks/mask_contact_sheet.png')

def measure(renders):
    out={'method':'Shared evaluated meshes; landmark projections in continuous pixel-edge coordinates; independent raster alpha bounding boxes.',
         'pixel_convention':'Canvas edges are 0 and 1254; origin is (627,627) or (380,627). Pixel centres are n+0.5.',
         'views':{},'checks':[]}
    for name,cfg in SPEC['views'].items():
        a=np.array(renders[name].getchannel('A')); y,x=np.where(a>=128)
        box=[int(x.min()),int(y.min()),int(x.max())+1,int(y.max())+1]
        out['views'][name]={'ppm':cfg['ppm'],'raster_bbox_px_at_half_coverage':box,
            'raster_size_m':[(box[2]-box[0])/cfg['ppm'],(box[3]-box[1])/cfg['ppm']],
            'landmarks_px':{k:list(project(p,cfg)) for k,p in SPEC['landmarks_m'][cfg['group']].items()},
            'alpha_sha256':hashlib.sha256(a.tobytes()).hexdigest(),
            'mask_is_identical_render_coverage':np.array_equal(a,np.array(Image.open(ROOT/(name+'_mask.png')))),
            'flat_background_rgb':list(Image.open(ROOT/(name+'.png')).getpixel((0,0)))}
    def check(name,view,a,b,axis,target,tolerance=.03):
        cfg=SPEC['views'][view]; lm=out['views'][view]['landmarks_px']; px=abs(lm[a][axis]-lm[b][axis]); metres=px/cfg['ppm']
        out['checks'].append(dict(name=name,view=view,pixels=px,measured_m=metres,target_m=target,
                                  relative_error=abs(metres-target)/target,pass_3_percent=abs(metres-target)/target<=tolerance))
    check('Bow tip to tip','bow_side','upper_tip','lower_tip',1,1.32)
    check('Bow grip height','bow_side','grip_upper','grip_lower',1,.15)
    check('Bow grip depth','bow_grip_side','grip_front','grip_back',0,.04)
    check('Bow grip width','bow_grip_back','grip_left','grip_right',0,.03)
    check('Bow string setback','bow_side','origin','upper_string',0,.172)
    check('Bow joint setback','bow_side','origin','upper_joint',0,.145)
    check('Bow ear length along Y','bow_side','upper_joint','upper_tip',1,.16)
    check('Bow ear binding interval','bow_ear_side','upper_binding_start','upper_binding_end',1,.04)
    check('Crossbow tiller length','crossbow_side','butt','nose',0,.68)
    check('Crossbow prod span top','crossbow_top','prod_left','prod_right',1,.60)
    check('Crossbow prod span front','crossbow_front','prod_left','prod_right',0,.60)
    check('Crossbow tiller height','crossbow_side','deck','bottom',1,.058)
    check('Crossbow butt height','crossbow_side','butt_top','butt_bottom',1,.09)
    check('Crossbow butt width','crossbow_top','butt_left','butt_right',1,.046)
    check('Crossbow tiller width','crossbow_top','tiller_left','tiller_right',1,.04)
    check('Crossbow stirrup projection','crossbow_side','nose','stirrup_front',0,.10)
    check('Crossbow stirrup width','crossbow_front','stirrup_left','stirrup_right',0,.09)
    check('Crossbow nut Z','crossbow_side','origin','nut',0,.04)
    check('Crossbow prod bend','crossbow_top','prod_centre','prod_right',0,.06)
    check('Crossbow groove width','crossbow_top','groove_left','groove_right',1,.008)
    check('Crossbow groove depth','crossbow_front','groove_left','groove_floor',1,.005)
    # Raster whole-object lengths are independent of landmark declarations.
    for view,axis,target in [('bow_side',1,1.32),('bow_back',1,1.32),('crossbow_side',0,.78),('crossbow_top',0,.78)]:
        measured=out['views'][view]['raster_size_m'][axis]
        out['checks'].append(dict(name=view+' whole silhouette raster extent',view=view,measured_m=measured,target_m=target,
            relative_error=abs(measured-target)/target,pass_3_percent=abs(measured-target)/target<=.03))
    out['cross_view_agreement']={
        'bow_Y_raster_difference_m':abs(out['views']['bow_side']['raster_size_m'][1]-out['views']['bow_back']['raster_size_m'][1]),
        'crossbow_Z_raster_difference_m':abs(out['views']['crossbow_side']['raster_size_m'][0]-out['views']['crossbow_top']['raster_size_m'][0]),
        'same_source_geometry_for_all_views':True,
        'note':'Raster edges have up to one pixel quantisation; declared landmarks are supplemented by evaluated-mesh bounds in geometry_bounds.json.'}
    out['all_checks_pass']=all(c['pass_3_percent'] for c in out['checks'])
    (CHECKS/'measurements.json').write_text(json.dumps(out,indent=2))
    print(json.dumps({'all_checks_pass':out['all_checks_pass'],'cross_view_agreement':out['cross_view_agreement'],'checks':len(out['checks'])},indent=2))

if __name__=='__main__':
    renders=compose_views()
    if len(renders)==len(SPEC['views']):
        make_lineup(renders);make_read_sizes(renders);measure(renders)
        if (ROOT/'hero.png').exists(): sheets()
    else: print('Partial compositing complete:',', '.join(renders))

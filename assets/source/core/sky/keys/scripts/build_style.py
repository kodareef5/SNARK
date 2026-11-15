#!/usr/bin/env python3
"""Rebuild the colour scripts from retained, untouched image-tool originals.

Python 3 + Pillow, NumPy, SciPy. Run from this project's root.
The user explicitly authorized scripts; no synthetic replacement landscape is used.
All grading is on linear-light RGB. Labels are outside the painted 2:1 frames.
"""
from pathlib import Path
import csv
import json
import hashlib
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageCms
from scipy.ndimage import map_coordinates

ROOT = Path(__file__).resolve().parents[1]
STYLE = ROOT / 'style'
REPORTS = ROOT / 'reports'
KEYS = ['dawn', 'morning', 'noon', 'afternoon', 'golden-hour', 'sunset', 'dusk', 'night']
TITLES = ['DAWN', 'MORNING', 'NOON', 'AFTERNOON', 'GOLDEN HOUR', 'SUNSET', 'DUSK', 'NIGHT']
ANGLES = ['SUN +2°', 'SUN +15°', 'SUN +66°', 'SUN +35°', 'SUN +8°', 'SUN 0°', 'SUN −8°', 'HIGH MOON']
MOODS = ['First light / blue shade', 'Dew-clear air / warm gold', 'Mineral blue / pearl haze', 'Soft gold / gathering haze', 'Honey light / long blue shade', 'Copper rim / rose return', 'Ember line / rising earth shadow', 'Silver stone / readable blue']
OPEN = [59, 91, 123, 111, 64, 49, 36, 36]
SHADE = [35, 70, 70, 70, 55, 29, 21, 21]
OPEN_HUE = [(54,60,75),(99,90,76),(127,123,116),(118,109,95),(77,62,47),(61,46,41),(36,35,45),(31,36,45)]
SHADE_HUE = [(25,35,52),(56,71,90),(55,71,94),(53,71,94),(39,56,78),(20,29,44),(15,21,32),(14,21,32)]
ZENITH = [(54,78,123),(45,108,176),(29,86,161),(53,109,174),(48,78,125),(48,56,102),(16,29,58),(9,19,38)]
HORIZON_T = [(197,155,145),(211,214,205),(219,233,225),(224,201,166),(223,154,94),(216,104,65),(139,67,52),(42,66,101)]
HORIZON_A = [(160,158,177),(199,217,223),(211,234,233),(214,208,196),(155,157,179),(95,111,153),(45,56,90),(36,56,88)]
THIRTY_T = [(104,126,164),(124,164,203),(153,193,231),(143,167,199),(119,124,149),(118,89,120),(49,54,92),(20,39,70)]
THIRTY_A = [(105,128,175),(128,174,217),(150,190,230),(136,170,210),(126,141,176),(107,97,145),(47,51,91),(18,36,67)]
LUMA = np.array([.2126, .7152, .0722])
ICC = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
W, H = 1024, 512
PAD, GAP, HEADER, CAP, ROWGAP, FOOTER = 32, 24, 128, 62, 16, 52
SW, SH = PAD*2+2*W+GAP, HEADER+4*(H+CAP)+3*ROWGAP+FOOTER


def decode(v):
    v = np.asarray(v, dtype=np.float64) / 255.
    return np.where(v <= .04045, v / 12.92, ((v + .055)/1.055)**2.4)


def encode(v):
    v = np.clip(v, 0, 1)
    return np.where(v <= .0031308, 12.92*v, 1.055*v**(1/2.4)-.055)*255


def equivalent(v):
    return float(encode(luminance(decode(v))))


def luminance(v):
    # Elementwise sum avoids platform BLAS warnings for large 3-D matmuls.
    return np.sum(v*LUMA,axis=-1)


def sample(a, xy, radius=3):
    x, y = round(xy[0]*a.shape[1]), round(xy[1]*a.shape[0])
    return np.median(a[max(0,y-radius):y+radius+1, max(0,x-radius):x+radius+1], axis=(0,1))


def target_card(hue, level):
    c = decode(hue)
    return c * (decode(level) / luminance(c))


def card_points(direction, hero=False):
    if hero:
        return (.49,.896), (.635,.896)
    return ((.495,.937),(.64,.937)) if direction == 'toward' else ((.410,.938),(.585,.938))


def sky_mask(a, direction, hero=False):
    """Feathered, hand-traced silhouette; then protect dark palm/leaf pixels.

    These are editorial masks, not proof of scene geometry or a physical render.
    """
    h, w = a.shape[:2]
    if hero:
        edge = [(0,.41),(.035,.405),(.06,.48),(.08,.45),(.105,.51),(.12,.60),(.16,.61),(.19,.68),(.25,.684),(.30,.69),(.335,.704),(.778,.704),(.778,.518),(1,.395)]
        horizon = .704
    elif direction == 'toward':
        edge = [(0,.46),(.025,.456),(.045,.51),(.075,.49),(.095,.57),(.115,.60),(.143,.60),(.165,.65),(.194,.67),(.219,.72),(.245,.735),(.275,.724),(.31,.731),(.337,.744),(.783,.744),(.783,.552),(1,.457)]
        horizon = .744
    else:
        edge = [(0,.452),(.212,.555),(.212,.744),(.67,.744),(.70,.728),(.735,.708),(.765,.679),(.80,.646),(.83,.61),(.863,.57),(.89,.516),(.92,.53),(.941,.449),(.961,.45),(.986,.47),(1,.45)]
        horizon = .744
    m = Image.new('L',(w,h),0)
    ImageDraw.Draw(m).polygon([(0,0),(w,0)]+[(round(x*w),round(y*h)) for x,y in reversed(edge)], fill=255)
    # Slight feathering avoids cutting out individual brush edges.
    mask = np.asarray(m.filter(ImageFilter.GaussianBlur(w/1024*1.1)),float)/255
    # In the vegetation strip, reject pixels substantially darker than nearby sky.
    yf = np.arange(h)/h
    # Use the unobstructed centre as a conservative reference, not as replacement pixels.
    lum = luminance(decode(a))
    centre = np.median(lum[:,int(w*.37):int(w*.48)],axis=1)
    left_right = ((np.arange(w)/w < .34) | (np.arange(w)/w > .78))[None,:]
    leaf_strip = ((yf > .39) & (yf < horizon))[...,None] & left_right
    protect = np.clip((lum/(centre[:,None]+1e-6)-.27)/.45,0,1)
    mask *= np.where(leaf_strip,protect,1)
    return mask[...,None]


def lower_noon_sun(a):
    """Correct the generated noon sun from ~77° to the 66° study guide.

    A smooth upper-sky vertical remap ends before any foreground silhouettes.
    """
    h,w = a.shape[:2]
    yy,xx = np.mgrid[:h,:w].astype(float)
    # Unit derivative across the solar disc keeps the disc circular.
    src_y = np.interp(yy/h,[0,.1784,.2184,.44,1],[0,.087,.127,.44,1])*h
    return np.stack([map_coordinates(a[...,k], [src_y,xx],order=1,mode='nearest') for k in range(3)],axis=-1)


def grade(a, i, direction, hero=False):
    a = np.asarray(a,float)
    if i == 2 and direction == 'toward' and not hero:
        a = lower_noon_sun(a)
    raw = decode(a)
    op, sp = card_points(direction,hero)
    co, cs = decode(sample(a,op)),decode(sample(a,sp))
    to, ts = target_card(OPEN_HUE[i],OPEN[i]),target_card(SHADE_HUE[i],SHADE[i])
    yl, yh = luminance(cs), luminance(co)
    # Interpolate diagonal linear RGB gains between the actual two card readings.
    t = np.clip((luminance(raw)-yl)/(yh-yl),0,1)[...,None]
    gains = np.exp(np.log(ts/cs)[None,None,:]*(1-t)+np.log(to/co)[None,None,:]*t)
    land = raw*gains
    # Preserve material highlight contrast; there is no card-only repainting.
    # Each chosen sky control is sampled first, then its RGB gain is interpolated.
    h,w = a.shape[:2]
    horizon = .694 if hero else .735
    mid_y = (horizon+.009)*2/3
    mid_x = .49
    samples = [(.33,.045),(mid_x,mid_y),(.47,horizon)]
    targets = [ZENITH[i], (THIRTY_T if direction=='toward' else THIRTY_A)[i], (HORIZON_T if direction=='toward' else HORIZON_A)[i]]
    stops = [p[1] for p in samples]
    gg = [decode(c)/decode(sample(a,p)) for c,p in zip(targets,samples)]
    # Dusk retains a narrow warm rim, but the middle sky must already be dark.
    if i == 6:
        stops.insert(2,.64 if not hero else .60)
        loc=(.47,stops[2])
        target=(82,66,95) if direction=='toward' else (77,63,90)
        gg.insert(2,decode(target)/decode(sample(a,loc)))
    row_y=np.arange(h)/h
    sky_gains=np.stack([np.exp(np.interp(row_y,stops,np.log(np.array(gg)[:,k]))) for k in range(3)],axis=-1)[:,None,:]
    sky = raw*sky_gains
    if i==2:
        # Prevent a blue-sky red lift from turning white noon cloud edges pink.
        sky[...,1]=np.where(sky[...,0]>sky[...,2],np.maximum(sky[...,1],(sky[...,0]+sky[...,2])*.5),sky[...,1])
    mask=sky_mask(a,direction,hero)
    # Water reflects the sky. Keep the painting's hue, scale with horizon light.
    if hero:
        water=[(.334,.704),(.778,.704),(.778,.787),(.68,.818),(.55,.841),(.4,.842),(.26,.824),(.15,.789),(.11,.754),(.20,.726)]
    elif direction=='toward':
        water=[(.337,.744),(.783,.744),(.783,.821),(.69,.847),(.55,.865),(.41,.865),(.28,.849),(.19,.83),(.12,.802),(.15,.777),(.24,.754)]
    else:
        water=[(.212,.744),(.67,.744),(.77,.754),(.85,.775),(.896,.795),(.85,.821),(.71,.858),(.53,.88),(.34,.883),(.212,.855)]
    wm=Image.new('L',(w,h),0)
    ImageDraw.Draw(wm).polygon([(round(x*w),round(y*h)) for x,y in water],fill=255)
    wm=(np.asarray(wm.filter(ImageFilter.GaussianBlur(w/1024*3)),float)/255)[...,None]
    water_gain=luminance(decode(targets[-1]))/luminance(decode(sample(a,samples[-1])))
    land=land*(1-wm)+raw*water_gain*wm
    combined=land*(1-mask)+sky*mask
    if direction=='toward' and i!=6:
        # Emitting discs retain source colour, independent of the sky grade.
        centres=[(.632,.731),(.636,.635),(.637,.1984),(.691,.435),(.637,.671),(.636,.738),None,(.664,.156)]
        cx,cy=(.625,.643) if hero else centres[i]
        yy,xx=np.mgrid[:h,:w]
        dist=np.sqrt((xx-cx*w)**2+(yy-cy*h)**2)
        disc=(np.clip((.025*w-dist)/(.01*w),0,1)*np.clip((luminance(raw)-.40)/.25,0,1))[...,None]
        combined=combined*(1-disc)+raw*disc
    out=encode(combined)
    return Image.fromarray(np.rint(out).clip(0,255).astype('uint8'))


def font(size, bold=False):
    choices = ['/System/Library/Fonts/Supplemental/Arial Bold.ttf' if bold else '/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc']
    for f in choices:
        if Path(f).exists():
            return ImageFont.truetype(f,size)
    return ImageFont.load_default(size=size)


def save(im,path):
    path.parent.mkdir(parents=True,exist_ok=True)
    im.save(path,icc_profile=ICC)


def compose(panels, direction):
    out=Image.new('RGB',(SW,SH),(14,23,33))
    d=ImageDraw.Draw(out)
    d.text((PAD,27),'LIMESTONE / LAGOON / EMBER',font=font(34,True),fill=(229,226,213))
    subtitle='TOWARD THE LIGHT' if direction=='toward' else 'AWAY FROM THE LIGHT'
    d.text((PAD,78),f'SKY MOOD KEYS   /   {subtitle}   /   ONE ISLAND, EIGHT HOURS',font=font(17),fill=(145,167,183))
    offsets=[]
    for i,p in enumerate(panels):
        x=PAD+(i%2)*(W+GAP); y=HEADER+(i//2)*(H+CAP+ROWGAP)
        offsets.append((x,y));out.paste(p,(x,y))
        d.text((x,y+H+12),f'{i+1:02d}  {TITLES[i]}',font=font(20,True),fill=(226,225,212))
        d.text((x+W,y+H+14),ANGLES[i],font=font(17),anchor='ra',fill=(180,190,197))
        d.text((x,y+H+39),MOODS[i],font=font(14),fill=(135,155,172))
    d.text((PAD,SH-30),'PAINTED LIGHT STUDIES  /  sRGB  /  exposure calibrated to the two ground cards',font=font(14),fill=(127,148,164))
    d.text((SW-PAD,SH-30),'STYLE 01',font=font(14),anchor='ra',fill=(127,148,164))
    return out,offsets


# Small points on the lit top and cooler underside of the recurring cloud ribbon.
CLOUD_L=[(.270,.445),(.300,.435),(.270,.425),(.320,.445),(.350,.445),(.320,.445),(.270,.445),(.270,.320)]
CLOUD_S=[(.270,.455),(.300,.455),(.270,.445),(.320,.455),(.350,.455),(.320,.455),(.270,.455),(.270,.330)]


def main():
    STYLE.mkdir(exist_ok=True);REPORTS.mkdir(exist_ok=True)
    all_panels={};offsets={};raw_cards={};sources=[]
    for direction, filename in [('toward','01-toward-generated.png'),('away','02-away-generated.png')]:
        path=ROOT/'originals'/filename
        im=Image.open(path).convert('RGB')
        sources.append({'path':str(path.relative_to(ROOT)),'size':im.size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
        panels=[];raw_cards[direction]=[]
        for i in range(8):
            c,r=i%2,i//2
            box=(round(c*im.width/2),round(r*im.height/4),round((c+1)*im.width/2),round((r+1)*im.height/4))
            p=im.crop(box).resize((W,H),Image.Resampling.LANCZOS)
            raw_cards[direction].append([equivalent(sample(np.asarray(p),pt)) for pt in card_points(direction)])
            p=grade(p,i,direction)
            save(p,STYLE/'panels'/direction/f'{KEYS[i]}.png')
            panels.append(p)
        all_panels[direction]=panels
        sheet,offsets[direction]=compose(panels,direction)
        save(sheet,STYLE/('sheet.png' if direction=='toward' else 'away.png'))
    # Larger independently generated painting: use its own card and sky readings.
    hero_path=ROOT/'originals'/'03-golden-generated.png'
    hero=Image.open(hero_path).convert('RGB')
    sources.append({'path':str(hero_path.relative_to(ROOT)),'size':hero.size,'sha256':hashlib.sha256(hero_path.read_bytes()).hexdigest()})
    hero=grade(hero.resize((2048,1024),Image.Resampling.LANCZOS),4,'toward',True)
    save(hero,STYLE/'golden-hour-study.png')
    rows=[];details=[]
    for i,key in enumerate(KEYS):
        row={'key':key,'open_target':OPEN[i],'shade_target':SHADE[i]}
        specs=[('zenith','away',(.33,.045),3),('sky30_away','away',(.49,.496),3),('horizon_toward','toward',(.47,.735),3),('horizon_away','away',(.47,.735),3),('card_open','toward',card_points('toward')[0],3),('card_shade','toward',card_points('toward')[1],3),('cloud_lit','toward',CLOUD_L[i],1),('cloud_shade','toward',CLOUD_S[i],1),('away_card_open','away',card_points('away')[0],3),('away_card_shade','away',card_points('away')[1],3)]
        for name,direction,point,radius in specs:
            v=sample(np.asarray(all_panels[direction][i]),point,radius).astype(int)
            row[name]=v.tolist();row[name+'_equiv']=round(equivalent(v),2)
            px,py=round(point[0]*W),round(point[1]*H)
            ox,oy=offsets[direction][i]
            details.append({'key':key,'sample':name,'sheet':'style/sheet.png' if direction=='toward' else 'style/away.png','panel_file':f'style/panels/{direction}/{key}.png','panel_xy':[px,py],'sheet_xy':[ox+px,oy+py],'radius_px':radius,'rgb':v.tolist(),'neutral_equivalent':row[name+'_equiv']})
        row['raw_toward_card_equiv']=[round(x,2) for x in raw_cards['toward'][i]]
        row['raw_away_card_equiv']=[round(x,2) for x in raw_cards['away'][i]]
        rows.append(row)
    (STYLE/'palette.json').write_text(json.dumps({'space':'sRGB IEC 61966-2-1, D65','measurement':'channel-wise median; linear luminance converted to neutral sRGB','keys':rows},indent=2)+'\n')
    with (STYLE/'palette.csv').open('w',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=['key','sample','r','g','b','neutral_equivalent','panel_file','x','y','radius'])
        writer.writeheader()
        for s in details:
            writer.writerow({'key':s['key'],'sample':s['sample'],'r':s['rgb'][0],'g':s['rgb'][1],'b':s['rgb'][2],'neutral_equivalent':s['neutral_equivalent'],'panel_file':s['panel_file'],'x':s['panel_xy'][0],'y':s['panel_xy'][1],'radius':s['radius_px']})
    (REPORTS/'samples.json').write_text(json.dumps(details,indent=2)+'\n')
    (REPORTS/'sources.json').write_text(json.dumps(sources,indent=2)+'\n')
    # Annotated sheets are separate from the deliverable paintings.
    for direction in ['toward','away']:
        marked,_=compose(all_panels[direction],direction)
        d=ImageDraw.Draw(marked)
        aliases={'zenith':'Z','sky30_away':'30','horizon_toward':'HT','horizon_away':'HA','card_open':'O','card_shade':'S','cloud_lit':'CL','cloud_shade':'CS','away_card_open':'O','away_card_shade':'S'}
        expected='style/sheet.png' if direction=='toward' else 'style/away.png'
        for s in details:
            if s['sheet']!=expected:continue
            x,y=s['sheet_xy'];d.ellipse((x-5,y-5,x+5,y+5),outline=(255,248,210),width=1)
            dy=-22 if s['sample']=='cloud_lit' else 7
            d.text((x+8,y+dy),aliases[s['sample']],font=font(14,True),fill=(255,248,210),stroke_width=2,stroke_fill=(10,15,24))
        save(marked,REPORTS/f'samples-{direction}.png')
    print(json.dumps({'sheet_size':[SW,SH],'panel_size':[W,H],'hero_size':hero.size,'cards':[{k:r[k] for k in ['key','card_open_equiv','card_shade_equiv','away_card_open_equiv','away_card_shade_equiv']} for r in rows]},indent=2))


if __name__=='__main__':
    main()

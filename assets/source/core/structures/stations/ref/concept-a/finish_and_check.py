"""Composite exact render alpha, measure silhouettes, assemble modelling guides.
Run with system Python 3 + Pillow + NumPy after build_stations.py.
No drawing is warped or stretched to correct a measurement.
"""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import numpy as np
import json,math,hashlib,datetime
ROOT=Path(__file__).resolve().parent
BG=(214,212,206);N=1254
SPECS={'mortar':(.60,.50,.60,1600),'smithy':(1.60,1.10,.80,700),'bin':(.80,1.20,.70,850)}
VIEWS=['front','side','top','back']
FONT='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
def font(n):return ImageFont.truetype(FONT,n)
def flatten(im):
    out=Image.new('RGBA',im.size,BG+(255,));return Image.alpha_composite(out,im.convert('RGBA')).convert('RGB')
def bbox_alpha(im):
    a=np.asarray(im.getchannel('A'));ys,xs=np.where(a>=128)
    return [int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)]
def draw_dash(d,xy,fill,width=1,dash=12):
    x0,y0,x1,y1=xy;length=math.hypot(x1-x0,y1-y0)
    if not length:return
    for s in range(0,int(length),dash*2):
        e=min(s+dash,length);d.line((x0+(x1-x0)*s/length,y0+(y1-y0)*s/length,x0+(x1-x0)*e/length,y0+(y1-y0)*e/length),fill=fill,width=width)
def project_bbox(b,view,ppm,height):
    lo,hi=b['min_xyz'],b['max_xyz']
    if view=='front':return [627+lo[0]*ppm,627-(hi[2]-height/2)*ppm,627+hi[0]*ppm,627-(lo[2]-height/2)*ppm]
    if view=='back':return [627-hi[0]*ppm,627-(hi[2]-height/2)*ppm,627-lo[0]*ppm,627-(lo[2]-height/2)*ppm]
    if view=='side':return [627+lo[1]*ppm,627-(hi[2]-height/2)*ppm,627+hi[1]*ppm,627-(lo[2]-height/2)*ppm]
    return [627+lo[0]*ppm,627-hi[1]*ppm,627+hi[0]*ppm,627-lo[1]*ppm]
def check_record(name,measured,target,tol=.05):
    return {'name':name,'measured':measured,'target':target,'relative_error':abs(measured-target)/target,'tolerance_relative':tol,'pass':abs(measured-target)<=target*tol+1e-6}
def named_checks(s,geo):
    p=geo['parts'];fm=geo['feature_measurements'];checks=[]
    def c(name,value,target):checks.append(check_record(name,value,target))
    if s=='mortar':
        c('rim width',p['bowl']['size_xyz'][0],.54);c('bowl height',p['bowl']['size_xyz'][2],.36)
        c('feet height',p['feet']['size_xyz'][2],.07);c('hide band height',p['hide_band']['size_xyz'][2],.08)
        # These are measurements on the source mesh, not its rotated world AABB.
        c('pestle axial length',fm['pestle_axial_length'],.38);c('pestle grip diameter',fm['pestle_grip_diameter'],.07);c('pestle grinding diameter',fm['pestle_grinding_diameter'],.10)
        c('pestle lean degrees',fm['pestle_lean_degrees'],30);c('pestle top Z',p['pestle']['max_xyz'][2],.50)
        c('lip thickness excluding notch',fm['lip_thickness'],.06)
    if s=='smithy':
        c('bench width',p['bench_top']['size_xyz'][0],1.30);c('bench depth',p['bench_top']['size_xyz'][1],.75)
        c('bench surface Z',p['bench_top']['max_xyz'][2],.80);c('shelf surface Z',p['shelf']['max_xyz'][2],.20)
        c('stump diameter',p['stump']['size_xyz'][0],.40);c('anvil face Z',p['anvil_face']['max_xyz'][2],.95)
        c('anvil face length',p['anvil_face']['size_xyz'][0],.45);c('anvil face width',p['anvil_face']['size_xyz'][1],.14)
        c('post top Z',p['apron_post']['max_xyz'][2],1.10);c('apron bottom Z',p['apron']['min_xyz'][2],.80)
    if s=='bin':
        c('firebox height',p['firebox']['size_xyz'][2],.30);c('firebox width',p['firebox']['size_xyz'][0],.80);c('firebox depth',p['firebox']['size_xyz'][1],.70)
        c('arch clear width',fm['arch_width'],.36);c('arch clear height',fm['arch_height'],.18)
        c('cabinet width',p['cabinet']['size_xyz'][0],.72);c('cabinet depth',p['cabinet']['size_xyz'][1],.62);c('cabinet top Z',p['cabinet']['max_xyz'][2],1.00)
        c('lid ridge Z',p['lid']['max_xyz'][2],1.12);c('side lid overhang',(p['lid']['size_xyz'][0]-.72)/2,.03)
        c('front lid overhang',(p['lid']['size_xyz'][1]-.62)/2,.03);c('vent cap top Z',p['vent']['max_xyz'][2],1.20)
        c('fuel visible height',p['fuel']['max_xyz'][2]-.025,.09)
    return checks

def guides(s,geo):
    w,h,depth,ppm=SPECS[s];scale=.50;tile=627;pad=65;head=88;gap=50
    sheet=Image.new('RGB',(3*tile+2*pad,2*tile+head+gap+110),BG);d=ImageDraw.Draw(sheet)
    d.text((pad,22),f'{s.upper()}  /  shared geometry, orthographic alignment',font=font(26),fill=(39,43,44))
    panels=[('front',0,0),('side',1,0),('back',2,0),('top',0,1),('top rotated for depth check',1,1),('top mirrored for back check',2,1)]
    for title,col,row in panels:
        v=title.split()[0];im=Image.open(ROOT/f'{s}_{v}.png')
        if 'rotated' in title:im=im.transpose(Image.Transpose.ROTATE_270)
        if 'mirrored' in title:im=im.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        x=pad+tile*col;y=head+(tile+gap)*row
        sheet.paste(im.resize((tile,tile),Image.Resampling.LANCZOS),(x,y));d.text((x+16,y+8),title,font=font(18),fill=(39,43,44))
        # Center cross is a box center, not an object centroid.
        cx=x+tile/2;cy=y+tile/2;d.line((cx-6,cy,cx+6,cy),fill=(151,69,58),width=1);d.line((cx,cy-6,cx,cy+6),fill=(151,69,58),width=1)
    levels={'mortar':[0,.07,.15,.225,.305,.43,.50], 'smithy':[0,.20,.675,.80,.95,1.10], 'bin':[0,.025,.205,.30,1.,1.12,1.20]}[s]
    for z in levels:
        y=head+(627-(z-h/2)*ppm)*scale
        draw_dash(d,(pad,y,pad+3*tile,y),(52,116,128),1,9)
        d.text((7,y-8),f'{z:.3f}',font=font(12),fill=(35,91,105))
    # Width guides couple the front to top and mirrored back to top.
    for col,width in [(0,w),(1,depth),(2,w)]:
        for side in [-1,1]:
            x=pad+col*tile+tile/2+side*width*ppm*scale/2
            draw_dash(d,(x,head+35,x,head+2*tile+gap),(160,78,61),1,10)
    d.text((pad,sheet.height-50),f'Box W/H/D = {w:.2f} / {h:.2f} / {depth:.2f} m  |  original scale {ppm} px/m  |  plates shown at 50%',font=font(18),fill=(39,43,44))
    sheet.save(ROOT/'checks'/f'{s}_alignment.png')
    # Four full-size views with per-part projected bounding rectangles.
    partsheet=Image.new('RGB',(2*N,2*N+70),BG)
    colors=[(34,113,127),(154,70,57),(108,99,46),(77,91,153),(113,65,115)]
    chosen={'mortar':['bowl','feet','pestle','hide_band','lashing'], 'smithy':['bench_top','stump','anvil_face','shelf','apron_post'], 'bin':['firebox','cabinet','lid','vent','fuel']}[s]
    dp=ImageDraw.Draw(partsheet);dp.text((35,18),s.upper()+' / part boundaries projected from the mesh',font=font(24),fill=(39,43,44))
    for idx,v in enumerate(VIEWS):
        x=(idx%2)*N;y=70+(idx//2)*N;partsheet.paste(Image.open(ROOT/f'{s}_{v}.png'),(x,y))
        for j,k in enumerate(chosen):
            bb=project_bbox(geo['parts'][k],v,ppm,h);bb=[bb[0]+x,bb[1]+y,bb[2]+x,bb[3]+y]
            dp.rectangle(bb,outline=colors[j],width=2)
            dp.text((x+24,y+26+j*25),k.replace('_',' '),font=font(17),fill=colors[j])
        dp.text((x+24,y+N-45),v,font=font(24),fill=(39,43,44))
    partsheet.save(ROOT/'checks'/f'{s}_part_overlays.png')

def person(draw,x,baseline,ppm):
    # Unclothed-detail-free neutral scale mannequin, height exactly 1.80 m.
    col=(108,108,104)
    def pts(seq):return [(x+a*ppm,baseline-z*ppm) for a,z in seq]
    outline=[(-.060,1.57),(-.135,1.53),(-.208,1.43),(-.260,1.11),(-.238,1.04),(-.203,1.05),(-.155,1.31),(-.128,1.13),(-.132,.90),(-.114,.52),(-.130,.075),(-.155,.025),(-.151,0),(-.040,0),(-.019,.065),(-.014,.51),(0,.79),(.014,.51),(.019,.065),(.040,0),(.151,0),(.155,.025),(.130,.075),(.114,.52),(.132,.90),(.128,1.13),(.155,1.31),(.203,1.05),(.238,1.04),(.260,1.11),(.208,1.43),(.135,1.53),(.060,1.57)]
    draw.polygon(pts(outline),fill=col)
    draw.ellipse((x-.090*ppm,baseline-1.80*ppm,x+.090*ppm,baseline-1.565*ppm),fill=col)
    draw.rectangle((x-.052*ppm,baseline-1.60*ppm,x+.052*ppm,baseline-1.51*ppm),fill=col)

def make_lineup():
    ppm=400;base=950;sheet=Image.new('RGB',(2000,1100),BG)
    # Paste by world-origin floor, retaining equal scale and all alpha gaps.
    for s,cx in [('mortar',260),('smithy',820),('bin',1430)]:
        w,h,d,p=SPECS[s];im=Image.open(ROOT/'renders'/f'{s}_front_rgba.png').convert('RGBA')
        factor=ppm/p;nn=round(N*factor);im=im.resize((nn,nn),Image.Resampling.LANCZOS)
        sheet.paste(im,(round(cx-nn/2),round(base-h*ppm/2-nn/2)),im)
    person(ImageDraw.Draw(sheet),1800,base,ppm);sheet.save(ROOT/'lineup.png')
    annotated=sheet.copy();d=ImageDraw.Draw(annotated)
    for text,x in [('MORTAR  0.50 m',145),('SMITHY  1.10 m',670),('BIN  1.20 m',1320),('PERSON  1.80 m',1690)]:d.text((x,990),text,font=font(22),fill=(40,43,44))
    d.text((80,50),'COMMON SCALE  /  400 pixels per metre',font=font(28),fill=(40,43,44));d.line((80,950,1920,950),fill=(109,124,124),width=1)
    annotated.save(ROOT/'checks/lineup_annotated.png')

def make_inventory():
    sheet=Image.new('RGB',(1254,820),BG);centres=[260,440,565,800,980,1105]
    records=[]
    for row,s in enumerate(['mortar','smithy','bin','bin_lit']):
        stem='bin_hero_lit' if s=='bin_lit' else s+'_hero'
        im=Image.open(ROOT/'renders'/f'{stem}_rgba.png').convert('RGBA');bb=bbox_alpha(im);crop=im.crop(bb)
        for i,width in enumerate([128,64,32]):
            height=round(width*crop.height/crop.width);thumb=crop.resize((width,height),Image.Resampling.LANCZOS)
            y=110+row*195-height//2
            sheet.paste(thumb,(centres[i]-width//2,y),thumb)
            black=Image.new('RGBA',thumb.size,(0,0,0,255));black.putalpha(thumb.getchannel('A'))
            sheet.paste(black,(centres[i+3]-width//2,y),black)
            records.append({'station_state':s,'width_px':width,'height_px':height,'x':centres[i]-width//2,'y':y,'silhouette_x':centres[i+3]-width//2})
    sheet.save(ROOT/'read_sizes.png')
    d=ImageDraw.Draw(sheet)
    for row,s in enumerate(['MORTAR','SMITHY','BIN / OUT','BIN / LIT']):d.text((22,100+row*195),s,font=font(19),fill=(43,44,43))
    for x,n in zip(centres,[128,64,32,128,64,32]):d.text((x-16,18),str(n),font=font(18),fill=(43,44,43))
    sheet.save(ROOT/'checks/read_sizes_annotated.png')
    (ROOT/'checks/inventory_layout.json').write_text(json.dumps(records,indent=2))

def contact_sheets():
    for s in SPECS:
        views=VIEWS+['hero']+(['front_lit','hero_lit'] if s=='bin' else [])
        cols=3;rows=math.ceil(len(views)/cols);sheet=Image.new('RGB',(627*cols,677*rows),BG);d=ImageDraw.Draw(sheet)
        for i,v in enumerate(views):
            x=i%cols*627;y=i//cols*677;im=Image.open(ROOT/f'{s}_{v}.png').resize((627,627),Image.Resampling.LANCZOS);sheet.paste(im,(x,y+38));d.text((x+20,y+8),s+' / '+v,font=font(21),fill=(40,43,44))
        sheet.save(ROOT/'checks'/f'{s}_contact.png')
        masks=Image.new('RGB',(2*627,2*667),BG);dm=ImageDraw.Draw(masks)
        for i,v in enumerate(VIEWS):
            x=i%2*627;y=i//2*667;im=Image.open(ROOT/f'{s}_{v}_mask.png').resize((627,627),Image.Resampling.LANCZOS);masks.paste(im,(x,y+40));dm.text((x+20,y+8),s+' / '+v+' mask',font=font(21),fill=(40,43,44))
        masks.save(ROOT/'checks'/f'{s}_masks_contact.png')

def main():
    results={'created_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'background_srgb':BG,'measurement_threshold_alpha':128,'stations':{}}
    for s,(w,h,depth,ppm) in SPECS.items():
        geo=json.loads((ROOT/'checks'/f'{s}_geometry.json').read_text());measure={}
        views=VIEWS+['hero']+(['front_lit','hero_lit'] if s=='bin' else [])
        for v in views:
            raw=Image.open(ROOT/'renders'/f'{s}_{v}_rgba.png').convert('RGBA');assert raw.size==(N,N),(s,v,raw.size)
            source=Image.open(ROOT/'renders'/f'{s}_{v}_ground.png').convert('RGBA') if 'hero' in v else raw
            assert source.size==(N,N),(s,v,'ground render size',source.size)
            flatten(source).save(ROOT/f'{s}_{v}.png')
            if 'hero' not in v:
                raw.getchannel('A').save(ROOT/f'{s}_{v}_mask.png')
                bb=bbox_alpha(raw);expected=project_bbox(geo['geometry'],v.replace('_lit',''),ppm,h)
                measure[v]={'bbox_pixels':bb,'projected_mesh_bbox_pixels':expected,'raster_vs_mesh_max_error_px':max(abs(a-b) for a,b in zip(bb,expected)),
                            'width_m':(bb[2]-bb[0])/ppm,'height_m':(bb[3]-bb[1])/ppm,'scale_px_per_m':ppm,
                            'mask_matches_alpha_exactly':bool(np.array_equal(np.asarray(Image.open(ROOT/f'{s}_{v}_mask.png')),np.asarray(raw.getchannel('A'))))}
        widths=[measure[v]['width_m'] for v in ['front','top','back']]
        depths=[measure['side']['width_m'],measure['top']['height_m']]
        heights=[measure[v]['height_m'] for v in ['front','side','back']]
        spreads={'width':max(widths)-min(widths),'depth':max(depths)-min(depths),'height':max(heights)-min(heights)}
        size=geo['geometry']['size_xyz'];errors={'width':abs(size[0]-w),'height':abs(size[2]-h),'depth':abs(size[1]-depth)}
        named=named_checks(s,geo)
        results['stations'][s]={'views':measure,'cross_view_spread_m':spreads,'box_extent_errors_m':errors,'outside_box_metres':geo['outside_box_metres'],
                              'three_materials_only':len(geo['material_families'])<=3,'material_families':geo['material_families'],'named_part_checks':named,
                              'pass':max(spreads.values())<=.01 and max(errors.values())<=.01 and max(geo['outside_box_metres'])<1e-6 and all(c['pass'] for c in named)}
        guides(s,geo)
    # Lit/out silhouettes and all non-fuel front pixels must be invariant.
    a=Image.open(ROOT/'renders/bin_front_rgba.png');b=Image.open(ROOT/'renders/bin_front_lit_rgba.png');aa=np.asarray(a);bb=np.asarray(b)
    results['bin_state_check']={'identical_alpha':np.array_equal(aa[:,:,3],bb[:,:,3]),'changed_pixel_count':int(np.any(aa[:,:,:3]!=bb[:,:,:3],axis=2).sum())}
    ys,xs=np.where(np.any(aa[:,:,:3]!=bb[:,:,:3],axis=2));results['bin_state_check']['changed_bbox_pixels']=[int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)]
    fuelbb=project_bbox(geo['parts']['fuel'],'front',850,1.2)
    outside=np.ones((N,N),dtype=bool)
    outside[math.floor(fuelbb[1])-2:math.ceil(fuelbb[3])+2,math.floor(fuelbb[0])-2:math.ceil(fuelbb[2])+2]=False
    delta=np.max(np.abs(aa[:,:,:3].astype(int)-bb[:,:,:3].astype(int)),axis=2)
    results['bin_state_check']['fuel_projected_bbox_pixels']=fuelbb
    results['bin_state_check']['max_rgb_change_outside_fuel']=int(delta[outside].max())
    results['bin_state_check']['only_fuel_changes']=int(delta[outside].max())<=1
    make_lineup();make_inventory();contact_sheets()
    results['all_checks_pass']=all(v['pass'] for v in results['stations'].values()) and results['bin_state_check']['identical_alpha'] and results['bin_state_check']['only_fuel_changes']
    (ROOT/'checks/measurements.json').write_text(json.dumps(results,indent=2,default=lambda v:bool(v)))
    files={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(ROOT.glob('*.png'))}
    (ROOT/'checks/deliverable_sha256.json').write_text(json.dumps(files,indent=2))
    print(json.dumps(results,indent=2,default=lambda v:bool(v)))
if __name__=='__main__':main()

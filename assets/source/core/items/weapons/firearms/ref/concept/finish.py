"""Exact canvas compositing, silhouette masks, comparisons and measurements.
Run with python3 finish.py after build.py. No source view is stretched to fit.
"""
from PIL import Image, ImageOps, ImageDraw, ImageFont
import numpy as np
import json, math, time
from pathlib import Path

ROOT=Path(__file__).resolve().parent
BG=(214,212,206); N=1254
GUNS=['revolver','rifle','shotgun','flare']
manifest=json.loads((ROOT/'checks/scene_measurements.json').read_text())
fontpath='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
def font(size):return ImageFont.truetype(fontpath,size)
def label(d,xy,t,size=20,fill=(45,44,41)):d.text(xy,t,font=font(size),fill=fill)
def save(im,name):im.save(ROOT/name)
def background(size=(N,N)):return Image.new('RGB',size,BG)
IMAGES={}
for name,v in manifest['views'].items():
    im=ImageOps.mirror(Image.open(ROOT/'renders'/f'{name}.png').convert('RGBA'))
    if name.startswith('rifle_action'):
        a=np.asarray(im).copy();a[:,:20,3]=0;a[:,1220:,3]=0;im=Image.fromarray(a)
    IMAGES[name]=im
    out=background(im.size);out.paste(im,(0,0),im)
    if v['view'] in ['side','top','front']:
        save(out,name+'.png')
        # Preserve the exact antialiased coverage used by the colour composite.
        mask=im.getchannel('A')
        save(mask,name+'_mask.png')
    elif v['view']=='left':save(out,'checks/rifle_left_detail.png')
    else:save(out,'checks/'+name+'.png')

if (ROOT/'renders/hero.png').exists():
    # Only a rigid image rotation/reflection for presentation. No geometry edits.
    h=Image.open(ROOT/'renders/hero.png').convert('RGB')
    save(ImageOps.mirror(h),'hero.png')

def cut(name):
    im=IMAGES[name];return im.crop(im.getchannel('A').getbbox())

# Common physical scale; lower rows retain the real size difference.
lineup=background()
for gun,y in zip(['rifle','shotgun','revolver','flare'],[180,440,710,1010]):
    im=cut(gun+'_side');ratio=800/manifest['views'][gun+'_side']['pixels_per_metre']
    im=im.resize((round(im.width*ratio),round(im.height*ratio)),Image.Resampling.LANCZOS)
    lineup.paste(im,(85,y-im.height//2),im)
save(lineup,'lineup.png')

# Native pixels, no enlarged tiny icons in the deliverable sheet.
read=background();readcheck=background()
for row,gun in enumerate(GUNS):
    y=155+row*285
    im=cut(gun+'_side')
    for col,size in enumerate([128,64,32]):
        ratio=size/max(im.size);small=im.resize((round(im.width*ratio),round(im.height*ratio)),Image.Resampling.LANCZOS)
        x=[140,370,550][col]
        pos=(x+(128-small.width)//2,y-small.height//2)
        read.paste(small,pos,small)
        alpha=small.getchannel('A');sil=Image.new('RGBA',small.size,(0,0,0,0));sil.putalpha(alpha)
        read.paste(sil,(pos[0]+610,pos[1]),sil)
readcheck=read.copy();d=ImageDraw.Draw(readcheck)
for row,gun in enumerate(GUNS):label(d,(30,40+row*285),gun.upper(),24)
for x in [140,750]:
    for col,size in enumerate([128,64,32]):label(d,(x+[0,230,410][col],12),str(size)+' px',16)
save(read,'read_sizes.png');save(readcheck,'checks/read_sizes_labeled.png')

aimsheet=background()
for i,gun in enumerate(GUNS):
    im=Image.open(ROOT/'checks'/f'{gun}_aim.png').convert('RGB')
    # Original aim crops all use the same 6500 px/m. Reduce uniformly into panels.
    im=im.resize((627,627),Image.Resampling.LANCZOS)
    aimsheet.paste(im,((i%2)*627,(i//2)*627))
save(aimsheet,'sights.png')
aimcheck=aimsheet.copy();d=ImageDraw.Draw(aimcheck)
for i,gun in enumerate(GUNS):
    x=(i%2)*627;y=(i//2)*627
    label(d,(x+20,y+20),gun.upper(),22)
    d.line((x+180,y+313.5,x+447,y+313.5),fill=(155,70,53),width=1)
    d.line((x+313.5,y+220,x+313.5,y+405),fill=(155,70,53),width=1)
save(aimcheck,'checks/sights_overlay.png')

action=background((1254,2508));d=ImageDraw.Draw(action)
for j,view in enumerate(['side','top']):
    action.paste(Image.open(ROOT/('rifle_action_'+view+'.png')),(0,j*1254))
    label(d,(30,30+j*1254),'RIFLE ACTION / '+view.upper()+' / 3000 px per metre',25)
for j,z in enumerate([-.120,-.070,-.030,-.010,.120,.200,.280]):
    u=380+3000*z;d.line((u,100,u,2400),fill=(118,130,126),width=1);label(d,(min(u+5,1150),1190+(j%2)*23),f'{z:+.3f} m',15)
save(action,'checks/rifle_action_overlay.png')
receiver_detail=Image.open(ROOT/'rifle_action_side.png').crop((150,580,790,930)).resize((1280,700),Image.Resampling.LANCZOS)
save(receiver_detail,'checks/final_receiver_detail.png')

# Projection math and evaluated geometry are audited separately from the raster.
spec={
 'revolver':{'scale':3000,'axis':.040,'sight':.062,'muzzle':.230,'butt_y':-.095,'butt_z':-.035,'barrel':'eight flat octagonal barrel','grip':'birds head wood grip','front':'front blade','rear':'rear notch base','zrefs':[-.045,-.020,.005,.050,.058,.075,.190,.220,.230]},
 'rifle':{'scale':800,'axis':.022,'sight':.052,'muzzle':.980,'butt_y':-.088,'butt_z':-.380,'barrel':'thick muzzle','grip':'butt and narrow wrist','front':'front blade','rear':'open rear sight base','zrefs':[-.380,-.330,-.150,-.070,-.030,.120,.200,.400,.680,.700,.960,.980]},
 'shotgun':{'scale':1100,'axis':.020,'sight':.040,'muzzle':.680,'butt_y':-.090,'butt_z':-.360,'barrel':'right barrel','grip':'straight grip butt','front':'brass muzzle bead','rear':'central sight rib','zrefs':[-.360,-.060,-.045,.060,.080,.110,.270,.300,.666,.680]},
 'flare':{'scale':3000,'axis':.048,'sight':.084,'muzzle':.200,'butt_y':-.090,'butt_z':-.030,'barrel':'flared wood muzzle','grip':'curved wood grip','front':'carved front sight bump','rear':'wood hammer and jaw','zrefs':[-.045,-.030,.004,.016,.089,.101,.174,.186,.190,.200]}}
audit={'method':'Evaluated mesh bounds, analytic orthographic projection, plus independent 50% coverage raster silhouette extents. Colour and mask share the same RGBA render, without stretching.','pixel_convention':'Continuous coordinates measured from canvas outer edges; integer pixel i has centre i+0.5.','guns':{},'exceptions':[]}
def bounds(gun,part):return manifest['objects'][gun][part]
def project(name,p):
    v=manifest['views'][name];s=v['pixels_per_metre'];o=v['origin']
    return [o[0]+s*sum(a*b for a,b in zip(p,v['screen_right'])),o[1]-s*sum(a*b for a,b in zip(p,v['screen_up']))]
def bbox_from_mask(name):
    return Image.open(ROOT/(name+'_mask.png')).point(lambda x:255 if x>=128 else 0).getbbox()
def projected_bounds(name):
    v=manifest['views'][name];pts=[]
    for b in manifest['objects'][v['gun']].values():
        for x in [b['min'][0],b['max'][0]]:
            for y in [b['min'][1],b['max'][1]]:
                for z in [b['min'][2],b['max'][2]]:pts.append(project(name,(x,y,z)))
    a=np.array(pts);return [float(a[:,0].min()),float(a[:,1].min()),float(a[:,0].max()),float(a[:,1].max())]
for gun,s in spec.items():
    barrel=bounds(gun,s['barrel']);grip=bounds(gun,s['grip']);fr=bounds(gun,s['front']);rr=bounds(gun,s['rear'])
    vals={
      'muzzle_z':(barrel['max'][2],s['muzzle'],.03*abs(s['muzzle'])),
      'barrel_axis_y':((barrel['max'][1]+barrel['min'][1])/2,s['axis'],.03*s['axis']),
      'butt_bottom_y':(grip['min'][1],s['butt_y'],.03*abs(s['butt_y'])),
      'front_sight_top_y':(fr['max'][1],s['sight'],.001),
      'rear_reference_y':(rr['max'][1],.095 if gun=='flare' else s['sight'],.001)}
    if gun in ['rifle','shotgun']:vals['butt_z']=(grip['min'][2],s['butt_z'],.03*abs(s['butt_z']))
    values={k:{'actual_m':a,'requested_m':e,'error_mm':abs(a-e)*1000,'tolerance_mm':t*1000,'pass':abs(a-e)<=t} for k,(a,e,t) in vals.items()}
    landmarks={'grip_origin':(0,0,0),'muzzle_axis':(0,s['axis'],barrel['max'][2]),'barrel_axis_at_start':(0,s['axis'],.058 if gun=='revolver' else (.120 if gun=='rifle' else (.060 if gun=='shotgun' else -.030))),'butt_bottom':(0,grip['min'][1],s['butt_z']),'front_sight_top':(0,fr['max'][1],(.220 if gun=='revolver' else .960 if gun=='rifle' else .670 if gun=='shotgun' else .190)),'rear_reference':(0,rr['max'][1],(-.020 if gun=='revolver' else .200 if gun=='rifle' else -.060 if gun=='shotgun' else -.045))}
    projections={}
    for view in ['side','top','front']:
        name=gun+'_'+view;v=manifest['views'][name];scale=v['pixels_per_metre']
        pb=projected_bounds(name);rb=list(bbox_from_mask(name));errors=[abs(a-b) for a,b in zip(pb,rb)]
        projections[view]={'landmarks_px':{k:project(name,p) for k,p in landmarks.items()},'analytic_silhouette_bbox_px':pb,'raster_silhouette_bbox_px':rb,'edge_errors_px':errors,'max_edge_error_mm':max(errors)/scale*1000,'pass_2mm':max(errors)/scale<=.002,'background_exact':list(Image.open(ROOT/(name+'.png')).getpixel((0,0)))==list(BG)}
    side=bbox_from_mask(gun+'_side');top=bbox_from_mask(gun+'_top');front=bbox_from_mask(gun+'_front')
    zerr=max(abs(side[i]-top[i]) for i in [0,2])/s['scale']
    yerr=abs((side[3]-side[1])/s['scale']-(front[3]-front[1])/3000)
    xerr=abs((top[3]-top[1])/s['scale']-(front[2]-front[0])/3000)
    total=max(b['max'][2] for b in manifest['objects'][gun].values())-min(b['min'][2] for b in manifest['objects'][gun].values())
    sidepixels=np.asarray(Image.open(ROOT/(gun+'_side_mask.png')))
    u_sight=projections['side']['landmarks_px']['front_sight_top'][0]
    column=int(u_sight)
    top_sight_pixel=int(np.where(sidepixels[:,column]>=128)[0][0])
    raster_sight_y=(manifest['views'][gun+'_side']['origin'][1]-top_sight_pixel)/s['scale']
    sight_pixel_check={'sample_column':column,'top_edge_row':top_sight_pixel,'converted_y_m':raster_sight_y,'requested_y_m':s['sight'],'error_mm':abs(raster_sight_y-s['sight'])*1000,'pass_1mm':abs(raster_sight_y-s['sight'])<=.001}
    audit['guns'][gun]={'measurements':values,'projection_checks':projections,'front_sight_raster_measurement':sight_pixel_check,'view_agreement':{'z_endpoint_disagreement_mm':zerr*1000,'allowed_z_mm':total*.01*1000,'y_extent_disagreement_mm':yerr*1000,'x_extent_disagreement_mm':xerr*1000,'pass':zerr<=total*.01 and yerr<=.002 and xerr<=.002},'sight_front_rear_delta_mm':(fr['max'][1]-rr['max'][1])*1000}
    # Side and top are stacked at their original full size, sharing Z guides.
    sheet=background((2508,2508));sheet.paste(Image.open(ROOT/(gun+'_side.png')),(0,0));sheet.paste(Image.open(ROOT/(gun+'_top.png')),(0,1254));sheet.paste(Image.open(ROOT/(gun+'_front.png')),(1254,0))
    d=ImageDraw.Draw(sheet)
    for j,z in enumerate(s['zrefs']):
        u=project(gun+'_side',(0,0,z))[0]
        d.line((u,90,u,2440),fill=(144,149,141),width=1)
        label(d,(u+3,1120+(j%3)*25),f'{z:+.3f}',14)
    for name,color in [('grip_origin',(141,74,50)),('muzzle_axis',(44,111,135)),('front_sight_top',(126,60,44)),('rear_reference',(126,60,44)),('butt_bottom',(57,101,79))]:
        for view,ox,oy in [('side',0,0),('top',0,1254),('front',1254,0)]:
            u,v=projections[view]['landmarks_px'][name];u+=ox;v+=oy
            d.ellipse((u-5,v-5,u+5,v+5),outline=color,width=2)
    axisrow=project(gun+'_side',(0,s['axis'],0))[1]
    sightrow=project(gun+'_side',(0,s['sight'],0))[1]
    for row,col in [(axisrow,(56,116,143)),(sightrow,(155,77,52))]:d.line((35,row,1220,row),fill=col,width=1)
    # Join corresponding heights across the differing specified camera scales.
    for yy,col in [(s['axis'],(56,116,143)),(s['sight'],(155,77,52)),(grip['min'][1],(57,101,79))]:
        vs=project(gun+'_side',(0,yy,0))[1];vf=project(gun+'_front',(0,yy,0))[1]
        d.line([(1180,vs),(1290,vf),(2450,vf)],fill=col,width=1)
    label(d,(35,25),gun.upper()+' / RIGHT SIDE + TOP / SHARED Z GUIDES',29)
    label(d,(1290,25),'FRONT / 3000 px per metre',27)
    label(d,(1290,1290),'MEASURED AGREEMENT',30)
    yy=1350
    for k,v in audit['guns'][gun]['view_agreement'].items():label(d,(1290,yy),f'{k}: {v if isinstance(v,bool) else round(v,4)}',22);yy+=40
    yy+=40
    for k,v in values.items():label(d,(1290,yy),f'{k}: {v["actual_m"]:.6f} m',22);yy+=40
    label(d,(1290,yy+45),'Dots: grip, muzzle axis, butt, sight references.',20)
    label(d,(1290,yy+80),'Blue: barrel axis. Rust: specified front sight height.',20)
    label(d,(1290,yy+115),'Part bounds and pixel positions: measurements.json',20)
    save(sheet,'checks/'+gun+'_projection_overlay.png')

component_specs={
 'revolver':[
  ('grip_width','birds head wood grip',0,'span',.030),('frame_start','forged frame',2,'min',-.045),('frame_end','forged frame',2,'max',.005),('frame_top','forged frame',1,'max',.058),
  ('cylinder_start','five fluted cylinder',2,'min',.005),('cylinder_end','five fluted cylinder',2,'max',.058),('brass_band_width','brass cylinder front band',2,'span',.008),
  ('octagon_across_flats','eight flat octagonal barrel',1,'span',.022),('hammer_top','hooked hammer',1,'max',.082),('folded_trigger_bottom','folded trigger',1,'min',-.002)],
 'rifle':[
  ('butt_width','butt and narrow wrist',0,'span',.040),('butt_height','steel butt plate',1,'span',.105),('receiver_start','receiver',2,'min',-.070),('receiver_end','receiver',2,'max',.120),('receiver_top','receiver',1,'max',.045),('receiver_width','receiver',0,'span',.030),
  ('bolt_knob_width','right round bolt knob',0,'span',.020),('bolt_knob_x','right round bolt knob',0,'mid',.035),('bolt_knob_y','right round bolt knob',1,'mid',.030),('bolt_knob_z','right round bolt knob',2,'mid',-.030),
  ('neck_start','long wood neck',2,'min',.120),('neck_end','long wood neck',2,'max',.700),('neck_width','long wood neck',0,'span',.030),('barrel_diameter','round barrel',1,'span',.022),('muzzle_diameter','thick muzzle',1,'span',.026),
  ('band_one_width','brass neck band 0.4',2,'span',.010),('band_two_width','brass neck band 0.68',2,'span',.010),('band_one_z','brass neck band 0.4',2,'mid',.400),('band_two_z','brass neck band 0.68',2,'mid',.680),
  ('pad_start','left hide cheek pad',2,'min',-.330),('pad_end','left hide cheek pad',2,'max',-.150)],
 'shotgun':[
  ('butt_width','straight grip butt',0,'span',.040),('butt_height','steel butt plate',1,'span',.110),('action_width','wide twin action',0,'span',.046),('action_start','wide twin action',2,'min',-.060),('action_end','wide twin action',2,'max',.060),('action_top','wide twin action',1,'max',.040),
  ('right_barrel_diameter','right barrel',0,'span',.024),('left_barrel_diameter','left barrel',0,'span',.024),('right_barrel_x','right barrel',0,'mid',.0125),('left_barrel_x','left barrel',0,'mid',-.0125),
  ('forend_start','stubby wooden forend',2,'min',.080),('forend_end','stubby wooden forend',2,'max',.300),('forend_width','stubby wooden forend',0,'span',.044),('forend_bottom','stubby wooden forend',1,'min',-.020),
  ('wrap_start','hide forend sleeve',2,'min',.110),('wrap_end','hide forend sleeve',2,'max',.270),('muzzle_band_width','single brass muzzle band',2,'span',.014)],
 'flare':[
  ('grip_width','curved wood grip',0,'span',.032),('barrel_diameter','carved hollow wood barrel',0,'span',.056),('muzzle_diameter','flared wood muzzle',0,'span',.062),('breech_z','rounded wooden breech',2,'min',-.030),('flint_length','clamped flint wedge',2,'span',.030),('peg_trigger_bottom','wood peg trigger',1,'min',-.005)]}
for gun,entries in component_specs.items():
    out={}
    for label_,part,axis,kind,requested in entries:
        b=bounds(gun,part);lo=b['min'][axis];hi=b['max'][axis]
        actual=hi-lo if kind=='span' else (hi+lo)/2 if kind=='mid' else b[kind][axis]
        tolerance=max(.0002,abs(requested)*.03)
        out[label_]={'part':part,'axis':'XYZ'[axis],'measure':kind,'requested_m':requested,'actual_m':actual,'error_mm':abs(actual-requested)*1000,'tolerance_mm':tolerance*1000,'pass':abs(actual-requested)<=tolerance}
    audit['guns'][gun]['component_dimensions']=out

audit['exceptions']=[
 {'id':'material_count','status':'brief_conflict','resolution':'Keep all explicitly requested fittings. Revolver and shotgun use wood/steel/brass/hide; rifle also has cord lacing. Wear colours and dark cavities are treatments of their parent materials, not extra substance.'},
 {'id':'flare_sight','status':'brief_conflict','barrel_top_y_m':.076,'front_top_y_m':.084,'hammer_top_y_m':.095,'front_to_rear_difference_mm':11,'resolution':'Preserve the three numeric heights. Aim sheet is exactly parallel to Z at front bump height; the hammer obstructs this line. No claim of valid aligned sights.'},
 {'id':'revolver_sight','status':'brief_conflict','specified_line_y_m':.062,'cylinder_top_y_m':.063,'band_top_y_m':.06335,'resolution':'Preserve 46 mm cylinder on the specified .040 m axis. Cylinder/band crest and raised hammer obstruct the .062 m aiming line. No invisible geometry or camera offset is used to hide the obstruction.'},
 {'id':'rifle_neck_length','status':'brief_conflict','neck_length_m':.580,'overall_length_m':1.360,'fraction':.580/1.360,'resolution':'Use numeric fore-stock endpoints +.120 to +.700, giving 42.65% of overall length, despite the prose specifying more than half.'},
 {'id':'screen_axes','status':'explicit_projection_convention','resolution':'The given viewing sides and image axes are left-handed. Render from the specified physical side and reflect the image horizontally to satisfy the requested pixel axes. No shape rescaling.'},
 {'id':'grip_origin','status':'brief_conflict','resolution':'Preserve the specified origin and numeric geometry. Pistol gripping surfaces lie mostly below y=0, rather than being centred on that origin.'}
]
audit['exceptions'] += [
 {'id':'rear_notch_tangency','status':'brief_conflict','resolution':'The rifle front blade top is exactly level with the bottom of the rear notch, as specified. In a truly parallel rear view its blade is occluded below that tangent. The shotgun bead is similarly tangent to the rear rib height. Sights are not raised silently to make the aiming sheet prettier.'},
 {'id':'32px_long_gun_readability','status':'visual_limitation','resolution':'At 32 px longest dimension, the specified rifle barrel is 0.52 px thick and one shotgun barrel is 0.74 px thick in side view. Their silhouettes differ, but quick identification is weaker than the two pistols. No nonuniform icon stretching or oversized replacement silhouette is used.'}
]
(ROOT/'checks/measurements.json').write_text(json.dumps(audit,indent=2))

# Complete visual review contact sheets. These are check sheets, so labels allowed.
for gun in GUNS:
    sheet=background((1881,1254));d=ImageDraw.Draw(sheet)
    names=[gun+'_side',gun+'_top',gun+'_front',gun+'_aim']
    for i,name in enumerate(names):
        p=ROOT/(name+'.png') if i<3 else ROOT/'checks'/(name+'.png')
        im=Image.open(p).convert('RGB');im=im.resize((627,627),Image.Resampling.LANCZOS)
        x=(i%3)*627;y=(i//3)*627;sheet.paste(im,(x,y));label(d,(x+12,y+12),name,21)
    # A tight detail from the same orthographic pass; no new design decisions.
    im=cut(gun+'_side');im.thumbnail((1150,500),Image.Resampling.LANCZOS)
    sheet.paste(im,(650,690),im)
    label(d,(650,650),'SAME SIDE / DETAIL CROP',20)
    save(sheet,'checks/'+gun+'_review.png')

fails=[]
for gun,a in audit['guns'].items():
    if not a['view_agreement']['pass']:fails.append(gun+' view agreement')
    if not a['front_sight_raster_measurement']['pass_1mm']:fails.append(gun+' front sight raster height')
    for k,m in a['measurements'].items():
        if not m['pass']:fails.append(gun+' '+k)
    for k,m in a['component_dimensions'].items():
        if not m['pass']:fails.append(gun+' '+k)
    for k,m in a['projection_checks'].items():
        if not m['pass_2mm']:fails.append(gun+' '+k+' raster edge')
print(json.dumps({'check_failures':fails,'brief_conflicts':len(audit['exceptions']),'views':len(IMAGES)},indent=2))

"""Validate hood painting and make Python previews; writes this group's checks/ only."""
from pathlib import Path
import hashlib,json,site,sys,subprocess
site.addsitedir(site.getusersitepackages())
import numpy as np
from PIL import Image,ImageDraw,ImageFont
from scipy.ndimage import distance_transform_edt, label
from scipy.spatial import cKDTree
from paint import ROOT,PAINT,DODO,BAKES,STUDY,OUT,N,lin,srgb,geometry,normals,input_hashes
from paint import sources,canvas,flat_vertices,stamp,softened_cap
QA=ROOT/'checks';QA.mkdir(exist_ok=True)
try:FONT=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',18)
except OSError:FONT=ImageFont.load_default()
PALETTE=['#6B737A','#D1A292','#8B9166','#C29533','#312D2A','#E6E2D6']
REGIONS=np.array([[255,0,0],[0,255,0],[0,0,255],[0,255,255],[255,0,255],[255,255,0]])
DYES={'concept umber':'#3B302A','warm umber':'#6A4532','near-white':'#F3F1EA','lime':'#B7EB38','near-black':'#15171A'}

def rgb(x):return np.uint8(np.rint(np.clip(srgb(x),0,1)*255))
def colour(s):return lin(np.array([int(s[i:i+2],16) for i in [1,3,5]])/255)
def caption(im,title):
    p=Image.new('RGB',(im.width,im.height+32),(27,30,33));p.paste(im,(0,32));ImageDraw.Draw(p).text((8,5),title,font=FONT,fill='white');return p

def tilelit(b,n,oc,dye,light=(-.5,.45,.74)):
    l=np.array(light);l/=np.linalg.norm(l)
    lighting=.43+.70*np.maximum(np.sum(n*l,axis=-1),0)
    return Image.fromarray(rgb(lin(b[...,:3]/255)*colour(dye)/.5*lighting[...,None]*oc[...,None]))


def neck_join(g,base,height,regions):
    """Measure nearest physical pairs across the two painters' UV cut."""
    folder=PAINT/'body/layers'
    if not (folder/'layers.json').exists():return {'available':False}
    meta=json.loads((PAINT/'pieces.json').read_text());ids=np.array(Image.open(PAINT/'pieces.png'))[...,0]
    number=next(p['number'] for p in meta['pieces'] if p['name']=='shell_body')
    mask=ids==number;edge=mask&(distance_transform_edt(mask)<1.5)
    coords=np.argwhere(edge);pos=[]
    for i,c in enumerate('xyz'):
        a=np.array(Image.open(PAINT/f'position_{c}.png'))[edge]/65535
        pos.append(1000*(meta['position_box']['min'][i]+a*(meta['position_box']['max'][i]-meta['position_box']['min'][i])))
    pos=np.stack(pos,-1);red=g['own']&np.all(regions==[255,0,0],axis=-1)
    rim=red&(distance_transform_edt(g['own'])<1.5)
    distance,nearest=cKDTree(pos).query(g['pos'][rim]);near=distance<.8
    if not near.any():return {'available':False,'reason':'no adjacent body edge samples'}
    other=np.array(Image.open(folder/'dodo_base.png'));other_h=np.array(Image.open(folder/'dodo_height.png'))/65535*json.loads((folder/'layers.json').read_text())['height_mm']
    y,x=coords[nearest[near]].T
    bd=abs(lin(base[rim,0][near]/255)-lin(other[y,x,0]/255));hd=abs(height[rim][near]-other_h[y,x])
    return dict(available=True,pairs=int(near.sum()),max_pair_distance_mm=float(distance[near].max()),
                base_linear_jump_mean=float(bd.mean()),base_linear_jump_p95=float(np.percentile(bd,95)),
                height_jump_mm_mean=float(hd.mean()),height_jump_mm_p95=float(np.percentile(hd,95)))


def maps_and_cards():
    info=json.loads((OUT/'layers.json').read_text());piece=np.array(Image.open(PAINT/'pieces.png'))[...,0]
    meta=json.loads((PAINT/'pieces.json').read_text());own=piece==next(p['number'] for p in meta['pieces'] if p['name']=='shell_hood')
    b=np.array(Image.open(OUT/'dodo_base.png'));h=np.array(Image.open(OUT/'dodo_height.png'))/65535*info['height_mm']
    oc=np.array(Image.open(OUT/'dodo_occlusion.png'))/255;rough=np.array(Image.open(OUT/'dodo_rough.png'))
    rg=np.array(Image.open(OUT/'dodo_regions.png'));bake=np.array(Image.open(BAKES/'dodo_regions.png'))
    mm=np.array(Image.open(PAINT/'texel_mm.png'))/1000;n=normals(h,mm,own)
    mean=float(lin(b[own,:3]/255).mean());v=lin(b[own,0]/255);lightcorr=[]
    for phi in np.linspace(0,2*np.pi,12,endpoint=False):
        l=np.array([.7*np.cos(phi),.7*np.sin(phi),.714]);lightcorr.append(float(abs(np.corrcoef(v,np.sum(n[own]*l,-1))[0,1])))
    failures=[]
    regional_means={}
    for name,colour_id in [('body',[255,0,0]),('hood',[255,0,255])]:
        region=own&np.all(rg==colour_id,axis=-1)
        if not region.any():continue
        regional_means[name]={'texels':int(region.sum()),'mean_linear':float(lin(b[region,:3]/255).mean())}
        if abs(regional_means[name]['mean_linear']-.5)>.02:failures.append(name+' regional mean grey')
    if not np.all(b[own,3]==255):failures.append('unpainted shell texels')
    if np.any(b[~own]!=0) or np.any(rg[~own]):failures.append('painting outside shell ownership')
    if not np.array_equal(rg[own],bake[own]):failures.append('shell region differs from bake')
    if abs(mean-.5)>.02:failures.append('shell mean grey')
    if np.max(np.ptp(b[own,:3].astype(int),axis=1))>2:failures.append('shell not neutral')
    if max(lightcorr)>.08:failures.append('shell directional base correlation')
    composed_normal=np.array(Image.open(QA/'composed/dodo_normal.png'))
    # The current compositor extends height AND piece IDs into UV padding
    # before taking derivatives, including at the first covered texel.
    nearest=distance_transform_edt(piece==0,return_distances=False,return_indices=True)
    padded_own=own[nearest[0],nearest[1]]
    padded_height=h[nearest[0],nearest[1]]
    expected=normals(padded_height,mm,padded_own)
    expected_normal=np.rint((expected*.5+.5)*255).clip(0,255).astype(np.uint8)
    normal_error=int(np.abs(composed_normal[own].astype(int)-expected_normal[own].astype(int)).max())
    if normal_error>1:failures.append('composed shell normal disagrees with delivered height')
    for prefix in ['dodo','cards']:
        for suffix in ['base','height','rough','occlusion','regions']:
            im=Image.open(OUT/f'{prefix}_{suffix}.png')
            if im.size!=(N,N):failures.append('incorrect map size')
            if suffix=='height' and np.array(im).dtype!=np.uint16:failures.append('height not 16 bit')
    x0,y0,x1,y1=geometry()['box'];sl=np.s_[y0:y1,x0:x1];crop=b[sl];normal=n[sl];occ=oc[sl];mask=own[sl]
    plate=Image.new('RGB',(3*(x1-x0),2*(y1-y0+32)),(27,30,33))
    choices=[('unlit / concept umber',Image.fromarray(rgb(lin(crop[...,:3]/255)*colour('#3B302A')/.5)))]
    for title,dye in DYES.items():choices.append((title,tilelit(crop,normal,occ,dye)))
    for i,(title,im) in enumerate(choices):
        # The lower shell now includes body plumage; preserve its own dye in
        # swatches intended to compare changes to the hood colour.
        body_mask=np.all(rg[sl]==[255,0,0],axis=-1)&mask
        body_im=Image.fromarray(rgb(lin(crop[...,:3]/255)*colour('#6B737A')/.5)) if i==0 else tilelit(crop,normal,occ,'#6B737A')
        im.paste(body_im,(0,0),Image.fromarray(np.uint8(body_mask*255)))
        bg=Image.new('RGB',im.size,(205,203,196));bg.paste(im,(0,0),Image.fromarray(np.uint8(mask*255)))
        plate.paste(caption(bg,title),((i%3)*(x1-x0),(i//3)*(y1-y0+32)))
    plate.save(QA/'hood_layout_dyes.jpg',quality=97)
    plate=Image.new('RGB',(3*(x1-x0),y1-y0+32),(27,30,33))
    for i,l in enumerate([(-.55,.45,.70),(.65,.15,.70),(-.1,-.7,.70)]):
        im=tilelit(crop,normal,occ,'#413225',l);bg=Image.new('RGB',im.size,(205,203,196));bg.paste(im,(0,0),Image.fromarray(np.uint8(mask*255)))
        plate.paste(caption(bg,'relit direction '+str(i+1)),(i*(x1-x0),0))
    plate.save(QA/'hood_relighting.jpg',quality=97)
    # Baked flow over the painted island, with physical length zones.
    g=geometry();im=Image.fromarray(rgb(lin(crop[...,:3]/255)*colour('#413225')/.5));d=ImageDraw.Draw(im)
    for yy in range(15,mask.shape[0],35):
        for xx in range(15,mask.shape[1],35):
            if not mask[yy,xx]:continue
            dx,dy=g['flow'][yy,xx]*14;d.line((xx-dx*.5,yy-dy*.5,xx+dx*.5,yy+dy*.5),fill=(100,215,180),width=1)
            d.ellipse((xx+dx*.5-1,yy+dy*.5-1,xx+dx*.5+1,yy+dy*.5+1),fill='white')
    caption(im,'Baked flow / dot at feather tip').save(QA/'flow_layout.png')
    # Area-weighted location and size evidence from the actual placements.
    placement_file=json.loads((OUT/'placements.json').read_text());placements=placement_file['shell']
    mane=placement_file['cards']['mane']['placements']
    mane_dimensions=dict(length_mm=[min(p['length_mm'] for p in mane),max(p['length_mm'] for p in mane)],
                         width_mm=[min(p['width_mm'] for p in mane),max(p['width_mm'] for p in mane)],
                         rows=len(set(p['layer'] for p in mane)),feathers=len(mane))
    if any(not (30<=p['length_mm']<=50 and 15<=p['width_mm']<=25) for p in mane):failures.append('mane feather dimensions outside round-4 brief')
    zone_lengths={k:[] for k in ['forehead_crown','back_head','nape','face_edge']}
    for p in placements:
        xx,yy=np.rint(np.array(p['center_px'])-[x0,y0]).astype(int);xx=np.clip(xx,0,mask.shape[1]-1);yy=np.clip(yy,0,mask.shape[0]-1)
        P=g['pos'][yy,xx];edge=g['edge_distance'][yy,xx]
        name='face_edge' if edge<5 else 'forehead_crown' if P[1]>625 or P[2]>145 else 'back_head' if P[1]>590 else 'nape'
        zone_lengths[name].append(p['length_mm'])
    # Cards exactly as composed at 512, plus their true physical proportions.
    comp=QA/'composed';cb=np.array(Image.open(comp/'dodo_cards_base.png'));cn=np.array(Image.open(comp/'dodo_cards_normal.png'))/127.5-1
    cn/=np.linalg.norm(cn,axis=-1,keepdims=True);cp=np.array(Image.open(comp/'dodo_cards_packed.png'))
    ours=np.zeros((N,N),bool);cardstats={};physical=[]
    original=np.array(Image.open(OUT/'cards_base.png'));crg=np.array(Image.open(OUT/'cards_regions.png'))
    measured_cards=json.loads((PAINT/'pieces.json').read_text())['cards']
    full=Image.new('RGB',(512,512),(221,160,137));lit=tilelit(cb,cn,cp[...,0]/255,'#413225')
    for kind,meta in info['card_rectangles'].items():
        measured=measured_cards[kind]
        if meta['size_mm']!=measured['card_mm'] or meta.get('mm_per_texel')!=measured['mm_per_texel']:
            failures.append(kind+' does not use current measured dimensions')
        u0,v0,u1,v1=measured['rect']
        if meta['box_px']!=[round(u0*N),round((1-v1)*N),round(u1*N),round((1-v0)*N)]:
            failures.append(kind+' does not use current measured rectangle')
        xx0,yy0,xx1,yy1=meta['box_px'];ours[yy0:yy1,xx0:xx1]=True
        # Reproduce the compositor's box filter BEFORE thresholding.
        a=original[yy0:yy1,xx0:xx1,3]/255
        cardstats[kind]={'root_coverage':float((a[:4]>=.5).mean()),'bottom_row_coverage':float((a[-1]>=.5).mean())}
        box=[int(round(v/4)) for v in meta['box_px']];small=cb[box[1]:box[3],box[0]:box[2]]
        cut=small[...,3]>=128;slit=lit.crop(box);full.paste(slit,(box[0],box[1]),Image.fromarray(np.uint8(cut*255)))
        cardstats[kind]['visible_pixels_512']=int(cut.sum())
        if not cut.any():failures.append(kind+' disappears at 512')
        wm,hm=meta['size_mm'];size=(round(wm*4),round(hm*4))
        cardstats[kind]['solid_top_third_512']=float(cut[:cut.shape[0]//3].mean())
        cardstats[kind]['solid_top_half_512']=float(cut[:cut.shape[0]//2].mean())
        cardstats[kind]['solid_root_3mm_512']=float(cut[:max(1,int(3/hm*cut.shape[0]))].mean())
        profile={}
        for depth in ([3,5,7.5,9,10] if kind=='hood' else [hm*f for f in [.5,.65,.8,.9,.97]] if kind=='mane' else [3,6,9]):
            row=cut[min(int(depth/hm*cut.shape[0]),cut.shape[0]-1)]
            run=np.diff(np.r_[False,~row,False].astype(int));starts=np.where(run==1)[0];ends=np.where(run==-1)[0]
            profile[str(depth)]=dict(coverage=float(row.mean()),largest_gap_mm=float(max(ends-starts,default=0)/len(row)*wm))
        cardstats[kind]['depth_profile_mm']=profile
        cardstats[kind]['last_solid_depth_mm']=float((np.where(cut)[0].max()+1)/cut.shape[0]*hm)
        if kind=='hood':
            if cardstats[kind]['solid_top_half_512']!=1:failures.append('hood upper half has a gap at final 512 resolution')
            if cardstats[kind]['solid_root_3mm_512']<.995:failures.append('hood buried root band is not solid at 512')
            if profile['7.5']['largest_gap_mm']>4:failures.append('hood has gaps wider than 4 mm at 7.5 mm depth')
            if not .10<profile['10']['coverage']<.95:failures.append('hood feather ends do not separate over skin')
            components,_=label(cut,np.ones((3,3)))
            rooted=np.unique(components[0]);detached=cut&~np.isin(components,rooted)
            cardstats[kind]['detached_pixels_512']=int(detached.sum())
            if detached.sum()>4:failures.append('hood has detached tuft pixels at final 512 resolution')
            tufts={}
            for item in placement_file['cards']['hood']['placements']:
                if item['layer'].startswith('tuft_'):tufts.setdefault(item['layer'],[]).append(item)
            cardstats[kind]['tuft_counts']=[len(v) for v in tufts.values()]
            cardstats[kind]['tuft_feather_length_mm']=[min(p['length_mm'] for v in tufts.values() for p in v),max(p['length_mm'] for v in tufts.values() for p in v)]
            if any(not 2<=len(v)<=5 or any(not 4<=p['length_mm']<=8 for p in v) for v in tufts.values()):
                failures.append('hood tufts do not have 2–5 feathers of 4–8 mm')
        if kind=='mane' and cardstats[kind]['last_solid_depth_mm']<hm-2:failures.append('mane tips end more than 2 mm short after shrinking')
        im=slit.resize(size,Image.Resampling.BILINEAR);alpha=Image.fromarray(small[...,3]).resize(size,Image.Resampling.BILINEAR)
        rose=Image.new('RGB',size,(221,160,137));rose.paste(im,(0,0),Image.fromarray(np.uint8((np.array(alpha)>=128)*255)))
        physical.append((kind+' / from 512 / 4 pixels per mm',rose))
    full.save(QA/'cards_512_on_rose.png')
    if np.any(original[~ours]!=0) or np.any(crg[~ours]!=0):failures.append('cards painted outside assigned rectangles')
    if not np.all(crg[ours]==[255,0,255]):failures.append('wrong card region')
    vis=ours&(original[...,3]>=128);cardmean=float(lin(original[vis,:3]/255).mean())
    if abs(cardmean-.5)>.02:failures.append('card mean grey')
    if np.max(np.ptp(original[vis,:3].astype(int),axis=1))>2:failures.append('cards not neutral')
    board=Image.new('RGB',(max(1120,696+physical[2][1].width),max(800,188+physical[2][1].height)),(27,30,33));d=ImageDraw.Draw(board)
    board.paste(caption(physical[0][1],physical[0][0]),(16,16))
    d.text((16,140),'forehead / from 512 / 4 pixels per mm',font=FONT,fill='white')
    board.paste(physical[1][1],(16,172))
    board.paste(caption(physical[2][1],physical[2][0]),(680,140))
    board.paste(caption(full,'Assigned rectangles at final atlas size'),(16,250))
    board.save(QA/'cards_physical_review.jpg',quality=98)
    ours512=np.array(Image.fromarray(np.uint8(ours*255)).resize((512,512),Image.Resampling.NEAREST))>0
    a512=np.where(ours512,cb[...,3],0).astype(np.uint8)
    dyes=Image.new('RGB',(1536,544),(27,30,33))
    for i,(title,dye) in enumerate([('concept umber','#3B302A'),('warm umber','#6A4532'),('near-white','#F3F1EA')]):
        rose=Image.new('RGB',(512,512),(221,160,137));decal=tilelit(cb,cn,cp[...,0]/255,dye)
        rose.paste(decal,(0,0),Image.fromarray(np.uint8((a512>=128)*255)))
        dyes.paste(caption(rose,title+' / final 512 / alpha cut 0.5'),(i*512,0))
    dyes.save(QA/'cards_dyes_512.jpg',quality=98)
    small=np.array(Image.fromarray(np.dstack([np.array(lit),a512])).resize((128,128),Image.Resampling.BOX))
    rose=Image.new('RGB',(128,128),(221,160,137));rose.paste(Image.fromarray(small[...,:3]),(0,0),Image.fromarray(np.uint8((small[...,3]>=128)*255)))
    rose.save(QA/'cards_quarter_128.png')
    rose.resize((512,512),Image.Resampling.NEAREST).save(QA/'cards_quarter_128_nearest.png')
    sourcehashes=json.loads((STUDY/'accepted_hashes.json').read_text())
    unchanged=all(hashlib.sha256(((STUDY/'source' if category=='source_sha256' else STUDY)/name).read_bytes()).hexdigest()==digest
                  for category in ['delivered_sha256','layout_sha256','source_sha256']
                  for name,digest in sourcehashes[category].items())
    if not unchanged:failures.append('accepted study changed')
    # These comparisons are available during this review, but are not inputs
    # to painting and are skipped on a fresh checkout without archived checks.
    preserved={};prior=QA/'round2/layers';prior_info=prior/'layers.json'
    if prior_info.exists() and json.loads(prior_info.read_text()).get('input_sha256')==info.get('input_sha256'):
        nape=mask&(g['length']>=30)
        preserved['nape_texels']=int(nape.sum());preserved['nape_differing_texels']={}
        for suffix in ['base','height','rough','occlusion','regions']:
            old=np.array(Image.open(prior/f'dodo_{suffix}.png'))[sl]
            new=np.array(Image.open(OUT/f'dodo_{suffix}.png'))[sl]
            different=np.any(old!=new,axis=-1) if old.ndim==3 else old!=new
            preserved['nape_differing_texels'][suffix]=int(different[nape].sum())
        preserved['cards_byte_identical']=all((prior/f'cards_{s}.png').read_bytes()==(OUT/f'cards_{s}.png').read_bytes() for s in ['base','height','rough','occlusion','regions'])
        if any(preserved['nape_differing_texels'].values()):failures.append('round-2 nape painting changed')
        if not preserved['cards_byte_identical']:failures.append('accepted card pictures changed')
    round5_preserved={};prior=QA/'before_round5/layers'
    if info.get('revision',5)<=5 and (prior/'layers.json').exists():
        earlier=json.loads((prior/'layers.json').read_text())['input_sha256']
        # Preservation applies only when the baked geometry and study inputs
        # are still the same; a future rebake must regenerate their painting.
        same_inputs=all(info['input_sha256'].get(k)==v for k,v in earlier.items() if not k.startswith('tex/paint/hood/'))
        if same_inputs:
            round5_preserved['shell_byte_identical']={s:(prior/f'dodo_{s}.png').read_bytes()==(OUT/f'dodo_{s}.png').read_bytes() for s in ['base','height','rough','occlusion','regions']}
            for kind in ['mane','forehead']:
                xx0,yy0,xx1,yy1=info['card_rectangles'][kind]['box_px'];rect=np.s_[yy0:yy1,xx0:xx1]
                round5_preserved[kind+'_identical']={s:bool(np.array_equal(np.array(Image.open(prior/f'cards_{s}.png'))[rect],np.array(Image.open(OUT/f'cards_{s}.png'))[rect])) for s in ['base','height','rough','occlusion','regions']}
            if not all(all(v.values()) for v in round5_preserved.values()):failures.append('round-5 edge edit changed accepted shell, mane or forehead')
    round7_preserved={};prior=QA/'before_round7/layers'
    if info.get('revision')==7 and (prior/'layers.json').exists():
        earlier=json.loads((prior/'layers.json').read_text())
        stable=[k for k in info['input_sha256'] if k.startswith('ref/bakes/') or k.startswith('tex/paint/position') or k in ['tex/paint/pieces.json','tex/paint/pieces.png','tex/paint/texel_mm.png']]
        if all(earlier['input_sha256'].get(k)==info['input_sha256'][k] for k in stable):
            red=own&np.all(rg==[255,0,0],axis=-1)
            for suffix in ['base','height','rough','occlusion','regions']:
                old=np.array(Image.open(prior/f'dodo_{suffix}.png')).astype(int)
                new=np.array(Image.open(OUT/f'dodo_{suffix}.png')).astype(int)
                delta=np.abs(new[red]-old[red])
                round7_preserved['body_'+suffix+'_max_byte_change']=int(delta.max())
                if delta.max()>(1 if suffix=='base' else 0):failures.append('round-7 body '+suffix+' changed')
            round7_preserved['regions_byte_identical']=(prior/'dodo_regions.png').read_bytes()==(OUT/'dodo_regions.png').read_bytes()
            round7_preserved['card_rectangles_identical']=earlier['card_rectangles']==info['card_rectangles']
            if not round7_preserved['regions_byte_identical'] or not round7_preserved['card_rectangles_identical']:
                failures.append('round-7 changed wedge or card layout')
    varied=[p for p in placements if 'cap_variation' in p and p['cap_variation']['nominal_length_mm']<=20]
    cap_variation={}
    if varied:
        cap_variation={
            'count':len(varied),
            'length_over_nominal_percentiles':np.percentile([p['length_mm']/p['cap_variation']['nominal_length_mm'] for p in varied],[0,10,50,90,100]).tolist(),
            'along_over_length_percentiles':np.percentile([p['cap_variation']['along_mm']/p['length_mm'] for p in varied],[0,10,50,90,100]).tolist(),
            'across_over_width_percentiles':np.percentile([p['cap_variation']['across_mm']/p['width_mm'] for p in varied],[0,10,50,90,100]).tolist()}
    crown=own.copy();crown[:]=False;crown[sl]=mask&(g['pos'][...,1]>615)
    slopes=np.sqrt(n[...,0]**2+n[...,1]**2)/np.maximum(n[...,2],1e-8)
    oldrms=None;oldpath=QA/'round1/layers/dodo_height.png'
    if oldpath.exists():
        oldh=np.array(Image.open(oldpath))/65535*info['height_mm']
        oldn=normals(oldh,mm,own);oldslopes=np.sqrt(oldn[...,0]**2+oldn[...,1]**2)/np.maximum(oldn[...,2],1e-8)
        oldrms=float(np.sqrt(np.mean(oldslopes[crown]**2)))
    ymax=np.array(Image.open(PAINT/'position_y.png'))
    if np.any(ymax[own]==65535):failures.append('hood positions clipped at Y encoding ceiling')
    result=dict(shell_texels=int(own.sum()),shell_mean_linear=mean,regional_means=regional_means,max_base_light_correlation=max(lightcorr),
        shell_height_mm=[float(h[own].min()),float(h[own].max())],roughness_byte_range=[int(rough[own].min()),int(rough[own].max())],
        crown_normal_slope_rms=float(np.sqrt(np.mean(slopes[crown]**2))),
        round1_crown_normal_slope_rms=oldrms,
        clipped_hood_y_texels=int(np.count_nonzero(ymax[own]==65535)),
        flow_jitter_degrees_percentiles=np.percentile([abs(p['flow_jitter_degrees']) for p in placements],[0,50,90,100]).tolist(),
        composed_normal_max_byte_error=normal_error,
        card_mean_linear=cardmean,cards=cardstats,mane_feather_dimensions=mane_dimensions,accepted_study_unchanged=unchanged,
        neck_join=neck_join(g,crop,h[sl],rg[sl]),
        preserved_from_round2=preserved,round5_preserved=round5_preserved,round7_preserved=round7_preserved,cap_variation=cap_variation,
        feather_length_by_zone={k:{'count':len(v),'percentiles_mm':np.percentile(v,[0,10,50,90,100]).tolist()} for k,v in zone_lengths.items() if v},failures=failures)
    return result


def scene_points():
    piece=np.array(Image.open(PAINT/'pieces.png'))[...,0];mask=piece>0
    meta=json.loads((PAINT/'pieces.json').read_text());lo=np.array(meta['position_box']['min']);hi=np.array(meta['position_box']['max'])
    P=np.stack([np.array(Image.open(PAINT/f'position_{c}.png')).astype(np.float32)/65535 for c in 'xyz'],-1);P=P*(hi-lo)+lo
    O=np.array(Image.open(BAKES/'dodo_normal_object.png')).astype(np.float32)/127.5-1;O/=np.maximum(np.linalg.norm(O,axis=-1,keepdims=True),1e-6)
    # CORRECTION_1: both maps now describe the +x (left) half. No reflection.
    js=[]
    for axis in [1,0]:
        p=np.roll(P,-1,axis);q=np.roll(P,1,axis);vp=np.roll(piece,-1,axis)==piece;vq=np.roll(piece,1,axis)==piece
        j=np.where((vp&vq)[...,None],(p-q)*.5,np.where(vp[...,None],p-P,P-q));js.append(j)
    T=js[0]-O*np.sum(O*js[0],-1,keepdims=True);T/=np.maximum(np.linalg.norm(T,axis=-1,keepdims=True),1e-9)
    B=np.cross(O,T);B*=np.sign(np.sum(B*js[1],-1,keepdims=True))
    folder=QA/'composed';tex=np.array(Image.open(folder/'dodo_normal.png')).astype(np.float32)/127.5-1
    W=T*tex[...,0,None]-B*tex[...,1,None]+O*tex[...,2,None];W/=np.maximum(np.linalg.norm(W,axis=-1,keepdims=True),1e-9)
    base=lin(np.array(Image.open(folder/'dodo_base.png')).astype(np.float32)/255)
    regions=np.array(Image.open(folder/'dodo_regions.png'));idx=np.full(mask.shape,-1)
    for i,c in enumerate(REGIONS):idx[(regions==c).all(-1)]=i
    oc=np.array(Image.open(folder/'dodo_packed.png'))[...,0]/255
    return dict(P=P[mask],W=W[mask],O=O[mask],base=base[mask],region=idx[mask],oc=oc[mask],piece=piece[mask])


def project(scene,view,density,bounds,hood_dye='#312D2A',unlit=False):
    r,up,dep={'side':([0,0,-1],[0,1,0],[1,0,0]),'front':([-1,0,0],[0,1,0],[0,0,1]),'back':([1,0,0],[0,1,0],[0,0,-1])}[view]
    right,up,dep=np.array(r),np.array(up),np.array(dep)
    r0,y0,r1,y1=bounds;width=round((r1-r0)*density);height=round((y1-y0)*density)
    image=np.empty((height,width,3),np.uint8);image[:]=[213,211,204]
    zb=np.full(height*width,-np.inf);rgbout=image.reshape(-1,3)
    light=np.array([.55,.65,.52]);light/=np.linalg.norm(light)
    all_pix=[];all_depth=[];all_rgb=[]
    for mirror in ([False] if view=='side' else [False,True]):
        P=scene['P'].copy();O=scene['O'].copy();W=scene['W'].copy()
        if mirror:P[:,0]*=-1;O[:,0]*=-1;W[:,0]*=-1
        u=(np.sum(P*right,-1)-r0)*density;v=(y1-np.sum(P*up,-1))*density;depth=np.sum(P*dep,-1)
        keep=(u>=0)&(u<width-1)&(v>=0)&(v<height-1)&(np.sum(O*dep,-1)>-.05)
        u=u[keep].astype(int);v=v[keep].astype(int);z=depth[keep]
        base=scene['base'][keep].copy();idx=scene['region'][keep]
        for i,c in enumerate(PALETTE):base[idx==i]*=colour(hood_dye if i==4 else c)/.5
        if not unlit:base*=((.43+.7*np.maximum(np.sum(W[keep]*light,-1),0))*scene['oc'][keep])[:,None]
        col=rgb(base)
        for dx,dy in [(0,0),(1,0),(0,1),(1,1)]:
            all_pix.append((v+dy)*width+u+dx);all_depth.append(z);all_rgb.append(col)
    pix=np.concatenate(all_pix);depth=np.concatenate(all_depth);col=np.concatenate(all_rgb)
    order=np.lexsort((depth,pix));pix=pix[order];col=col[order]
    keep=np.r_[pix[1:]!=pix[:-1],True];rgbout[pix[keep]]=col[keep]
    return Image.fromarray(image)


def views():
    scene=scene_points();panels=[]
    for view in ['side','front','back']:
        bounds=(-.36,-.005,.245,.67) if view=='side' else (-.18,-.005,.18,.67)
        im=project(scene,view,1000,bounds);panels.append(caption(im,view+' / palette / position-map projection'))
    width=sum(p.width for p in panels);height=max(p.height for p in panels);out=Image.new('RGB',(width,height),(27,30,33));x=0
    for p in panels:out.paste(p,(x,0));x+=p.width
    out.save(QA/'bird_front_side_back.jpg',quality=97)
    panels=[]
    for dye_name,dye in [('concept umber','#3B302A'),('near-white','#F3F1EA')]:
        row=[]
        for view in ['side','front','back']:
            bounds=(-.225,.445,-.035,.66) if view=='side' else (-.075,.445,.075,.66)
            im=project(scene,view,3500,bounds,dye);row.append(caption(im,view+' / '+dye_name+' / 3500 px/m'))
        panels.append(row)
    width=sum(p.width for p in panels[0]);row_h=max(p.height for p in panels[0]);out=Image.new('RGB',(width,row_h*2),(27,30,33))
    for j,row in enumerate(panels):
        x=0
        for p in row:out.paste(p,(x,j*row_h));x+=p.width
    out.save(QA/'hood_front_side_back.jpg',quality=98)
    # Same physical density as the 4500 px/m concept, with the new model's own shape.
    a=project(scene,'side',4500,(-.225,.445,-.035,.66),'#3B302A')
    ref=Image.open(DODO/'ref/concept/head_side.png').convert('RGB').crop((680,120,1535,1085))
    b=project(scene,'side',4500,(-.225,.445,-.035,.66),'#F3F1EA')
    out=Image.new('RGB',(a.width*3,a.height+62),(27,30,33))
    for i,(title,im) in enumerate([('Concept / 4500 px/m',ref),('Actual hood / concept umber / 4500 px/m',a),('Actual hood / near-white / 4500 px/m',b)]):out.paste(caption(im,title),(i*a.width,0))
    ImageDraw.Draw(out).text((10,a.height+36),'Opaque position-map preview; silhouette cards are reviewed separately at the final 512 resolution.',font=FONT,fill='white')
    out.save(QA/'concept_scale_comparison.jpg',quality=98)
    small=[]
    for size in [200,50,20]:
        im=project(scene,'side',size/.65,(-.36,0,.245,.65));small.append((size,im))
    out=Image.new('RGB',(900,360),(27,30,33));d=ImageDraw.Draw(out)
    for i,(size,im) in enumerate(small):
        x=i*300;d.text((x+10,10),str(size)+' pixels tall',font=FONT,fill='white');out.paste(im,(x+10,45))
        if size<200:out.paste(im.resize((im.width*3,im.height*3),Image.Resampling.NEAREST),(x+10,125))
    out.save(QA/'read_sizes.png')


def source_review():
    """Untouched source pixels beside the same specimen passed through placement.

    Each row has one physical scale across its three columns. These isolated
    placements expose the joined vane, shaft and relief before canopy overlap.
    """
    from scipy.ndimage import gaussian_filter
    feathers=sources();board=Image.new('RGB',(1200,1550),(27,30,33));d=ImageDraw.Draw(board)
    d.text((12,12),'Round 7 original / placed base / placed relief: same feather, size and direction per row',font=FONT,fill='white')
    yy=48
    for sid,L,W,density,title in [(0,10,5.2,30,'crown / 10 mm'),(6,18,9.5,20,'rear cap / 18 mm'),(12,42,23,10,'mane / 42 x 23 mm')]:
        f=feathers[sid];size=(round(W*density),round(L*density))
        original=Image.open((ROOT if f.get('source_scope')=='paint/hood' else STUDY)/'source'/f['original']).convert('RGBA').crop(f['source_box_px']).resize(size,Image.Resampling.LANCZOS)
        out=canvas((size[1],size[0]));vertices=flat_vertices(np.array([W/2,L/2]),L,W,0,np.array([density,density]))
        relief=.55 if sid<12 else .85
        stamp(out,softened_cap(f) if sid<12 else f,vertices,relief,lift=(1.15 if sid<12 else .6)-.4*relief)
        alpha,h,p,rough,shaft=out;b=np.dstack([rgb(np.repeat((.5+p*(.60 if sid<12 else .78))[...,None],3,-1)),np.uint8(np.clip(alpha,0,1)*255)])
        h=gaussian_filter(h,.28*density);n=normals(h,np.full(h.shape,1/density),alpha>.02)
        relit=tilelit(b,n,np.ones_like(h),'#BDBDBD')
        for col,(label,im,mask) in enumerate([('original',original,original.getchannel('A')),('placed base',Image.fromarray(b[...,:3]),Image.fromarray(b[...,3])),('placed relief',relit,Image.fromarray(b[...,3]))]):
            d.text((col*400+12,yy),title+' / '+label,font=FONT,fill='white')
            bg=Image.new('RGB',size,(145,145,141));bg.paste(im,(0,0),mask);board.paste(bg,(col*400+24,yy+28))
        yy+=size[1]+70
    board.crop((0,0,1200,min(yy,1550))).save(QA/'source_preservation.jpg',quality=98)


def game_boards():
    """Arrange existing game renders; never builds or changes the bird's mesh."""
    current=QA/'game_round2';old=QA/'game_round1';diagnostic=QA/'game_diagnostic_no_cards'
    if not (current/'inputs.json').exists() or not old.exists():return
    recorded=json.loads((current/'inputs.json').read_text()).get('texture_sha256',{})
    if not recorded or any(hashlib.sha256((QA/'composed'/n).read_bytes()).hexdigest()!=h for n,h in recorded.items()):return
    board=Image.new('RGB',(1800,1454),(27,30,33));d=ImageDraw.Draw(board)
    d.text((12,12),'Game renderer / same built geometry / first round and revised hood',font=FONT,fill='white')
    for row,shot in enumerate(['head_side_default','head_back_default']):
        for col,(folder,label) in enumerate([(old,'Round 1'),(current,'Round 2')]):
            im=Image.open(folder/(shot+'.png')).convert('RGB').resize((900,675),Image.Resampling.LANCZOS)
            board.paste(caption(im,label+' / '+shot.replace('_default','').replace('_',' ')),(col*900,40+row*707))
    board.save(QA/'round2_game_comparison.jpg',quality=97)
    if (diagnostic/'head_back_default.png').exists():
        board=Image.new('RGB',(1800,762),(27,30,33));d=ImageDraw.Draw(board)
        d.text((12,12),'Attachment diagnostic / identical shell painting / cards hidden only in the left preview',font=FONT,fill='white')
        for col,(folder,label) in enumerate([(diagnostic,'Hood cards hidden: no seam across the crown'),(current,'Cards visible: root edge and uncovered lower shell')]):
            im=Image.open(folder/'head_back_default.png').convert('RGB').resize((900,675),Image.Resampling.LANCZOS)
            board.paste(caption(im,label),(col*900,40))
        board.save(QA/'attachment_diagnostic.jpg',quality=97)


def cap_game_boards():
    """Compare both cap paintings on exactly the same frozen review pack."""
    old=QA/'game_cap_baseline_r2';new=QA/'game_cap_round3'
    if not all((p/'inputs.json').exists() for p in [old,new]):return
    before=json.loads((old/'inputs.json').read_text());after=json.loads((new/'inputs.json').read_text())
    if before['pack_sha256']!=after['pack_sha256']:raise ValueError('cap comparison uses different meshes')
    if any(hashlib.sha256((QA/'composed'/n).read_bytes()).hexdigest()!=h for n,h in after['texture_sha256'].items()):return
    crops=[('side / umber','head_side_default',(620,120,1180,430)),
           ('back / umber','head_back_default',(320,80,880,390)),
           ('side / near-white','head_side_white',(620,120,1180,430))]
    board=Image.new('RGB',(1120,1090),(27,30,33));d=ImageDraw.Draw(board)
    d.text((12,12),'Cap revision / same game renderer, camera, geometry and dye / native pixels',font=FONT,fill='white')
    for row,(label,file,box) in enumerate(crops):
        for col,(folder,title) in enumerate([(old,'Round 2'),(new,'Round 3')]):
            im=Image.open(folder/(file+'.png')).convert('RGB').crop(box)
            board.paste(caption(im,title+' / '+label),(col*560,48+row*342))
    board.save(QA/'round3_cap_comparison.jpg',quality=98)


def main():
    inputs=input_hashes()
    if json.loads((OUT/'layers.json').read_text()).get('input_sha256')!=inputs:
        raise SystemExit('Paint inputs have changed: run paint.py before checking.')
    result=subprocess.run([sys.executable,'-I',str(PAINT/'compose.py'),'--out',str(QA/'composed')],text=True,capture_output=True,check=True)
    (QA/'compose_report.txt').write_text(result.stdout);print(result.stdout,flush=True)
    metrics=maps_and_cards();print(json.dumps(metrics,indent=2),flush=True)
    views();source_review();game_boards();cap_game_boards()
    if inputs!=input_hashes():metrics['failures'].append('inputs changed during checking')
    metrics['passed']=not metrics['failures']
    (QA/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
    if metrics['failures']:raise SystemExit(1)

if __name__=='__main__':main()

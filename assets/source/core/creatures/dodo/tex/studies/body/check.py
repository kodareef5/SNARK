"""Independent delivered-PNG checks and non-deliverable review pictures.
Run after build.py. Outputs checks/results.json and REPORT-ready measurements.
"""
import sys
sys.dont_write_bytecode = True
from pathlib import Path
import json, time, hashlib
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import map_coordinates, gaussian_filter, distance_transform_edt
from build import srgb_to_linear,linear_to_srgb,ROOT

QA=ROOT/'checks'
QA.mkdir(exist_ok=True)
PALETTE={(0,0,0),(255,0,0),(0,255,0),(0,0,255),(0,255,255),(255,0,255),(255,255,0)}
DYES={'slate':('#777A81','#DDDBC1'),'hot pink':('#F52B9B','#DDDBC1'),'near black':('#17191E','#DDDBC1'),'near white':('#E8E9EA','#DDDBC1')}
LIGHTS=[(-.55,.45,.70),(.6,.2,.77),(.1,-.65,.75)]

def rgb(hexstr): return np.array([int(hexstr[i:i+2],16) for i in [1,3,5]],np.float32)/255

def im(a):return Image.fromarray(np.uint8(np.clip(np.round(a*255),0,255)))

def grid(items,cols,cell=420):
    out=Image.new('RGB',(cols*cell,((len(items)+cols-1)//cols)*(cell+30)),(28,30,34))
    d=ImageDraw.Draw(out)
    for i,(title,pic) in enumerate(items):
        x=i%cols*cell; y=i//cols*(cell+30)
        out.paste(pic.resize((cell,cell),Image.Resampling.LANCZOS),(x,y+30))
        d.text((x+8,y+8),title,fill=(234,235,237))
    return out

def shade(data,dye='slate',light=LIGHTS[0],bar=True,linear=False):
    a,h,n,p,r=data
    color=np.broadcast_to(srgb_to_linear(rgb(DYES[dye][0])),a[:,:,:3].shape).copy()
    if bar:
        # Red and yellow are neighbours on the game's region-colour ring.
        # Filter their dye weights, never threshold a minified region sample.
        mix=np.clip(r[:,:,1:2].astype(np.float32)/255,0,1)
        color=color*(1-mix)+srgb_to_linear(rgb(DYES[dye][1]))*mix
    light=np.array(light,dtype=np.float32);light/=np.linalg.norm(light)
    n=n/np.maximum(np.linalg.norm(n,axis=-1,keepdims=True),1e-6)
    f=(.30+.80*np.maximum(np.sum(n*light,axis=-1),0))*p[:,:,0]
    c=srgb_to_linear(a[:,:,:3])/ .5*color*f[:,:,None]
    if not linear:c=linear_to_srgb(c)
    if a.shape[2]==4:
        bg=np.full_like(c,.17); valid=a[:,:,3]>=.5
        c=np.where(valid[:,:,None],c,bg)
    return np.clip(c,0,1)

def concept_sample(data,size,offset=350,chevron=True,samples=4):
    """Four samples per axis, then integrate in linear light at 1500 px/m."""
    yy,xx=np.mgrid[:size*samples,:size*samples].astype(np.float32)
    yy=(yy+.5)/samples-.5;xx=(xx+.5)/samples-.5
    ratio=2048/(.427*1500)
    tx=(xx-size/2)*ratio+1024
    ty=(yy+(abs(xx-size/2)*.40 if chevron else 0))*ratio+offset
    coords=np.stack((ty,tx))
    a,h,n,p,r=data
    def sample(ar):
        return np.stack([map_coordinates(ar[:,:,k].astype(np.float32),coords,order=1,mode='grid-wrap') for k in range(ar.shape[-1])],-1)
    result=(sample(a),h,sample(n),sample(p),sample(r))
    def integrate(linear):
        return im(linear_to_srgb(linear.reshape(size,samples,size,samples,3).mean(axis=(1,3))))
    lit=integrate(shade(result,linear=True))
    mix=result[4][:,:,1:2]/255
    color=srgb_to_linear(rgb(DYES['slate'][0]))*(1-mix)+srgb_to_linear(rgb(DYES['slate'][1]))*mix
    unlit=integrate(srgb_to_linear(result[0][:,:,:3])/.5*color)
    return unlit,lit

def material_mip(data,factor=4):
    """Area-filter maps, with albedo RGB averaged in linear light."""
    def average(x):
        h,w=x.shape[:2];tail=x.shape[2:]
        return x.reshape(h//factor,factor,w//factor,factor,*tail).mean(axis=(1,3))
    a,h,n,p,r=data
    aa=linear_to_srgb(average(srgb_to_linear(a[:,:,:3])))
    if a.shape[2]==4:aa=np.dstack((aa,average(a[:,:,3])))
    return aa,average(h),average(n),average(p),average(r.astype(np.float32))

def base_view(a):
    if a.shape[2]==3:return im(a)
    yy,xx=np.indices(a.shape[:2]);bg=np.where(((xx//32+yy//32)%2)==0,.2,.28)
    c=a[:,:,:3]*a[:,:,3:4]+bg[:,:,None]*(1-a[:,:,3:4])
    return im(c)

def surface_review(data):
    """An analytic curved egg, at true metre density. Review only, no UV claim."""
    size=640; yy,xx=np.mgrid[:size,:size].astype(np.float32)
    x=(xx-size/2)/(size*.43); y=(yy-size*.53)/(size*.45)
    inside=x*x+y*y<1
    z=np.sqrt(np.clip(1-x*x-y*y,0,1))
    u=np.arcsin(np.clip(x,-1,1))*.15 # .30 m-wide body
    v=np.arcsin(np.clip(y,-1,1))*.15
    tx=(u/.427*2048+1024)%2048; ty=(v/.427*2048+1024)%2048
    coords=np.stack((ty,tx))
    a,h,n,p,r=data
    def sample(ar):return np.stack([map_coordinates(ar[:,:,j],coords,order=1,mode='grid-wrap') for j in range(ar.shape[-1])],-1)
    aa=sample(a); pp=sample(p); nn=sample(n)
    rr=np.stack([map_coordinates(r[:,:,j],coords,order=0,mode='grid-wrap') for j in range(3)],-1)
    # Construct tangent basis and rotate tangent-space relief onto the body.
    normal=np.stack((x,-y,z),-1)
    txbasis=np.stack((z,np.zeros_like(z),-x),-1); txbasis/=np.maximum(np.linalg.norm(txbasis,axis=-1,keepdims=True),1e-5)
    tybasis=np.cross(normal,txbasis)
    world=txbasis*nn[:,:,0:1]+tybasis*nn[:,:,1:2]+normal*nn[:,:,2:3]
    out=[]
    for dye in DYES:
        c=shade((aa,h,world,pp,rr),dye)
        c[~inside]=[.16,.17,.19]
        out.append((dye+' / curved .30 m breast',im(c)))
    grid(out,4,400).save(QA/'curved_surface.png')

def bird_context(plain,barred):
    """Concept-silhouette projection, not a finished bird UV texture.
    The delivered material replaces only the concept body region. Other parts
    remain the design reference. Five rows are selected and bent into chevrons.
    """
    dodo=ROOT.parents[2]
    results=[]
    study=json.loads((ROOT/'study.json').read_text())
    ownership=np.load(ROOT/'source/tile_ownership.npz')['owner']
    layout=json.loads((ROOT/'source/layout.json').read_text())
    for view in ['front','back']:
        ref=np.asarray(Image.open(dodo/'ref/concept'/f'{view}.png').convert('RGB'),np.float32)/255
        regions=np.asarray(Image.open(dodo/'ref/regions'/f'{view}.png').convert('RGB'))
        H,W=regions.shape[:2]; yy,xx=np.mgrid[:H,:W].astype(np.float32)
        body=(regions[:,:,0]==255)&(regions[:,:,1]==0)&(regions[:,:,2]==0)
        # Back row markings are part of the material, replace old markings here too.
        if view=='back':body|=(regions[:,:,0]==255)&(regions[:,:,1]==255)&(yy>610)&(yy<980)&(abs(xx-W/2)<172)
        if view=='back':
            tail=Image.new('L',(W,H));ImageDraw.Draw(tail).polygon([(628,466),(590,480),(565,513),(541,544),(533,580),(539,616),(579,654),(628,686),(677,654),(716,616),(723,580),(715,544),(689,513),(664,480)],fill=255)
            body&=np.asarray(tail)==0
        # Work at 1500 px/m concept scale, reducing feather size for the neck.
        local_scale=1+.38*np.clip((620-yy)/220,0,1)
        ux=(xx-W/2)*2048/(.427*1500)*local_scale+1024
        vy=(yy-610)*2048/(.427*1500)*local_scale+690
        if view=='back':vy+=abs(xx-W/2)*.26*2048/(.427*1500)
        coords=np.stack((vy%2048,ux%2048))
        a,h,n,p,r=barred if view=='back' else plain
        def sample(ar,order=1):return np.stack([map_coordinates(ar[:,:,j],coords,order=order,mode='grid-wrap') for j in range(ar.shape[-1])],-1)
        aa=sample(a);nn=sample(n);pp=sample(p)
        rr=np.zeros((H,W,3),np.uint8);rr[:,:,0]=255
        if view=='back':
            br=sample(barred[4].astype(np.float32),1)
            # Five selected layout rows; mild chevron flow, fade down flanks.
            pitch=2048/study['sets']['body_barred']['rows']
            ids=map_coordinates(ownership.astype(np.float32),coords,order=0,mode='grid-wrap').astype(int)
            first=int(ownership[768,1024])//layout['cols']
            selected=[(first+i)%layout['rows'] for i in range(5)]
            active=np.isin(ids//layout['cols'],selected)&(yy>610)&(yy<980)&(abs(xx-W/2)<160)
            rr[:,:,1]=np.where(active,br[:,:,1],0)
        reads=[]
        for dye in ['slate','hot pink','near black']:
            c=shade((aa,h,nn,pp,rr),dye)
            # Low-frequency shape belongs only to this lighting preview.
            dist=distance_transform_edt(body)
            form=.68+.32*np.clip(dist/85,0,1)
            c*=form[:,:,None]
            out=ref.copy();out[body]=c[body]
            pic=im(out)
            results.append((view+' / '+dye+' / concept projection',pic))
            pic.save(QA/f'bird_{view}_{dye.replace(" ","_")}.png')
            reads.append((dye,pic))
        # Actual bird height is ~975 pixels; show all reviewed dyes at 200/50.
        strip=Image.new('RGB',(990,340),(38,40,44));draw=ImageDraw.Draw(strip)
        for j,(dye,pic) in enumerate(reads):
            x=15+j*330
            for height in [200,50]:
                sz=round(H*height/975)
                q=pic.resize((sz,sz),Image.Resampling.LANCZOS)
                y=20 if height==200 else 275
                strip.paste(q,(x,y));draw.text((x+sz+2,y+12),f'{height}px',fill='white')
            draw.text((x,4),dye,fill='white')
        strip.save(QA/f'bird_{view}_read_sizes.png')
    grid(results,3,420).save(QA/'bird_context.png')

def revision_review(delivered):
    """All comparisons use 1500 pixels/metre, the concept's stated density.
    V flow is a coordinate placement, with no scale fitting to the picture.
    """
    dodo=ROOT.parents[2]; size=315
    panels=[]
    for name,view,box,chevron in [
        ('body_barred','top',(470,585,785,900),True),
        ('body_plain','front',(470,665,785,980),False)]:
        ref=Image.open(dodo/'ref/concept'/f'{view}.png').convert('RGB').crop(box)
        unlit,lit=concept_sample(delivered[name],size,chevron=chevron)
        panels.extend([(f'Concept {view}: 1500 px/m',ref),
                       (f'{name}: slate / cream, unlit',unlit),
                       (f'{name}: same scale, relit',lit)])
    # Integer enlargement only; same physical field, no arbitrary crop scaling.
    grid(panels,3,315).save(QA/'concept_scale_1x.png')
    grid(panels,3,630).save(QA/'concept_scale_comparison.png')
    # Render original and final delivered card at identical physical placement.
    # No source-only stand-in for the delivered base in this comparison.
    records=json.loads((ROOT/'source/elements.json').read_text());panels=[]
    metadata=json.loads((ROOT/'study.json').read_text())['sets']['body_tips']
    a,h,n,p,r=delivered['body_tips']
    for i in [1,5,10,14]:
        card=metadata['elements'][i];e=card.get('source_record',records[i])
        original=Image.open(ROOT/'source'/e['files'].get('physical_original',e['files']['original'])).convert('RGBA')
        bx=e['box_px'];sw,sh=original.size
        w=round(e['width_mm']*.001/(bx[2]-bx[0])*sw*2048/metadata['span_m'])
        ht=round(e['length_mm']*.001/(bx[3]-bx[1])*sh*2048/metadata['span_m'])
        original=original.resize((w,ht),Image.Resampling.LANCZOS)
        raw=Image.new('RGBA',(512,512));raw.paste(original,((512-w)//2,(512-ht)//2))
        x0,y0,x1,y1=card['cell_box'];sl=np.s_[y0:y1,x0:x1]
        data=(a[sl],h[sl],n[sl],p[sl],r[sl])
        panels.extend([(e['id']+' / source at physical profile',base_view(np.asarray(raw,np.float32)/255)),
                       (e['id']+' / final card base',base_view(a[sl])),
                       (e['id']+' / final card, relit',im(shade(data)))])
    grid(panels,3,512).save(QA/'original_base_relit.png')

def round3_bar_review(delivered):
    """Match the supplied enlarged crop to its actual 1500 px/m source extent."""
    reference=Image.open(ROOT/'source/concept_bars_review.png').convert('RGB')
    refs=json.loads((ROOT/'source/concept_bars_review.json').read_text())['matches']
    rows=[];native=[]
    for j,entry in enumerate(refs):
        bx=entry['source_box'];size=bx[2]-bx[0]
        _,lit=concept_sample(delivered['body_barred'],size,offset=350 if j==0 else 700)
        ref=reference.crop(entry['review_box'])
        rows.extend([(f"Supplied concept_bars: {entry['view']}",ref),
                     ('Revised slate / cream, relit: same physical scale',lit)])
        native.extend([(entry['view']+' concept, native 1500 px/m',ref.resize((size,size),Image.Resampling.LANCZOS)),
                       ('body_barred, native 1500 px/m',lit)])
    grid(rows,2,600).save(QA/'round3_bars_comparison.png')
    grid(native,2,170).save(QA/'round3_bars_concept_scale.png')
    # Inspect individual source tips with unchanged neutral vane drawing.
    panels=[];records=json.loads((ROOT/'source/barred_elements.json').read_text())
    for i in [1,4,7,10]:
        rec=records[i];z=np.load(ROOT/'source'/rec['layers'])
        pigment=z['pigment_linear'];alpha=z['alpha'];mark=z['bar_generated']
        color=np.broadcast_to(srgb_to_linear(rgb(DYES['slate'][0])),(*alpha.shape,3)).copy()
        color[mark]=srgb_to_linear(rgb(DYES['slate'][1]))
        c=linear_to_srgb(pigment[:,:,None]/.5*color)
        c[alpha<.5]=.16
        panels.extend([(rec['id']+' / tip dye',im(c)),(rec['id']+' / pure ID mask',Image.open(ROOT/'source'/rec['files']['bar_regions']))])
    grid(panels,4,315).save(QA/'round3_tip_masks.png')

def check():
    started=time.time(); numeric_only='--numeric-only' in sys.argv; meta=json.loads((ROOT/'study.json').read_text()); report={}; failed=[]; delivered={}
    def require(condition,description):
        if not condition:failed.append(description)
    for name,info in meta['sets'].items():
        files={k:Image.open(ROOT/f) for k,f in info['maps'].items()}
        ar={k:np.asarray(f) for k,f in files.items()}
        res={}; report[name]=res
        for key,f in files.items():
            require(f.size==(2048,2048),f'{name} {key} dimensions')
            require(f.mode==('I;16' if key=='height' else 'RGBA' if key=='base' and info['cutout'] else 'RGB'),f'{name} {key} format {f.mode}')
        base=ar['base'].astype(np.float32)/255; h=ar['height'].astype(np.float32)/65535
        n=ar['normal'].astype(np.float32)/127.5-1;p=ar['packed'].astype(np.float32)/255;r=ar['regions']
        delivered[name]=(base,h,n,p,r)
        valid=(base[:,:,3]>=.5) if info['cutout'] else np.ones(h.shape,bool)
        col=srgb_to_linear(base[:,:,:3]);lum=col.mean(axis=-1)
        res['region_mean_linear']={}
        for region in info['regions']:
            m=valid&(r[:,:,1]>128 if region==5 else r[:,:,1]==0)
            mean=float(lum[m].mean());res['region_mean_linear'][str(region)]=mean
            require(abs(mean-.5)<=.02,f'{name} region {region} mean')
        spread=np.ptp(ar['base'][:,:,:3].astype(int),axis=-1)
        res['max_neutral_channel_spread']=int(spread[valid].max())
        res['base_linear_std']=float(lum[valid].std())
        require(res['max_neutral_channel_spread']<=2,f'{name} neutral')
        means=[float(lum[y:y+1024,x:x+1024][valid[y:y+1024,x:x+1024]].mean()) for y in [0,1024] for x in [0,1024]]
        res['quadrant_means_linear']=means
        res['quadrant_relative_spread']=(max(means)-min(means))/np.mean(means)
        require(res['quadrant_relative_spread']<=.02,f'{name} unlit quadrants')
        # Independent physical finite differences, using delivered uint16 PNG.
        px=info['span_m']/2048
        if True: # The game's derivative check wraps every delivered map, including cards.
            dx=(np.roll(h,-1,1)-np.roll(h,1,1))*info['height_mm']*.001/(2*px)
            dy=(np.roll(h,-1,0)-np.roll(h,1,0))*info['height_mm']*.001/(2*px)
        else: dy,dx=np.gradient(h*info['height_mm']*.001,px)
        ex=np.stack((-dx,dy,np.ones_like(h)),axis=-1);ex/=np.linalg.norm(ex,axis=-1,keepdims=True)
        res['normal_correlations']=[float(np.corrcoef(ex[:,:,j][valid],n[:,:,j][valid])[0,1]) for j in [0,1]]
        require(min(res['normal_correlations'])>=.9,f'{name} normal correlation')
        res['normal_correlations_whole_image']=[float(np.corrcoef(ex[:,:,j].ravel()[::4],n[:,:,j].ravel()[::4])[0,1]) for j in [0,1]]
        require(min(res['normal_correlations_whole_image'])>=.9,f'{name} wrapping whole-image normal correlation')
        res['normal_max_unit_error']=float(np.abs(np.linalg.norm(n,axis=-1)-1).max())
        require(res['normal_max_unit_error']<.008,f'{name} unit normals')
        res['normal_export_max_byte_error']=int(np.abs(np.rint((ex*.5+.5)*255).astype(int)-ar['normal'].astype(int)).max())
        res['height_occupied_mm']=[float(h[valid].min()*info['height_mm']),float(h[valid].max()*info['height_mm'])]
        res['ao_range']=[float(p[:,:,0][valid].min()),float(p[:,:,0][valid].max())]
        res['roughness_range']=[float(p[:,:,1][valid].min()),float(p[:,:,1][valid].max())]
        require(not ar['packed'][:,:,2].any(),f'{name} metalness')
        codes,counts=np.unique((r[:,:,0].astype(np.uint32)<<16)+(r[:,:,1].astype(np.uint32)<<8)+r[:,:,2],return_counts=True)
        colors=np.stack(((codes>>16)&255,(codes>>8)&255,codes&255),axis=-1)
        require(all(tuple(v) in PALETTE for v in colors),f'{name} region palette')
        # Only red/yellow here: these are adjacent on the mandated ring.
        require(all(tuple(v) in {(255,0,0),(255,255,0)} for v in colors),f'{name} forbidden adjacency')
        res['bar_fraction_covered']=float(((r[:,:,1]>128)&valid).sum()/valid.sum())
        if name=='body_barred': require(.10<=res['bar_fraction_covered']<=.28,'Barred area within 10 to 28 percent after the requested deeper tips; appearance reviewed separately')
        res['region_colors']={str(tuple(int(x) for x in k)):int(v) for k,v in zip(colors,counts)}
        # Check a broad sweep of possible light directions, not only one lamp.
        values=lum[valid][::16].astype(float);vstd=values.std();cor=[]
        nv=n[valid][::16]
        for elev in [.25,.65,.95]:
            for az in np.arange(0,2*np.pi,np.pi/4):
                L=np.array([np.cos(az)*np.sqrt(1-elev**2),np.sin(az)*np.sqrt(1-elev**2),elev])
                lighting=np.maximum(np.sum(nv*L,axis=-1),0)
                cor.append(float(np.corrcoef(values,lighting)[0,1]))
        res['max_abs_base_lighting_correlation']=float(max(abs(v) for v in cor))
        require(res['max_abs_base_lighting_correlation']<.12,f'{name} residual directional lighting')
        if info['tiles']:
            seams={}
            for key,z in ar.items():
                z=z.astype(np.float32);pair=[]
                for axis in [1,0]:
                    edge=np.abs(np.take(z,0,axis=axis)-np.take(z,-1,axis=axis)).mean()
                    inner=np.abs(np.diff(z,axis=axis)).mean()
                    ratio=float(edge/max(inner,1e-12));pair.append(ratio)
                    require(ratio<=1.30,f'{name} {key} seam axis {axis}: {ratio:.3f}')
                seams[key]={'x':pair[0],'y':pair[1]}
            res['seam_step_vs_interior']=seams
        else:
            res['alpha_coverage']=float(valid.mean())
            quiet=distance_transform_edt(~valid)>20
            res['quiet_gutter_height_range_mm']=float(np.ptp(h[quiet])*info['height_mm'])
            res['quiet_gutter_normal_unique']=np.unique(ar['normal'][quiet],axis=0).tolist()
            res['border_height_range_mm']=float(np.ptp(np.concatenate([h[:24].ravel(),h[-24:].ravel(),h[:,:24].ravel(),h[:,-24:].ravel()]))*info['height_mm'])
            require(res['quiet_gutter_height_range_mm']<.0001,'Card gutters constant height')
            require(len(res['quiet_gutter_normal_unique'])==1,'Card gutters constant normal')
            require(res['border_height_range_mm']<.0001,'Card borders matching flat height')
            res['transparent_min_rgb']=int(ar['base'][:,:,:3][~valid].min())
            require(res['transparent_min_rgb']>100,f'{name} transparent color fringe')
            mip=[]
            for size in [512,128]:
                small=files['base'].resize((size,size),Image.Resampling.LANCZOS)
                sa=np.asarray(small); mask=sa[:,:,3]>=128
                res[f'alpha_coverage_{size}']=float(mask.mean())
                bg=np.full((size,size,3),48,np.uint8);bg[mask]=sa[:,:,:3][mask]
                mip.append((f'RGBA cutoff 0.5 / {size}px sheet',Image.fromarray(bg).resize((768,768),Image.Resampling.NEAREST)))
            grid(mip,2,768).save(QA/'cards_mip_cutoff.png')
        print(name, 'numeric checks:', 'PASS' if not failed else failed,flush=True)
        if numeric_only: continue
        # Aligned map previews and 1:1 closeups; no stretching per-layer.
        layers=[('base',base_view(base)),('height x4 mm',im(h)),('normal / OpenGL',files['normal']),
                ('AO / height horizons',im(p[:,:,0])),('roughness / dry feather',im(p[:,:,1])),('regions / pure IDs',files['regions'])]
        grid(layers,3).save(QA/(name+'_layers.png'))
        dyed=shade(delivered[name]); im(dyed).save(QA/(name+'_relit.png'))
        box=(650,650,1290,1290)
        grid([(t,pic.crop(box)) for t,pic in layers[:3]]+[('slate / relit 1:1',im(dyed).crop(box))],2,640).save(QA/(name+'_detail.png'))
        if info['tiles']:
            offset=np.roll(dyed,(1024,1024),(0,1))
            im(offset).save(QA/(name+'_half_offset.png'))
            im(np.tile(dyed,(2,2,1))).resize((1024,1024),Image.Resampling.LANCZOS).save(QA/(name+'_2x2.png'))
        items=[]
        mip_data=material_mip(delivered[name])
        for dye in DYES:
            for j,light in enumerate(LIGHTS): items.append((dye+f' / light {j+1}',im(shade(mip_data,dye,light))))
        grid(items,3,440).save(QA/(name+'_dyes_lights.png'))
        # 0.427m swatch occupies 131 and 33 pixels on a .65m bird at 200/50px.
        sheet=Image.new('RGB',(900,540),(30,32,36));draw=ImageDraw.Draw(sheet)
        for j,dye in enumerate(DYES):
            full=im(shade(delivered[name],dye))
            for k,pixels in enumerate([1024,round(info['span_m']/.65*200),round(info['span_m']/.65*50)]):
                q=full.resize((pixels,pixels),Image.Resampling.LANCZOS)
                if k==0:q=q.crop((256,256,456,456))
                x=18+j*220; y=[28,270,460][k];sheet.paste(q,(x,y))
                draw.text((x,y-17),f'{dye} / {pixels}px',fill='white')
        sheet.save(QA/(name+'_read_sizes.png'))
    # Latest review explicitly permits new barred geometry; plain remains frozen.
    accepted=ROOT/'checks/plain_rebuild'
    manifest=json.loads((ROOT/'source/plain_manifest.json').read_text())['sha256']
    immutable=[f'body_plain_{k}.png' for k in ['base','height','normal','packed','regions']]
    preserved={f:hashlib.sha256((ROOT/f).read_bytes()).hexdigest()==manifest[f] for f in immutable}
    require(all(preserved.values()),'All five accepted plain maps byte-identical')
    for k in ['base','height','normal','packed','regions']:
        old=np.asarray(Image.open(accepted/f'body_tips_{k}.png'))
        new=np.asarray(Image.open(ROOT/f'body_tips_{k}.png'))
        same=[]
        for e in meta['sets']['body_tips']['elements']:
            if e['barred']:continue
            x0,y0,x1,y1=e['cell_box']
            same.append(bool(np.array_equal(old[y0:y1,x0:x1],new[y0:y1,x0:x1])))
        preserved[f'unbarred_card_{k}_cells']=all(same)
        require(all(same),f'Unbarred card {k} unchanged')
    report['accepted_round2_preservation']=preserved
    report['periodic_neighbourhoods']=meta['build']['periodic_neighbourhoods']
    require(max(v for x in report['periodic_neighbourhoods'].values() for v in x.values())<1e-5,'periodic neighbourhoods')
    # Check the region IDs against the original drawn colours, not a tip equation.
    elements=json.loads((ROOT/'source/barred_elements.json').read_text())
    source_checks=[]
    for e in elements:
        z=np.load(ROOT/'source'/e['layers']);shape=z['alpha'].shape
        require(all(z[k].shape==shape for k in z.files),f"{e['id']} source alignment")
        edge=z['free_edge_distance_mm'];a=z['alpha']>=.5
        require((edge[a]<=5).any(),f"{e['id']} distal edge present")
        rx,ry=[int(round(q)) for q in e['root_px']]
        require(bool(a[ry,rx]),f"{e['id']} root lies on feather")
        original=np.asarray(Image.open(ROOT/'source'/e['files']['physical_original']),np.float32)
        warmth=(original[:,:,0]-original[:,:,2])+.6*(original[:,:,0]-original[:,:,1])
        yy,xx=np.indices(shape);ys,xs=np.where(a);v=(yy-ys.min())/(ys.max()-ys.min())
        expected=(warmth>7.5)&(v>.58)&a
        marked=z['bar_generated'];same=bool(np.array_equal(marked,expected))
        require(same,f"{e['id']} IDs exactly follow generated pale strands")
        centre=abs(xx-(xs.min()+xs.max())*.5)<(xs.max()-xs.min())*.10
        depth=float(np.percentile(edge[a&marked&centre],95))
        axial_depth=float((ys.max()-np.percentile(yy[a&marked&centre],5))*e['pixel_mm'][1])
        require(7.5<=axial_depth<=20,f"{e['id']} source central pale strands before row occlusion")
        source_checks.append({'id':e['id'],'size':list(shape),'bar_pixels':int((marked&a).sum()),
            'generated_colour_match':same,'whole_feather_cream_fraction':float(marked.sum()/a.sum()),
            'nearest_free_edge_distance_95th_mm':depth,
            'central_tip_to_inner_strands_95th_mm':axial_depth})
    report['sources']=source_checks
    layout=json.loads((ROOT/'source/layout.json').read_text())
    ids=np.zeros((layout['rows'],layout['cols']),int)
    for el in layout['placements']:ids[el['row'],el['column']]=el['source']
    reuse=sum(int((ids==np.roll(ids,(dy,dx),(0,1))).sum()) for dy,dx in [(0,1),(1,0),(1,1),(1,-1)])
    report['neighbour_source_reuse']=reuse
    require(reuse==0,'No immediate neighbouring source copies')
    # How much of each row has a pale strand at some height? This allows the
    # genuine little splits between barbs, while detecting separated brushes.
    owners=np.load(ROOT/'source/tile_ownership.npz')['owner']
    yellow=delivered['body_barred'][4][:,:,1]>128
    rows=[]
    for row in range(layout['rows']):
        covered=np.any(yellow&(owners//layout['cols']==row),axis=0)
        occupied=np.flatnonzero(covered)
        gap=int(np.max(np.diff(np.r_[occupied,occupied[0]+2048])-1)) if len(occupied) else 2048
        gap_mm=gap*meta['sets']['body_barred']['span_m']*1000/2048
        rows.append(dict(row=row,columns_with_pale_strands=float(covered.mean()),largest_empty_span_mm=gap_mm))
        require(covered.mean()>=.98 and gap_mm<=1.5,f'Barred row {row}: tips join within small fringe splits')
    report['barred_row_continuity']=rows
    report['card_elements']=len(meta['sets']['body_tips']['elements']);require(report['card_elements']==16,'16 atlas elements')
    if not numeric_only:
        revision_review(delivered);round3_bar_review(delivered);surface_review(delivered['body_plain']);bird_context(delivered['body_plain'],delivered['body_barred'])
    report['failed']=failed;report['passed']=not failed;report['check_seconds']=round(time.time()-started,2)
    report['map_sha256']={f:hashlib.sha256((ROOT/f).read_bytes()).hexdigest() for entry in meta['sets'].values() for f in entry['maps'].values()}
    (QA/'results.json').write_text(json.dumps(report,indent=2)+'\n')
    (QA/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k in ['passed','failed','check_seconds']},indent=2),flush=True)
    for name in meta['sets']:
        print(name,json.dumps({k:report[name][k] for k in ['region_mean_linear','normal_correlations','max_abs_base_lighting_correlation','quadrant_relative_spread']}),flush=True)
    if failed:raise SystemExit(1)

if __name__=='__main__':
    if '--review-only' in sys.argv:
        delivered={}
        for name in ['body_plain','body_barred','body_tips']:
            a=np.asarray(Image.open(ROOT/(name+'_base.png')),np.float32)/255
            h=np.asarray(Image.open(ROOT/(name+'_height.png')),np.float32)/65535
            n=np.asarray(Image.open(ROOT/(name+'_normal.png')),np.float32)/127.5-1
            p=np.asarray(Image.open(ROOT/(name+'_packed.png')),np.float32)/255
            r=np.asarray(Image.open(ROOT/(name+'_regions.png')))
            delivered[name]=(a,h,n,p,r)
            print(name,'yellow fraction',float(np.mean(r[:,:,1]>128)),flush=True)
            im(shade(delivered[name])).resize((1024,1024),Image.Resampling.LANCZOS).save(QA/(name+'_quick.png'))
        revision_review(delivered)
        round3_bar_review(delivered)
        bird_context(delivered['body_plain'],delivered['body_barred'])
    else: check()

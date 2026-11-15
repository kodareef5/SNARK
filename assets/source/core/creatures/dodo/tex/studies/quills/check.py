"""Independent numerical validation and material review pictures.
Run after build.py. Writes only checks/ in this study.
"""
from pathlib import Path
import argparse,json,time,hashlib
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import distance_transform_edt,gaussian_filter,binary_erosion,label

ROOT=Path(__file__).resolve().parent
QA=ROOT/'checks';QA.mkdir(exist_ok=True)

def decode(x):
    return np.where(x<=.04045,x/12.92,((x+.055)/1.055)**2.4)

def encode(x):
    x=np.clip(x,0,1)
    return np.where(x<=.0031308,x*12.92,1.055*x**(1/2.4)-.055)

def image(x):return Image.fromarray(np.uint8(np.clip(np.rint(x*255),0,255)))

def resize(a,size,method=Image.Resampling.BOX):
    if a.ndim==3:return np.stack([resize(a[...,c],size,method) for c in range(a.shape[-1])],-1)
    return np.asarray(Image.fromarray(a.astype(np.float32)).resize((size,size),method))

def font(n=16):
    for f in ['/System/Library/Fonts/Supplemental/Arial.ttf','/System/Library/Fonts/Helvetica.ttc']:
        if Path(f).exists():return ImageFont.truetype(f,n)
    return ImageFont.load_default()

def contact(items,cols=2,cell=(512,512)):
    w,h=cell;out=Image.new('RGB',(cols*w,((len(items)+cols-1)//cols)*(h+36)),(28,31,35));d=ImageDraw.Draw(out)
    for i,(name,im) in enumerate(items):
        im=im.copy();im.thumbnail(cell,Image.Resampling.LANCZOS)
        x=i%cols*w;y=i//cols*(h+36)
        out.paste(im,(x+(w-im.width)//2,y+36+(h-im.height)//2));d.text((x+12,y+9),name,font=font(15),fill=(235,237,242))
    return out

def corr(a,b):
    if np.std(a)<1e-10 or np.std(b)<1e-10:return 0.
    a=a-a.mean();b=b-b.mean()
    return float(np.sum(a*b)/np.sqrt(np.sum(a*a)*np.sum(b*b)))

def check(reviews=True):
    started=time.time()
    study=json.loads((ROOT/'study.json').read_text())['sets']['quills']
    files={};data={};report={'files':{},'set':{k:study[k] for k in ['span_m','height_mm','tiles','cutout','two_sided']}}
    for key in ['base','height','normal','packed','regions']:
        p=ROOT/f'quills_{key}.png';im=Image.open(p);a=np.asarray(im)
        assert im.size==(2048,2048),(key,im.size)
        if key=='height':assert a.dtype==np.uint16
        elif key=='base':assert im.mode=='RGBA' and a.dtype==np.uint8
        else:assert im.mode=='RGB' and a.dtype==np.uint8
        files[key]=im.copy();data[key]=a
        report['files'][key]={'size':list(im.size),'mode':im.mode,'dtype':str(a.dtype),'bytes':p.stat().st_size}
    base=data['base']/255;alpha=base[...,3];mask=alpha>=.5
    h=data['height'].astype(float)/65535*study['height_mm']*.001
    n=data['normal'].astype(float)/127.5-1
    packed=data['packed']/255;regions=data['regions']
    colour=decode(base[...,:3]);lum=colour[...,0]
    assert np.max(np.ptp(data['base'][...,:3],axis=-1)[mask])<=2
    assert np.all(data['packed'][...,2]==0)
    palette=set(map(tuple,np.unique(regions.reshape(-1,3),axis=0)))
    allowed={(0,0,0),(255,0,0),(255,255,0),(0,255,0),(0,255,255),(0,0,255),(255,0,255)}
    assert palette<=allowed
    assert palette=={(0,0,0),(255,0,0),(255,255,0)}
    report['palette']=[[int(c) for c in v] for v in sorted(palette)]
    report['nonadjacent_region_contacts']=0 # Only red/yellow used, ring neighbours.
    report['neutral_channel_spread_max']=int(np.ptp(data['base'][...,:3],axis=-1)[mask].max())
    report['region_means']={}
    for rid,g in [(0,0),(5,255)]:
        m=mask&(regions[...,1]==g)
        vals=lum[m];mean=float(vals.mean());assert abs(mean-.5)<.02
        assert np.std(vals)>.025, 'Intrinsic feather value drawing has gone flat'
        report['region_means'][str(rid)]={'linear':mean,'srgb':float(encode(mean)*255),'visible_pixels':int(m.sum()),'linear_value_std':float(vals.std()),'linear_percentiles_01_50_99':np.percentile(vals,[1,50,99]).tolist()}
    # Empty transparent space is excluded from all illumination statistics.
    qs=[]
    for y in [0,1024]:
        for x in [0,1024]:
            sl=np.s_[y:y+1024,x:x+1024];qs.append(float(lum[sl][mask[sl]].mean()))
    report['quadrant_linear_means']=qs
    report['quadrant_relative_range']=(max(qs)-min(qs))/np.mean(qs)
    assert report['quadrant_relative_range']<.02
    gy,gx=np.gradient(h,study['span_m']/2048)
    expected=np.stack([-gx,gy,np.ones_like(h)],-1);expected/=np.linalg.norm(expected,axis=-1,keepdims=True)
    interior=binary_erosion(mask,iterations=2)
    report['height_normal_correlation']={
        'x':corr(-gx[interior],(n[...,0]/n[...,2])[interior]),
        'y':corr(gy[interior],(n[...,1]/n[...,2])[interior])}
    assert min(report['height_normal_correlation'].values())>.9
    normerror=np.abs(np.linalg.norm(n,axis=-1)-1)
    report['normal_unit_error_max']=float(normerror.max());assert normerror.max()<.008
    dot=np.sum(n/np.linalg.norm(n,axis=-1,keepdims=True)*expected,-1)
    report['normal_angular_error_deg_max_visible']=float(np.rad2deg(np.arccos(np.clip(dot[mask],-1,1))).max())
    # Probe light directions over the upper hemisphere, per region and combined.
    lighting={}
    for name,m in [('all',mask),('body',mask&(regions[...,1]==0)),('pattern',mask&(regions[...,1]==255))]:
        # Covariance evaluates the same directional correlations without
        # repeatedly materializing full RGB sheets for each light direction.
        nn=n[m];vv=lum[m];nn=nn-nn.mean(axis=0);vv=vv-vv.mean()
        covariance=np.einsum('ij,ik->jk',nn,nn)/len(vv)
        cross=np.mean(nn*vv[:,None],axis=0);variance=np.mean(vv*vv)
        c=[]
        for z in [.15,.5,1.,2.]:
            for theta in np.arange(0,2*np.pi,np.pi/4):
                light=np.array([np.cos(theta),np.sin(theta),z]);light/=np.linalg.norm(light)
                covariance_dot=np.sum(cross*light)
                projected_variance=np.einsum('i,ij,j',light,covariance,light)
                c.append(abs(covariance_dot/np.sqrt(variance*projected_variance)))
        lighting[name]=float(max(c))
    report['base_light_correlation_max']=lighting;assert max(lighting.values())<.025
    # All transparent colour has a valid nearby source, not black premultiplication.
    dist,inds=distance_transform_edt(~mask,return_indices=True)
    gutter=(dist>0)&(dist<=24)
    near=data['base'][...,:3][tuple(inds)]
    err=np.abs(data['base'][...,:3].astype(int)-near.astype(int))
    report['rgb_padding_max_byte_error_24px']=int(err[gutter].max());assert err[gutter].max()==0
    report['height_visible_mm_range']=[float(h[mask].min()*1000),float(h[mask].max()*1000)]
    report['roughness_visible_range']=[float(packed[...,1][mask].min()),float(packed[...,1][mask].max())]
    report['ao_visible_range']=[float(packed[...,0][mask].min()),float(packed[...,0][mask].max())]
    semantics=np.load(ROOT/'source/atlas_semantics.npz')
    report['visible_region_alignment_exact']=bool(np.array_equal(regions[...,1][mask]==255,semantics['visible_region'][mask]==5))
    assert report['visible_region_alignment_exact']
    assert np.array_equal(semantics['owner']>0,mask)
    report['elements']=[]
    for i,e in enumerate(study['elements']):
        own=semantics['owner']==i+1;ys,xs=np.where(own)
        box=[int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)]
        assert box==e['box_px']
        record={'id':e['id'],'box_px':box,'silhouette_length_mm':(ys.max()-ys.min()+1)*study['span_m']/2048*1000,
                'silhouette_width_mm':(xs.max()-xs.min()+1)*study['span_m']/2048*1000}
        # Follow the interpolated anatomical shaft from root toward the tip.
        p=ROOT/e['source'];a0=np.array(Image.open(p/'alpha.png'))/255; bands=np.array(Image.open(p/'bands.png'))>0
        shaft=np.array(Image.open(p/'shaft.png'))/255
        center=np.argmax(shaft,axis=1);line=bands[np.arange(1024),center]
        transitions=np.flatnonzero(np.diff(np.pad(line.astype(int),(1,1))))
        widths=(transitions[1::2]-transitions[::2])*e['master_span_m']/1024*1000
        record['shaft_band_count']=int(len(widths));record['shaft_band_widths_mm']=widths.tolist()
        assert len(widths)==(2 if e['kind']=='tail' else 0)
        if e['kind']=='tail':assert all(3.7<w<5.2 for w in widths)
        if e['symmetric']:
            record['master_alpha_mirror_max_error']=float(np.abs(a0-a0[:,::-1]).max());assert record['master_alpha_mirror_max_error']==0
        for name in ['cutout','alpha','height','shaft','bands','regions','normal','packed','approved_alpha','barbs','fringe','splits']:
            assert Image.open(p/f'{name}.png').size==(1024,1024)
        report['elements'].append(record)
    # Readable stripes after real base/normal 512 and region 256 filtering.
    reduction=[]
    for size in [512,128,105,26]:
        aa=resize(alpha,size);mm=aa>=.5
        # Compare distal outline against a smoothed silhouette at this scale.
        ref=resize(gaussian_filter(mask.astype(float),5),size)>=.5
        delta=int(np.sum(mm!=ref));reduction.append({'sheet_px':size,'visible_pixels':int(mm.sum()),'fringe_pixels_different_from_smoothed_outline':delta})
    report['reduction']=reduction
    _,components=label(mask)
    assert components==8, 'Disconnected cutout fragment at alpha 0.5'
    report['connected_cutout_elements']=int(components)
    for name,digest in study['source_sha256'].items():
        assert hashlib.sha256((ROOT/'source'/name).read_bytes()).hexdigest()==digest
    report['source_hashes_match']=True
    if reviews:render_reviews(study,base,n,packed,regions)
    report['check_seconds']=round(time.time()-started,2)
    (QA/'checks.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

def render_reviews(study,base,n,packed,regions):
    alpha=base[...,3];lin=decode(base[...,:3]);blend=regions[...,1]/255
    palettes={'Default slate / cream':('#777A81','#DDDBC1'),
              'Hot pink / lime':('#F428A8','#B8F62C'),
              'Near black / white':('#111319','#F2F3EF'),
              'Near white / charcoal':('#EDEEE9','#24262A')}
    def rgbhex(h):return np.array([int(h[i:i+2],16) for i in [1,3,5]])/255
    def render(palette,size=2048,light=None,threshold=False):
        # Average colour regions to half the base resolution, as on the bird.
        r=blend if size==2048 else resize(resize(blend,size//2),size,Image.Resampling.BILINEAR)
        aa=alpha if size==2048 else resize(alpha,size)
        al=lin if size==2048 else resize(lin,size)
        c0,c1=map(lambda h:decode(rgbhex(h)),palette)
        shaded=al/.5*(c0[None,None,:]*(1-r[...,None])+c1[None,None,:]*r[...,None])
        if light is not None:
            nn=n if size==2048 else resize(n,size); nn=nn/np.linalg.norm(nn,axis=-1,keepdims=True)
            ll=np.array(light);ll=ll/np.linalg.norm(ll)
            ao=packed[...,0] if size==2048 else resize(packed[...,0],size)
            factor=(.26+.85*np.maximum(np.sum(nn*ll,-1),0))*ao
            shaded*=factor[...,None]
        a=(aa>=.5).astype(float) if threshold else aa
        yy,xx=np.indices(a.shape);bg=np.where(((xx//32+yy//32)%2)[...,None],.105,.125)
        result=encode(shaded)*a[...,None]+bg*(1-a[...,None])
        return image(result)
    default=render(palettes['Default slate / cream']);default.save(QA/'default_full.png')
    items=[]
    for label,palette in palettes.items():
        im=render(palette,512,threshold=True);items.append((label+' | 512 cut at 0.5',im))
        im.save(QA/(label.split(' / ')[0].lower().replace(' ','_')+'_512.png'))
    contact(items,2).save(QA/'dye_checks.png')
    relight=[]
    for title,light in [('Light upper left',[-.75,.45,.5]),('Light upper right',[.75,.45,.5]),('Light below',[0,-.85,.5])]:
        im=render(palettes['Default slate / cream'],2048,light)
        # Review tail and wing at delivered texel resolution, without blank sheet.
        im.save(QA/(title.lower().replace(' ','_')+'.png'))
        relight.append((title,im))
    contact(relight,3).save(QA/'relighting.png')
    layer_items=[]
    for name in ['base','height','normal','packed','regions']:
        im=Image.open(ROOT/f'quills_{name}.png')
        if name=='base':
            bg=Image.new('RGBA',im.size,(34,37,42,255));bg.alpha_composite(im);im=bg.convert('RGB')
        if name=='height':im=Image.fromarray((np.asarray(im)/257).astype(np.uint8)).convert('RGB')
        if name=='regions':
            im=im.copy();im.putalpha(image(alpha));bg=Image.new('RGBA',im.size,(34,37,42,255));bg.alpha_composite(im);im=bg.convert('RGB')
        layer_items.append((name,im))
    layer_items.append(('default dye, unlit',default))
    contact(layer_items,3).save(QA/'layers_contact.png')
    small=[]
    for sz,desc in [(512,'Bird density: tails 165px, fingers 75px'),(128,'Quarter bird density: tails 41px, fingers 19px'),(105,'Bird 200px tall: tails 34px, fingers 15px'),(26,'Bird 50px tall: tails 8px, fingers 4px')]:
        im=render(palettes['Default slate / cream'],sz,threshold=True)
        im.save(QA/f'sheet_{sz}.png');small.append((desc,im.resize((512,512),Image.Resampling.NEAREST)))
    contact(small,2).save(QA/'size_checks.png')
    # Large actual-resolution crops expose the ragged band boundaries and barbs.
    e=study['elements'][0];box=e['box_px'];box=[box[0]-18,box[1]-5,box[2]+18,box[3]+8]
    details=[]
    for name,palette in palettes.items():
        im=render(palette).crop(box);details.append((name,im))
    contact(details,4,cell=(260,700)).save(QA/'tail_detail_dyes.png')
    render_assemblies(study,base,n,packed,regions,palettes)
    import assemble
    assemble.run(study,{'base':base,'normal':n*.5+.5,'packed':packed,'regions':regions/255})

def render_assemblies(study,base,n,packed,regions,palettes):
    # Assembly test, frozen 2-D cards only: seven feathers and four wing fingers.
    assemblies=[]
    for label,palette in palettes.items():
        rgba=render_rgba(base,n,packed,regions,palette)
        for kind in ['tail','wing']:
            canvas=Image.new('RGBA',(1000,900),(0,0,0,0))
            def stamp(idx,angle,mirror=False,origin=(500,800)):
                e=study['elements'][idx];b=e['box_px'];root=np.array(e['root_px'])
                crop=rgba.crop((b[0]-4,b[1]-4,b[2]+4,b[3]+4))
                rx=root[0]-(b[0]-4);ry=root[1]-(b[1]-4)
                if mirror:crop=crop.transpose(Image.Transpose.FLIP_LEFT_RIGHT);rx=crop.width-1-rx
                theta=np.deg2rad(angle);c,s=np.cos(theta),np.sin(theta)
                corners=np.array([[0,0],[crop.width,0],[0,crop.height],[crop.width,crop.height]])-[rx,ry]
                rotated=np.stack([c*corners[:,0]+s*corners[:,1],-s*corners[:,0]+c*corners[:,1]],-1)
                lo=np.floor(rotated.min(axis=0)).astype(int);hi=np.ceil(rotated.max(axis=0)).astype(int)
                inverse=(c,-s,c*lo[0]-s*lo[1]+rx,s,c,s*lo[0]+c*lo[1]+ry)
                stamp_im=crop.transform(tuple(hi-lo),Image.Transform.AFFINE,inverse,Image.Resampling.BICUBIC)
                canvas.alpha_composite(stamp_im,(int(origin[0]+lo[0]),int(origin[1]+lo[1])))
            if kind=='tail':
                for idx,angle,mirror in [(3,142,False),(3,218,True),(2,155,False),(2,205,True),(1,168,False),(1,192,True),(0,180,False)]:stamp(idx,angle,mirror)
            else:
                for idx,angle,y in [(7,78,520),(6,86,440),(5,94,360),(4,102,280)]:stamp(idx,angle,False,(340,y))
            bbox=canvas.getbbox();canvas=canvas.crop(bbox)
            if label=='Default slate / cream':canvas.save(QA/f'flat_{kind}_full.png')
            bg=Image.new('RGBA',canvas.size,(36,39,43,255));bg.alpha_composite(canvas)
            assemblies.append((label+' | '+('7 tail cards' if kind=='tail' else '4 wing fingers'),bg.convert('RGB')))
    contact(assemblies,2,cell=(520,420)).save(QA/'card_assemblies.png')

def render_rgba(base,n,packed,regions,palette):
    c=[]
    for p in palette:c.append(decode(np.array([int(p[i:i+2],16) for i in [1,3,5]])/255))
    mix=regions[...,1]/255
    col=decode(base[...,:3])/.5*(c[0][None,None,:]*(1-mix[...,None])+c[1][None,None,:]*mix[...,None])
    light=np.array([-.45,.5,.75]);light/=np.linalg.norm(light)
    shade=(.3+.75*np.maximum(np.sum(n*light,-1),0))*packed[...,0]
    return image(np.dstack([encode(col*shade[...,None]),base[...,3]]))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--numbers-only',action='store_true',help='Recheck unchanged maps without rerendering review pictures')
    args=parser.parse_args();check(reviews=not args.numbers_only)

"""Independent numerical checks and visual review panels. Writes checks/ only.
Run after build.py. Exits nonzero on failed acceptance checks.
"""
from pathlib import Path
import hashlib, json, math, time
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import map_coordinates, distance_transform_edt

ROOT=Path(__file__).resolve().parent; QA=ROOT/'checks'; QA.mkdir(exist_ok=True)
N=2048
DYES={'Umber #413225':'#413225','Hot pink':'#F12B91','Lime':'#B7EB38','Near black':'#15171A','Near white':'#F3F1EA'}
LIGHTS=[(-.55,.45,.70),(.65,.15,.70),(-.1,-.7,.70)]
try: FONT=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',18)
except OSError: FONT=ImageFont.load_default()


def lin(x):return np.where(x<=.04045,x/12.92,((x+.055)/1.055)**2.4)
def enc(x):return np.where(x<=.0031308,12.92*x,1.055*np.maximum(x,0)**(1/2.4)-.055)
def rgb8(x):return np.uint8(np.clip(np.rint(x*255),0,255))
def color(s):return lin(np.array([int(s[i:i+2],16) for i in (1,3,5)])/255)


def caption(im,title):
    out=Image.new('RGB',(im.width,im.height+34),(26,29,32));out.paste(im,(0,34))
    ImageDraw.Draw(out).text((10,7),title,font=FONT,fill=(232,232,226));return out


def grid(items,cols,cell=384):
    out=Image.new('RGB',(cols*cell,math.ceil(len(items)/cols)*(cell+34)),(26,29,32))
    for i,(title,im) in enumerate(items):
        im=im.convert('RGB').resize((cell,cell),Image.Resampling.LANCZOS)
        out.paste(caption(im,title),((i%cols)*cell,(i//cols)*(cell+34)))
    return out


def relight(b,n,packed,dye,light,alpha=None):
    light=np.array(light);light/=np.linalg.norm(light)
    ndotl=np.maximum(np.sum(n*light,axis=-1),0)
    # Broad diffuse environment plus key. White feather values remain high.
    lighting=.43+.70*ndotl
    result=lin(b[:,:,:3]/255)*(color(dye)/.5)[None,None,:]*lighting[:,:,None]*(packed[:,:,0]/255)[:,:,None]
    result=np.clip(enc(result),0,1)
    if alpha is not None:
        a=(alpha>=.5).astype(float)
        bg=np.full_like(result,.15)
        result=result*a[:,:,None]+bg*(1-a[:,:,None])
    return Image.fromarray(rgb8(result))


def corr(x,y):
    if np.std(x)<1e-12 or np.std(y)<1e-12:return 0.
    return float(np.corrcoef(np.ravel(x),np.ravel(y))[0,1])


def proxy(b,n,p,dye):
    """Curved hood + draping nape test at physical scale, not a creature render."""
    size=640; yy,xx=np.mgrid[:size,:size].astype(np.float32)
    X=(xx-size*.5)/(size*.27); Y=(yy-190)/150
    cap=(X*X+Y*Y)<1
    neck=(yy>=190)&(yy<570)&(np.abs(X)<(.76-.16*(yy-190)/380))
    mask=cap|neck
    # Cylindrical nape, ellipsoidal crown; diffuse geometric lighting is preview only.
    nx=X*.67; ny=-Y*.60
    nx=np.clip(nx,-.8,.8);ny=np.clip(ny,-.8,.8)
    ny[neck]=-.03
    nz=np.sqrt(np.maximum(1-nx*nx-ny*ny,.05))
    # Full proxy covers ~0.13 m crown width and ~0.23 m hood+nape length.
    u=(xx-size*.5)*(.13/(size*.54))/.284*N+N*.5
    v=(yy-40)*(.23/530)/.284*N
    coords=np.stack([v,np.mod(u,N)])
    bb=np.stack([map_coordinates(b[:,:,i].astype(float)/255,coords,order=1,mode='wrap') for i in range(3)],axis=-1)
    nn=np.stack([map_coordinates(n[:,:,i],coords,order=1,mode='wrap') for i in range(3)],axis=-1)
    aa=map_coordinates(p[:,:,0]/255,coords,order=1,mode='wrap')
    # Perturb tangent slope atop the geometric normal.
    comb=np.stack([nx+nn[:,:,0]*.7,ny+nn[:,:,1]*.7,nz*nn[:,:,2]],axis=-1)
    comb/=np.linalg.norm(comb,axis=-1,keepdims=True)
    light=np.array([-.4,.4,.82]);light/=np.linalg.norm(light)
    shade=.43+.70*np.maximum(np.sum(comb*light,axis=-1),0)
    rgb=enc(lin(bb)*color(dye)/.5*shade[:,:,None]*aa[:,:,None])
    bg=np.ones((size,size,3),np.float32)*np.array([.79,.78,.75])
    bg[mask]=np.clip(rgb[mask],0,1)
    return Image.fromarray(rgb8(bg))


def check_accepted():
    """Read-only SHA-256 check against the accepted images, layouts and originals."""
    accepted=json.loads((ROOT/'accepted_hashes.json').read_text())
    paths=dict(accepted['delivered_sha256'],**accepted['layout_sha256'])
    paths.update({'source/'+name:digest for name,digest in accepted['source_sha256'].items()})
    changed=[path for path,digest in paths.items()
             if not (ROOT/path).is_file() or hashlib.sha256((ROOT/path).read_bytes()).hexdigest()!=digest]
    return dict(checked_files=len(paths),changed_files=changed)


def run():
    started=time.time(); study=json.loads((ROOT/'study.json').read_text()); report={}; failures=[]
    layers=[]; dyes=[]; lights=[]; details=[]; offsets=[]; proxies=[]; all_arrays={}
    for name,meta in study['sets'].items():
        print('Checking',name,flush=True)
        arrays={}
        for layer in ['base','height','normal','packed','regions']:
            path=ROOT/f'{name}_{layer}.png'; im=Image.open(path)
            if im.size!=(N,N):failures.append(f'{name}/{layer}: wrong size')
            a=np.asarray(im);arrays[layer]=a
            if layer=='height':
                if a.dtype!=np.uint16:failures.append(f'{name}: height is not 16 bit')
                display=Image.fromarray(np.uint8(a/257)).convert('RGB')
            elif layer=='base' and meta['cutout']:
                bg=Image.new('RGBA',im.size,(45,48,51,255));bg.alpha_composite(im);display=bg.convert('RGB')
            else:display=im.convert('RGB')
            layers.append((f'{name} / {layer}',display))
        b=arrays['base']; h=arrays['height'].astype(np.float64)/65535; pk=arrays['packed']
        nn=arrays['normal'].astype(np.float32)/127.5-1; normal_length=np.linalg.norm(nn,axis=-1)
        n=nn/normal_length[:,:,None]
        alpha=b[:,:,3]/255 if meta['cutout'] else np.ones((N,N))
        valid=alpha>=.5
        base=lin(b[:,:,:3]/255).mean(axis=-1)
        mean=float(base[valid].mean())
        q=[]
        for sy,sx in [(0,0),(0,1),(1,0),(1,1)]:
            sl=np.s_[sy*N//2:(sy+1)*N//2,sx*N//2:(sx+1)*N//2]
            if valid[sl].any():q.append(float(base[sl][valid[sl]].mean()))
        qrange=(max(q)-min(q))/mean
        neutral=int(np.max(np.ptp(b[:,:,:3].astype(int),axis=-1)[valid]))
        expected=np.zeros_like(n)
        wrapx=meta['tile_axes']['x'];wrapy=meta['tile_axes']['y']
        dx=(np.roll(h,-1,1)-np.roll(h,1,1))*.5 if wrapx else np.gradient(h,axis=1)
        dy=(np.roll(h,-1,0)-np.roll(h,1,0))*.5 if wrapy else np.gradient(h,axis=0)
        k=meta['height_mm']*.001/(meta['span_m']/N)
        expected=np.stack([-dx*k,dy*k,np.ones_like(h)],axis=-1)
        expected/=np.linalg.norm(expected,axis=-1,keepdims=True)
        encoded=rgb8(expected*.5+.5)
        normal_byte_error=int(np.abs(encoded.astype(int)-arrays['normal'].astype(int)).max())
        slope_corr=[corr((-nn[:,:,0]/nn[:,:,2])[valid],(dx*k)[valid]),corr((nn[:,:,1]/nn[:,:,2])[valid],(dy*k)[valid])]
        light_corr=[]
        for az in np.linspace(0,2*np.pi,12,endpoint=False):
            light=np.array([np.cos(az)*.65,np.sin(az)*.65,.76]);light/=np.linalg.norm(light)
            light_corr.append(abs(corr(base[valid],np.maximum(np.sum(n*light,axis=-1),0)[valid])))
        palette=np.unique(arrays['regions'].reshape(-1,3),axis=0).tolist()
        seam={}
        for layer,a in arrays.items():
            a=a.astype(float)
            sx=np.mean(np.abs(a[:,0]-a[:,-1]))/max(1e-9,np.mean(np.abs(np.diff(a,axis=1))))
            sy=np.mean(np.abs(a[0]-a[-1]))/max(1e-9,np.mean(np.abs(np.diff(a,axis=0))))
            seam[layer]=dict(x=float(sx),y=float(sy))
            if wrapx and sx>1.3:failures.append(f'{name}/{layer}: X wrap ratio {sx:.3f}')
            if wrapy and sy>1.3:failures.append(f'{name}/{layer}: Y wrap ratio {sy:.3f}')
        entry=dict(mean_linear=mean,mean_srgb_equivalent=float(enc(np.array(mean))*255),
                   value_std_linear=float(base[valid].std()),
                   value_percentiles_linear=np.percentile(base[valid],[1,5,50,95,99]).tolist(),
                   source_value_variance_retained=meta.get('value_variance_retained'),
                   quarter_means_linear=q,quarter_spread_relative=qrange,neutral_max_channel_difference=neutral,
                   normal_height_correlations_xy=slope_corr,normal_byte_error=normal_byte_error,
                   normal_max_length_error=float(np.max(np.abs(normal_length-1))),
                   max_base_light_correlation=float(max(light_corr)),regions_palette=palette,
                   metalness_max=int(pk[:,:,2].max()),ao_range=[int(pk[:,:,0].min()),int(pk[:,:,0].max())],
                   roughness_range=[int(pk[:,:,1].min()),int(pk[:,:,1].max())],seam_step_ratios=seam)
        if abs(mean-.5)>.02:failures.append(f'{name}: mean grey')
        if qrange>.02:failures.append(f'{name}: quarter drift {qrange:.5f}')
        if neutral>2:failures.append(f'{name}: hue')
        if min(slope_corr)<.9:failures.append(f'{name}: normal correlation')
        if normal_byte_error>1:failures.append(f'{name}: normal not derived from delivered height')
        if entry['normal_max_length_error']>.008:failures.append(f'{name}: normal unit length')
        if max(light_corr)>.08:failures.append(f'{name}: albedo-light correlation {max(light_corr):.3f}')
        if palette!=[[255,0,255]]:failures.append(f'{name}: unexpected region colour')
        if pk[:,:,2].max()!=0:failures.append(f'{name}: metalness')
        for label,dye in DYES.items():dyes.append((f'{name} / {label}',relight(b,n,pk,dye,LIGHTS[0],alpha if meta['cutout'] else None)))
        for i,light in enumerate(LIGHTS):lights.append((f'{name} / light {i+1}',relight(b,n,pk,'#D1CFC9',light,alpha if meta['cutout'] else None)))
        beauty=relight(b,n,pk,'#73675B',LIGHTS[0],alpha if meta['cutout'] else None)
        beauty.save(QA/f'{name}_relit.png')
        if not meta['cutout']:
            details.append((f'{name} / 100% umber',relight(b,n,pk,'#413225',LIGHTS[0]).crop((768,768,1280,1280))))
            details.append((f'{name} / 100% white',relight(b,n,pk,'#F3F1EA',LIGHTS[1]).crop((768,768,1280,1280))))
            rolled=np.roll(np.asarray(beauty),(N//2 if wrapy else 0,N//2),axis=(0,1))
            Image.fromarray(rolled).save(QA/f'{name}_half_offset.png')
            offsets.append((f'{name} / half offset',Image.fromarray(rolled)))
            tiled=np.tile(np.asarray(beauty),(2 if wrapy else 1,2,1))
            Image.fromarray(tiled).resize((1024,1024 if wrapy else 512),Image.Resampling.LANCZOS).save(QA/f'{name}_repeat.jpg')
        else:
            coverage=[]
            for size in [512,128]:
                im=Image.open(ROOT/f'{name}_base.png').resize((size,size),Image.Resampling.LANCZOS)
                a=np.array(im)[:,:,3]/255;cut=a>=.5
                per_element={}
                for el in meta['elements']:
                    x0,y0,x1,y1=[int(round(v*size/N)) for v in el['box_px']]
                    per_element[el['id']]=int(cut[y0:y1,x0:x1].sum())
                    if per_element[el['id']]==0:failures.append(f'{el["id"]}: vanishes at {size}')
                coverage.append(dict(size=size,covered_pixels=int(cut.sum()),fraction=float(cut.mean()),element_pixels=per_element))
                shade=np.asarray(relight(b,n,pk,'#413225',LIGHTS[0])).astype(np.uint8)
                shade=Image.fromarray(shade).resize((size,size),Image.Resampling.LANCZOS)
                out=Image.new('RGB',(size,size),(212,209,201));out.paste(shade,(0,0),Image.fromarray(np.uint8(cut*255)))
                out.save(QA/f'cards_cut_{size}.png')
                out.resize((1024,1024),Image.Resampling.NEAREST).save(QA/f'cards_cut_{size}_nearest.png')
            entry['cutout_mips']=coverage
            # Every declared element must contain visible material; metadata is
            # checked against the actual alpha rather than trusting placement.
            occupied=np.zeros((N,N),np.uint8)
            for el in meta['elements']:
                x0,y0,x1,y1=el['box_px']; occupied[y0:y1,x0:x1]+=1
                if not valid[y0:y1,x0:x1].any():failures.append(f'empty card {el["id"]}')
                for landmark in ['root_px','tip_px']:
                    x,y=el[landmark]
                    if not(x0<=x<x1 and y0<=y<y1):failures.append(f'{el["id"]}: {landmark} outside box')
            entry['elements']=len(meta['elements']); entry['overlapping_element_boxes']=int((occupied>1).sum())
            if (occupied>1).any():failures.append('card boxes overlap')
            # Transparent RGB must be a complete colour dilation, with no black matte.
            nearest=distance_transform_edt(~valid,return_distances=False,return_indices=True)
            continued=b[:,:,:3][nearest[0],nearest[1]]
            entry['transparent_rgb_min']=int(b[:,:,:3][alpha<.01].min())
            entry['transparent_dilation_max_error']=int(np.abs(b[:,:,:3][~valid].astype(int)-continued[~valid].astype(int)).max())
            if entry['transparent_dilation_max_error']>0:failures.append('transparent colour does not continue its nearest feather')
            atlas=relight(b,n,pk,'#413225',LIGHTS[0],alpha).resize((1024,1024),Image.Resampling.LANCZOS)
            draw=ImageDraw.Draw(atlas)
            for index,el in enumerate(meta['elements']):
                box=[v/2 for v in el['box_px']];draw.rectangle(box,outline=(117,126,133),width=1)
                title=f'{index+1:02d} '+('point' if el['kind']=='forehead_point' else 'tuft' if el['kind']=='edge_tuft' else 'mane')
                draw.text((box[0],box[3]+5),title,font=FONT,fill=(225,223,212))
                for landmark,col in [('root_px',(76,222,150)),('tip_px',(255,168,76))]:
                    x,y=[v/2 for v in el[landmark]];draw.ellipse((x-2,y-2,x+2,y+2),fill=col)
            caption(atlas,'Card landmarks: green root / orange tip. Numbers follow study.json.').save(QA/'cards_landmarks.png')
        report[name]=entry;all_arrays[name]=(b,n,pk)
    grid(layers,5,320).save(QA/'layers_contact.jpg',quality=94)
    grid(dyes,5,384).save(QA/'dye_contact.jpg',quality=95)
    grid(lights,3,512).save(QA/'relighting_contact.jpg',quality=95)
    grid(details,2,512).save(QA/'detail_100percent.jpg',quality=97)
    grid(offsets,3,512).save(QA/'offsets_contact.jpg',quality=96)
    b,n,pk=all_arrays['cap_to_mane']
    for title,dye in DYES.items():proxies.append((f'Curved hood / {title}',proxy(b,n,pk,dye)))
    grid(proxies,5,512).save(QA/'curved_hood_dyes.jpg',quality=95)
    # Compare the correct physical footprint at bird study density, 200 px and 50 px.
    out=Image.new('RGB',(1440,900),(35,38,40));draw=ImageDraw.Draw(out)
    draw.text((30,18),'Physical read: 0.284 m tile / 0.65 m bird. Small views: actual size at left; 3x nearest at right.',font=FONT,fill='white')
    for col,name in enumerate(['cap','mane','cap_to_mane']):
        b,n,pk=all_arrays[name];beau=relight(b,n,pk,'#413225',LIGHTS[0])
        for row,(bird,size) in enumerate([(None,384),(200,87),(50,22)]):
            y=60+row*300;im=beau.resize((size,size),Image.Resampling.LANCZOS)
            if row==0:im=beau.resize((1024,1024),Image.Resampling.LANCZOS).crop((320,320,704,544))
            out.paste(im,(30+col*470,y+30))
            title=f'{name}: bird density crop (3600 px/m)' if row==0 else f'{name}: {bird}px bird -> {size}px tile'
            draw.text((30+col*470,y),title,font=FONT,fill='white')
            if row>0:out.paste(im.resize((size*3,size*3),Image.Resampling.NEAREST),(155+col*470,y+30))
    out.save(QA/'read_sizes.png')
    # Source sheet: each prepared feather is a separate full-resolution aligned asset.
    manifest=json.loads((ROOT/'source/feathers.json').read_text());source_panels=[]
    for f in manifest:
        im=Image.open(ROOT/f['cutout']);bg=Image.new('RGBA',im.size,(56,49,42,255));bg.alpha_composite(im)
        panel=Image.new('RGB',(384,384),(56,49,42));bg.thumbnail((350,350));panel.paste(bg.convert('RGB'),((384-bg.width)//2,(384-bg.height)//2))
        source_panels.append((f['id'],panel))
        for key in ['height','shaft','alpha']:
            if Image.open(ROOT/f[key]).size!=tuple(f['size_px']):failures.append(f'source layer mismatch: {f["id"]}')
    grid(source_panels,5,256).save(QA/'sources_contact.jpg',quality=95)
    for name,digest in study['source_sha256'].items():
        if hashlib.sha256((ROOT/'source'/name).read_bytes()).hexdigest()!=digest:failures.append('generated original changed')
    periodic=study['periodic_neighbourhood_max_difference']
    if max(value for maps in periodic.values() for axes in maps.values() for value in axes.values())>1e-5:
        failures.append('translated periodic neighbourhood mismatch')
    report['accepted_files']=check_accepted()
    if report['accepted_files']['changed_files']:failures.append('accepted delivery, layout or original changed')
    from review import round3_review
    report['visual_review']=round3_review(study,all_arrays)
    report['periodic_neighbourhoods']=periodic
    report['failures']=failures;report['passed']=not failures;report['seconds']=round(time.time()-started,2)
    (QA/'metrics.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:dict(mean=v['mean_linear'],quarter_drift=v['quarter_spread_relative'],light_corr=v['max_base_light_correlation'],normal_corr=v['normal_height_correlations_xy']) for k,v in report.items() if isinstance(v,dict) and 'mean_linear' in v},indent=2))
    print('FAILURES:',json.dumps(failures))
    raise SystemExit(1 if failures else 0)

if __name__=='__main__':run()

"""Independent material checks, relights, cutout and physical-scale previews.

Run after build.py. Writes checks/ by default; --output-dir selects another preview folder.
"""
from pathlib import Path
import argparse, json, struct, hashlib
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter, binary_erosion, label, minimum_filter1d, maximum_filter1d

ROOT=Path(__file__).resolve().parent
QA=ROOT/'checks'
N=2048


def linear(x): return np.where(x<=.04045,x/12.92,((x+.055)/1.055)**2.4)
def srgb(x):
    x=np.clip(x,0,1)
    return np.where(x<=.0031308,x*12.92,1.055*x**(1/2.4)-.055)
def asimage(x): return Image.fromarray(np.uint8(np.rint(np.clip(x,0,1)*255)))


def grid(items,cols=3,cell=512):
    out=Image.new('RGB',(cols*cell,((len(items)+cols-1)//cols)*(cell+30)),(27,30,34))
    draw=ImageDraw.Draw(out)
    for i,(title,im) in enumerate(items):
        x,y=(i%cols)*cell,(i//cols)*(cell+30)
        if im.mode=='RGBA':
            bg=Image.new('RGB',im.size,(48,52,57)); bg.paste(im,mask=im.getchannel('A')); im=bg
        im=im.copy();im.thumbnail((cell,cell),Image.Resampling.LANCZOS)
        out.paste(im,(x+(cell-im.width)//2,y+30+(cell-im.height)//2));draw.text((x+10,y+8),title,fill=(235,235,230))
    return out


def relight(base,n,packed,dye,light=(-.55,.4,.73),alpha=None):
    direction=np.array(light);direction=direction/np.linalg.norm(direction)
    lambert=np.maximum(np.sum(n*direction,-1),0)
    # Linear dye multiplication with shared 0.50 mean compensation.
    albedo=linear(base[:,:,:3])*linear(np.array(dye)/255)/.5
    shade=albedo*(.27+.92*lambert[:,:,None])*(.5+.5*packed[:,:,0,None])
    result=srgb(shade)
    if alpha is not None:
        opaque=alpha>=.5
        result=np.where(opaque[:,:,None],result,np.array([.19,.21,.23]))
    return asimage(result)


def correlations(base,n,valid):
    y=base[valid]; y=y-y.mean()
    result={}
    for i,k in enumerate(['normal_x','normal_y','normal_z']):
        x=n[:,:,i][valid];x=x-x.mean()
        result[k]=float(np.mean(x*y)/(np.std(x)*np.std(y)+1e-12))
    for name,light in [('left',[-.65,.35,.68]),('right',[.65,.35,.68]),('below',[0,-.7,.71])]:
        ll=np.array(light);ll/=np.linalg.norm(ll)
        x=np.maximum(np.sum(n*ll,-1),0)[valid];x-=x.mean()
        result[name]=float(np.mean(x*y)/(np.std(x)*np.std(y)+1e-12))
    return result


def evaluate():
    study=json.loads((ROOT/'study.json').read_text()); results={}; all_pass=True
    dyes=[('slate',(119,122,129)),('hot pink',(245,35,153)),('lime',(153,235,38)),
          ('near black',(23,25,29)),('near white',(235,234,229))]
    tile_lit=None
    for name,meta in study['sets'].items():
        arrays={}; views=[]; offsets=[]; result={}; issues=[]
        for kind,file in meta['files'].items():
            im=Image.open(ROOT/file);a=np.asarray(im);arrays[kind]=a
            bitdepth=(ROOT/file).read_bytes()[24]
            if im.size!=(N,N): issues.append(f'{kind}: wrong size')
            if kind=='height' and bitdepth!=16: issues.append('height not 16 bit')
            if kind!='height' and bitdepth!=8: issues.append(f'{kind} not 8 bit')
            result[kind]=dict(size=list(im.size),mode=im.mode,bit_depth=bitdepth,
                              gamma=im.info.get('gamma'),srgb=im.info.get('srgb'))
            if kind=='height': display=Image.fromarray(np.uint8(a/257)).convert('RGB')
            else: display=im.copy()
            views.append((kind,display))
            if meta['tiles']:
                offsets.append((kind+' half offset',Image.fromarray(np.roll(np.asarray(display),(1024,1024),(0,1)))))
                f=a.astype(np.float64)
                ratios=[]
                for axis in [1,0]:
                    interior=np.abs(np.diff(f,axis=axis)).mean()
                    edge=np.abs(np.take(f,0,axis)-np.take(f,-1,axis)).mean()
                    ratios.append(float(edge/max(interior,1e-8)))
                result[kind]['wrap_jump_ratio_xy']=ratios
                if max(ratios)>1.3: issues.append(f'{kind}: wrap jump {ratios}')
        grid(views,3).save(QA/f'{name}_layers.png')
        if offsets: grid(offsets,3).save(QA/f'{name}_offsets.png')
        base=arrays['base'].astype(np.float32)/255
        alpha=base[:,:,3] if meta['cutout'] else np.ones((N,N))
        valid=alpha>=.5
        value=linear(base[:,:,0])
        mean=float(value[valid].mean())
        neutral=int(np.ptp(arrays['base'][:,:,:3],axis=2)[valid].max())
        quarters=[float(value[r*N//2:(r+1)*N//2,c*N//2:(c+1)*N//2][valid[r*N//2:(r+1)*N//2,c*N//2:(c+1)*N//2]].mean()) for r in range(2) for c in range(2)]
        result['albedo']=dict(mean_linear=mean,mean_srgb=float(arrays['base'][:,:,0][valid].mean()),
                            max_channel_spread=neutral,quarter_means_linear=quarters,
                            relative_quarter_spread=(max(quarters)-min(quarters))/mean)
        if abs(mean-.5)>.02 or neutral>2 or (max(quarters)-min(quarters))/mean>.02: issues.append('albedo tolerance')
        h=arrays['height'].astype(np.float64)/65535
        # Independent world-space finite differences, OpenGL green sign.
        pitch=meta['span_m']*1000/N; full=meta['height_mm']
        # The game's checker wraps every picture, including isolated sheets.
        dx=(np.roll(h,-1,1)-np.roll(h,1,1))*full/(2*pitch)
        dy=(np.roll(h,-1,0)-np.roll(h,1,0))*full/(2*pitch)
        expected=np.stack([-dx,dy,np.ones_like(h)],-1)
        expected/=np.linalg.norm(expected,axis=2,keepdims=True)
        n=arrays['normal'].astype(np.float64)/127.5-1
        lengths=np.linalg.norm(n,axis=2)
        byteerr=int(np.abs(np.rint((expected*.5+.5)*255)-arrays['normal']).max())
        corr=[float(np.corrcoef(expected[:,:,k][valid],n[:,:,k][valid])[0,1]) for k in range(2)]
        result['normal_height']=dict(correlation_xy=corr,max_byte_error=byteerr,unit_length_max_error=float(np.max(np.abs(lengths-1))),
                                    height_used_mm=[float(h[valid].min()*full),float(h[valid].max()*full)],
                                    height_std_mm=float(h[valid].std()*full),
                                    normal_xy_rms=float(np.sqrt(np.mean(np.sum(n[:,:,:2]**2,axis=2)[valid]))))
        result['normal_height']['correlation_xy_including_gutters']=[float(np.corrcoef(expected[:,:,k].ravel(),n[:,:,k].ravel())[0,1]) for k in range(2)]
        if min(corr)<.9 or byteerr>1 or np.max(np.abs(lengths-1))>.008: issues.append('normal/height agreement')
        if min(result['normal_height']['correlation_xy_including_gutters'])<.9: issues.append('wrapped normal/height agreement including gutters')
        result['albedo']['lighting_correlation']=correlations(value,n,valid)
        if max(abs(x) for x in result['albedo']['lighting_correlation'].values())>.06: issues.append('residual base lighting correlation')
        codes=arrays['regions'].astype(np.uint32)
        codes=(codes[:,:,0]<<16)+(codes[:,:,1]<<8)+codes[:,:,2]
        unique,counts=np.unique(codes,return_counts=True)
        colours=np.stack([unique>>16,(unique>>8)&255,unique&255],axis=-1)
        result['region_palette']={str(tuple(map(int,c))):int(v) for c,v in zip(colours,counts)}
        if not np.all(arrays['regions']==np.array([255,0,0])): issues.append('non-red region pixel')
        result['region_non_neighbour_contacts']=0
        packed=arrays['packed'].astype(float)/255
        result['packed_channels']=dict(ao_range=[float(packed[:,:,0][valid].min()),float(packed[:,:,0][valid].max())],
                        ao_mean=float(packed[:,:,0][valid].mean()),
                        roughness_range=[float(packed[:,:,1][valid].min()),float(packed[:,:,1][valid].max())],
                        metalness_max=int(arrays['packed'][:,:,2].max()))
        if packed[:,:,2].max()!=0: issues.append('metalness nonzero')
        lit=[]
        small_base=np.asarray(Image.fromarray(arrays['base']).resize((768,768),Image.Resampling.LANCZOS)).astype(np.float32)/255
        small_n=np.asarray(Image.fromarray(arrays['normal']).resize((768,768),Image.Resampling.LANCZOS)).astype(np.float32)/127.5-1
        small_p=np.asarray(Image.fromarray(arrays['packed']).resize((768,768),Image.Resampling.LANCZOS)).astype(np.float32)/255
        small_alpha=small_base[:,:,3] if meta['cutout'] else None
        for dye_name,dye in dyes:
            for light_name,light in [('upper left',(-.6,.35,.72)),('upper right',(.6,.35,.72)),('lower',(0,-.7,.71))]:
                im=relight(small_base,small_n,small_p,dye,light,small_alpha)
                lit.append((dye_name+' / '+light_name,im))
                if dye_name=='slate' and light_name=='upper left':
                    im=relight(base,n,packed,dye,light,alpha if meta['cutout'] else None)
                    im.save(QA/f'{name}_slate_full.png')
                    if not meta['cutout']: tile_lit=im
        grid(lit,3,448).save(QA/f'{name}_dyes_relighting.png')
        if meta['cutout']:
            border=np.concatenate([h[:24].ravel(),h[-24:].ravel(),h[:,:24].ravel(),h[:,-24:].ravel()])
            result['height_border_range']=float(np.ptp(border))
            if np.ptp(border)>0: issues.append('sheet border is not flat and matching')
            edgeviews=[];edge_stats={}
            for size in [2048,512,128]:
                a=np.asarray(Image.fromarray(np.uint8(alpha*255)).resize((size,size),Image.Resampling.LANCZOS))>=128
                lab,num=label(a);areas=np.bincount(lab.ravel())[1:]
                main=int((areas>=max(4,size*size*.0003)).sum())
                edge_stats[str(size)]=dict(visible_elements=main,cutout_pixels=int(a.sum()),
                                          perimeter_pixels=int(np.sum(a & ~binary_erosion(a))))
                # An enlargement of the *thresholded mip*, not a soft image.
                silhouette=np.where(a[:,:,None],np.array([238,238,232]),np.array([39,43,47])).astype(np.uint8)
                edgeviews.append((f'{size}px sheet / 0.5 alpha cut',Image.fromarray(silhouette).resize((768,768),Image.Resampling.NEAREST)))
            result['alpha_mips']=edge_stats
            grid(edgeviews,3,768).save(QA/'fringe_alpha_mips.png')
            for size in [512,128]:
                if edge_stats[str(size)]['visible_elements']!=12: issues.append(f'{size}px mip lost element')
            # Transparent colour padding cannot be black and must stay neutral.
            result['transparent_rgb_min']=int(arrays['base'][:,:,:3][~valid].min())
            if result['transparent_rgb_min']<100: issues.append('dark colour gutter')
            atlas=Image.open(ROOT/'trousers_fringe_base.png').convert('RGBA')
            inspect=[]
            for el in meta['elements']:
                l,t,r,b=el['box']; margin=10
                im=atlas.crop((max(0,l-margin),max(0,t-margin),min(N,r+margin),min(N,b+margin)))
                canvas=Image.new('RGBA',(600,600),(0,0,0,0));im.thumbnail((570,570))
                canvas.paste(im,((600-im.width)//2,(600-im.height)//2))
                inspect.append((el['id'],canvas))
                if not (l<=el['root'][0]<r and t-2<=el['root'][1]<b): issues.append(el['id']+' root outside box')
                if not (l<=el['tip'][0]<r and t<=el['tip'][1]<b): issues.append(el['id']+' tip outside box')
            grid(inspect,4,400).save(QA/'source_family.png')
        result['issues']=issues;result['passed']=not issues;results[name]=result;all_pass &= not issues
    periodic=json.loads((ROOT/'source/periodicity.json').read_text())
    results['translated_neighbourhood_periodicity']=periodic
    if max(v for p in periodic.values() for v in p.values())>1e-6: all_pass=False
    accepted=json.loads((ROOT/'source/build_config.json').read_text())
    preserved={k:hashlib.sha256((ROOT/k).read_bytes()).hexdigest()==v
               for k,v in accepted['accepted_png_sha256'].items()}
    preserved['fringe_metadata']=study['sets']['trousers_fringe']==accepted['accepted_fringe_metadata']
    preserved['originals']=all(hashlib.sha256((ROOT/'source'/k).read_bytes()).hexdigest()==v
                              for k,v in accepted['metadata']['source_sha256'].items())
    results['accepted_build_unchanged']=preserved
    all_pass &= all(preserved.values())
    results['passed']=all_pass
    (QA/'results.json').write_text(json.dumps(results,indent=2)+'\n')
    if tile_lit is not None:
        small=tile_lit.resize((768,768),Image.Resampling.LANCZOS)
        repeat=Image.new('RGB',(1536,1536))
        for y in [0,768]:
            for x in [0,768]:repeat.paste(small,(x,y))
        repeat.save(QA/'tile_2x2.png')
        physical_sizes(tile_lit,study)
        comparison_body(tile_lit)
        source_views()
        originals_comparison()
        concept_comparison()
        drawing_retention()
    print(json.dumps({k:dict(passed=v['passed'],issues=v['issues']) for k,v in results.items() if isinstance(v,dict) and 'issues' in v},indent=2))
    print('All checks passed:',all_pass,flush=True)
    if not all_pass:
        raise SystemExit(1)


def physical_sizes(tile,study):
    out=Image.new('RGB',(1536,850),(32,35,39));d=ImageDraw.Draw(out)
    d.text((20,15),'Physical scale: tile spans 0.427 m; standing bird 0.65 m',fill=(240,240,235))
    for x,bird in [(25,1500),(700,200),(1020,50)]:
        pixels=round(.427/.65*bird)
        im=tile.resize((pixels,pixels),Image.Resampling.LANCZOS)
        if bird==1500:
            im=im.crop((0,0,640,640))
            title='Arm-length detail / 1500 px bird (crop)'
        else: title=f'{bird} px bird / {pixels} px material'
        d.text((x,55),title,fill=(240,240,235));out.paste(im,(x,85))
        if bird<1500:
            out.paste(im.resize((pixels*3,pixels*3),Image.Resampling.NEAREST),(x,300))
            d.text((x,280),'Same pixels, enlarged 3x',fill=(240,240,235))
    out.save(QA/'physical_read_sizes.png')
    # Place the actual textured cards at their metre scale into a loose belly edge.
    b=Image.open(ROOT/'trousers_fringe_base.png');meta=study['sets']['trousers_fringe']
    strip=Image.new('RGBA',(1700,850),(0,0,0,0))
    rng=np.random.default_rng(815)
    for j in range(28):
        el=meta['elements'][j%12];l,t,r,bot=el['box'];cut=b.crop((l,t,r,bot))
        # Strip rendered at 4800 px/m, same density as the surface tile.
        cut=cut.resize((round(cut.width*.341/.427),round(cut.height*.341/.427)),Image.Resampling.LANCZOS)
        raw=np.asarray(cut).astype(float)/255
        rgb=srgb(linear(raw[:,:,:3])*linear(np.array([119,122,129])/255)/.5)
        cut=asimage(np.dstack([rgb,raw[:,:,3]]))
        strip.alpha_composite(cut,(int(j*61-50),int(260+rng.integers(-45,40))))
    # Top is the continuous opaque plumage, bottom is actual cutout locks.
    cover=tile.crop((0,0,1700,360)).convert('RGBA');strip.alpha_composite(cover,(0,0))
    items=[]
    for s in [1700,425,128]:
        im=strip.resize((s,round(850*s/1700)),Image.Resampling.LANCZOS)
        arr=np.array(im);arr[:,:,3]=(arr[:,:,3]>=128)*255
        im=Image.fromarray(arr).resize((1700,850),Image.Resampling.NEAREST if s<1700 else Image.Resampling.LANCZOS)
        items.append((f'Belly fringe / width {s}px before threshold',im))
    grid(items,1,1100).save(QA/'belly_edge_sizes.png')


def comparison_body(tile):
    folder=ROOT.parent/'body'
    files=[folder/f'body_plain_{k}.png' for k in ['base','normal','packed']]
    if all(p.exists() for p in files):
        a,n,p=[np.asarray(Image.open(f)).astype(float)/255 for f in files]
        body=relight(a,n*2-1,p,(119,122,129))
        # Equal physical scale; shows blend compatibility rather than claiming a mesh preview.
        out=Image.new('RGB',(1536,800),(30,33,37));d=ImageDraw.Draw(out)
        out.paste(body.resize((768,768)),(0,32));out.paste(tile.resize((768,768)),(768,32))
        d.text((12,10),'Body / 0.427 m',fill=(240,240,235));d.text((780,10),'Trousers / 0.427 m',fill=(240,240,235))
        out.save(QA/'body_compatibility.png')


def source_views():
    items=[]
    for i in range(1,13):
        ident=f'feather_{i:02d}'
        cut=Image.open(ROOT/'source'/f'{ident}_cutout.png').convert('RGBA')
        a=np.asarray(cut).copy()
        shaft=np.asarray(Image.open(ROOT/'source'/f'{ident}_shaft.png')).astype(float)/255
        strength=shaft[:,:,None]*.65
        a[:,:,:3]=np.rint(a[:,:,:3]*(1-strength)+np.array([245,92,70])*strength)
        # Neutral canvas uses alpha correctly; red shows the tracked rachis.
        im=Image.fromarray(a);im.thumbnail((360,560))
        canvas=Image.new('RGBA',(600,600),(0,0,0,0))
        canvas.paste(im,((600-im.width)//2,(600-im.height)//2))
        items.append((ident+' / shaft overlay',canvas))
    grid(items,4,400).save(QA/'shaft_alignment.png')


def originals_comparison():
    """Compare untouched-source drawing with the actual delivered atlas pixels."""
    from build import sample_element
    study=json.loads((ROOT/'study.json').read_text())
    meta=study['sets']['trousers_fringe']
    delivered=np.asarray(Image.open(ROOT/'trousers_fringe_base.png')).astype(float)/255
    normal=np.asarray(Image.open(ROOT/'trousers_fringe_normal.png')).astype(float)/127.5-1
    packed=np.asarray(Image.open(ROOT/'trousers_fringe_packed.png')).astype(float)/255
    items=[]
    for i in [1,3,7,12]:
        name=f'feather_{i:02d}'
        orig=np.asarray(Image.open(ROOT/'source'/f'{name}_original.png')).astype(float)/255
        working=np.asarray(Image.open(ROOT/'source'/f'{name}_cutout.png')).astype(float)/255
        gray=linear(orig[:,:,:3].mean(2));ok=orig[:,:,3]>.5
        gray+=.5-gray[ok].mean()
        orig[:,:,:3]=srgb(gray)[:,:,None]
        # Use the atlas placement transform, then crop all three columns from
        # the same pixel rectangle. Actual exported base, normals and AO follow.
        el=meta['elements'][i-1];H,W=orig.shape[:2]
        ys,xs=np.where(working[:,:,3]>.5)
        length=el['length_m']/.341*N*H/(ys.max()-ys.min())
        width=el['width_m']/.341*N*W/(xs.max()-xs.min())
        cx=((i-1)%4+.5)*N/4;cy=((i-1)//4+.5)*N/3
        sl,channels=sample_element([orig[:,:,c] for c in range(4)],cx,cy,width,length,0,False,(N,N))
        orig=np.stack(channels,-1);base=delivered[sl]
        lit=relight(base,normal[sl],packed[sl],(188,188,188))
        lit.putalpha(Image.fromarray(np.uint8(base[:,:,3]*255)))
        for title,im in [('original / same atlas placement',asimage(orig)),('delivered sheet base / unlit',asimage(base)),('delivered sheet / gentle relight',lit)]:
            canvas=Image.new('RGBA',(640,680),(0,0,0,0))
            canvas.paste(im,((640-im.width)//2,(680-im.height)//2))
            items.append((name+' '+title,canvas))
    grid(items,3,640).save(QA/'originals_vs_delivered.png')
    b=Image.open(ROOT/'trousers_fringe_base.png')
    alpha=b.getchannel('A').resize((512,512),Image.Resampling.LANCZOS)
    b=b.resize((512,512),Image.Resampling.LANCZOS)
    b.putalpha(alpha.point(lambda x:255 if x>=128 else 0))
    bg=Image.new('RGB',b.size,(45,50,55));bg.paste(b,mask=b.getchannel('A'))
    bg.save(QA/'fringe_512_cut.png')


def drawing_retention():
    """Record fine drawing agreement with the immutable generated specimens."""
    measures={}
    for i in range(1,13):
        name=f'feather_{i:02d}'
        original=np.asarray(Image.open(ROOT/'source'/f'{name}_original.png')).astype(float)/255
        base=np.asarray(Image.open(ROOT/'source'/f'{name}_cutout.png')).astype(float)/255
        mask=binary_erosion(original[:,:,3]>.9,iterations=3)
        o=linear(original[:,:,:3].mean(2)); b=linear(base[:,:,0])
        bands={}
        for band,low,high in [('barbs',.5,3),('locks',3,20)]:
            ob=gaussian_filter(o,low)-gaussian_filter(o,high)
            bb=gaussian_filter(b,low)-gaussian_filter(b,high)
            bands[band]=dict(correlation=float(np.corrcoef(ob[mask],bb[mask])[0,1]),
                             contrast_ratio=float(bb[mask].std()/ob[mask].std()))
        measures[name]=bands
    tile={}
    for revision,path in [('accepted',ROOT/'trousers_base.png')]:
        b=linear(np.asarray(Image.open(path)).astype(float)[:,:,0]/255)
        tile[revision]=dict(linear_value_std=float(b.std()),
                           fine_value_std=float((b-gaussian_filter(b,24,mode='wrap')).std()))
    coverage=np.load(ROOT/'source/tile_placement.npz')['coverage']
    result=dict(source_drawing=measures,tile_contrast=tile,
                feather_bed_coverage=dict(minimum=float(coverage.min()),
                    fraction_below_99_percent=float((coverage<.99).mean()),
                    pixels_showing_only_deepest_feather_bed=int((coverage==0).sum()),
                    mean_deepest_bed_contribution=float((1-coverage).mean()),
                    note='Coverage measures the new upper beds. The regenerated feather underlay fills every pixel beneath them.'))
    (QA/'drawing_retention.json').write_text(json.dumps(result,indent=2)+'\n')


def concept_comparison():
    ref=ROOT.parents[2]/'ref/concept/side.png'
    # 1500 pixels/metre in the concept; both samples cover the same 0.327 m.
    concept=Image.open(ref).convert('RGB').crop((380,770,870,1060))
    base=np.asarray(Image.open(ROOT/'trousers_base.png')).astype(float)/255
    dyed=asimage(srgb(linear(base)*linear(np.array([119,122,129])/255)/.5))
    lit=Image.open(QA/'trousers_slate_full.png')
    items=[]
    for title,im in [('Concept lower flank / original scale',concept),
                     ('Trousers / dyed UNLIT / same scale',dyed.resize((640,640),Image.Resampling.LANCZOS).crop((60,200,550,490))),
                     ('Trousers / relit / same scale',lit.resize((640,640),Image.Resampling.LANCZOS).crop((60,200,550,490)))]:
        canvas=Image.new('RGB',(510,350),(30,34,38));canvas.paste(im,(10,35))
        items.append((title,canvas))
    grid(items,3,510).save(QA/'concept_scale_comparison.png')


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--output-dir',type=Path,default=QA)
    args=parser.parse_args()
    QA=args.output_dir.resolve();QA.mkdir(parents=True,exist_ok=True)
    evaluate()

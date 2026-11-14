#!/usr/bin/env python3
"""Validate delivered PNGs against new footprint/face rings; write review images."""
from pathlib import Path
import json
import struct
import hashlib
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import map_coordinates, gaussian_filter, gaussian_filter1d, binary_dilation

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'checks';N=2048;MM=3000/N;LABEL=32


def font(size=17):
    for path in ['/System/Library/Fonts/Supplemental/Arial.ttf','/System/Library/Fonts/Helvetica.ttc']:
        if Path(path).exists():return ImageFont.truetype(path,size)
    return ImageFont.load_default()


def sheet(items,path,size=768,cols=4):
    out=Image.new('RGB',(size*cols,(size+LABEL)*((len(items)+cols-1)//cols)),(25,26,27))
    draw=ImageDraw.Draw(out)
    for i,(im,label) in enumerate(items):
        x=(i%cols)*size;y=(i//cols)*(size+LABEL)
        out.paste(im.convert('RGB').resize((size,size),Image.Resampling.LANCZOS),(x,y+LABEL))
        draw.text((x+9,y+7),label,font=font(12 if size<512 else 17),fill=(235,235,235))
    out.save(path,quality=94,subsampling=0)


def tile3(im,path):
    small=im.resize((768,768),Image.Resampling.LANCZOS)
    out=Image.new('RGB',(2304,2304))
    for y in range(3):
        for x in range(3):out.paste(small,(x*768,y*768))
    out.save(path,quality=94,subsampling=0)


def normal_from_height(h):
    dx=(np.roll(h,-1,1)-np.roll(h,1,1))/(2*MM)
    dy=(np.roll(h,-1,0)-np.roll(h,1,0))/(2*MM)
    n=np.stack([-dx,dy,np.ones_like(h)],-1)
    return n/np.linalg.norm(n,axis=-1,keepdims=True)


def independent_ids(layout,key):
    """Ray-crossing point inclusion, independent of builder's half-plane method."""
    result=np.full((N,N),-1,np.int16)
    for i,s in enumerate(layout['stones']):
        v=np.array(s[key])*N/3
        lo=np.floor(v.min(0)).astype(int);hi=np.ceil(v.max(0)).astype(int)
        yy,xx=np.mgrid[lo[1]:hi[1],lo[0]:hi[0]];x=xx+.5;y=yy+.5
        inside=np.zeros(x.shape,bool)
        for a,b in zip(v,np.roll(v,-1,0)):
            if abs(b[1]-a[1])<1e-12:continue
            crossing=((a[1]>y)!=(b[1]>y))&(x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])
            inside^=crossing
        iy=yy[inside]%N;ix=xx[inside]%N
        assert np.all(result[iy,ix]==-1),'Reference polygons overlap'
        result[iy,ix]=i
    return result


def sample(a,x,y):
    coords=[np.atleast_1d(y)-.5,np.atleast_1d(x)-.5]
    out=map_coordinates(a,coords,order=1,mode='grid-wrap')
    return out[0] if np.ndim(x)==0 and np.ndim(y)==0 else out


def model_triangles(stone):
    """Independent vertex contract for the layout's bevel and crowned face."""
    foot=np.array(stone['footprint_metres'])*N/3;face=np.array(stone['face_metres'])*N/3
    centre=np.array(stone['crown_at_metres'])*N/3
    u,v=(centre-face.min(0))/(face.max(0)-face.min(0));r=np.array(stone['face_rise_mm_at_corners'])
    top=float(np.dot(r,[(1-u)*(1-v),u*(1-v),u*v,(1-u)*v])+stone['crown_mm'])
    rise=r[[0,1,1,2,2,3,3,0]]
    triangles=[]
    for a in range(8):
        b=(a+1)%8
        triangles.extend([(np.array([foot[a],foot[b],face[b]]),np.array([0,0,rise[b]])),
                          (np.array([foot[a],face[b],face[a]]),np.array([0,rise[b],rise[a]])),
                          (np.array([face[a],face[b],centre]),np.array([rise[a],rise[b],top]))])
    return triangles,top


def main():
    OUT.mkdir(exist_ok=True)
    names=['base','height','normal','orm']
    ims={k:Image.open(ROOT/f'masonry_{k}.png') for k in names}
    arr={k:np.array(v) for k,v in ims.items()}
    base=arr['base'];height=arr['height'].astype(np.float64)*(48/65535);orm=arr['orm']
    normal=arr['normal'].astype(np.float64)/127.5-1
    normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
    layout=json.loads((ROOT/'layout/layout.json').read_text())
    meta=json.loads((ROOT/'build_metadata.json').read_text());der=np.load(ROOT/'derivation.npz')
    ids=der['stone_id'];faces=der['face_id'];macro=der['macro_height_mm']
    model_height=der['geometry_preview_height_mm'];face_distance=der['face_distance_mm']
    residual=height-macro;face=faces>=0;mortar=ids<0;band=(ids>=0)&~face
    metrics={'formats':{},'normal_mode':meta['normal_mode'],'layout_sha256':meta['layout_sha256']}
    failures=[]
    def require(test,message):
        if not test:failures.append(message)
    require(hashlib.sha256((ROOT/'layout/layout.json').read_bytes()).hexdigest()==meta['layout_sha256'],'Current layout hash')
    require(len(layout['stones'])==43,'Round-four stone count')
    for k in names:
        data=(ROOT/f'masonry_{k}.png').read_bytes()
        width,h,depth,color=struct.unpack('>IIBB',data[16:26])
        metrics['formats'][k]={'dimensions':[width,h],'bit_depth':depth,'color_type':color,'icc_profile':bool(ims[k].info.get('icc_profile'))}
        require((width,h)==(N,N),k+' dimensions')
        require((depth,color)==((16,0) if k=='height' else (8,2)),k+' format')
        require(bool(ims[k].info.get('icc_profile'))==(k=='base'),k+' color-space metadata')
    mean=base.mean((0,1));metrics['mean_base_srgb']=mean.tolist()
    require(np.max(abs(mean-[156,150,138]))<=8,'Mean color target')
    normal_h=residual if meta['normal_mode']=='surface' else height
    expected=normal_from_height(normal_h)
    angles=np.degrees(np.arccos(np.clip((expected*normal).sum(-1),-1,1)))
    metrics['normal_error_degrees']={'mean':float(angles.mean()),'p99':float(np.percentile(angles,99)),'max':float(angles.max())}
    require(angles.max()<.4,'Normal from delivered height convention/scale')
    metrics['metalness_nonzero_pixels']=int(np.count_nonzero(orm[...,2]))
    require(metrics['metalness_nonzero_pixels']==0,'Metalness')
    metrics['height_mm']={'min':float(height.min()),'max':float(height.max()),
                          'face_mean':float(height[face].mean()),'mortar_mean':float(height[mortar].mean()),
                          'face_p01_p99':np.percentile(height[face],[1,99]).tolist(),
                          'mortar_p01_p99':np.percentile(height[mortar],[1,99]).tolist()}
    require(0<=height.min()<height.max()<=48,'48 mm range')
    require(38<=height[face].mean()<=42 and height[mortar].mean()<4,'Refitted LOD height levels')
    metrics['coverage_percent']={k:float(m.mean()*100) for k,m in [('face',face),('bevel',band),('mortar',mortar)]}
    metrics['roughness']={k:[float(orm[...,1][m].min()/255),float(orm[...,1][m].mean()/255),float(orm[...,1][m].max()/255)] for k,m in [('face',face),('bevel_including_subpixel_mortar_blend',band),('mortar',mortar)]}
    require(orm[...,1][ids>=0].min()>=191 and orm[...,1][face].max()<=242,'Stone roughness')
    require(orm[...,1][mortar].min()>=230,'Mortar roughness')
    metrics['ambient_occlusion']={k:float(orm[...,0][m].mean()/255) for k,m in [('face',face),('bevel',band),('mortar',mortar)]}
    require(metrics['ambient_occlusion']['face']>.97,'Face AO mostly white')
    reference_ids=independent_ids(layout,'footprint_metres');reference_faces=independent_ids(layout,'face_metres')
    metrics['registration']={'footprint_id_mismatches':int(np.count_nonzero(reference_ids!=ids)),
                             'face_id_mismatches':int(np.count_nonzero(reference_faces!=faces))}
    require(np.array_equal(ids,reference_ids),'Footprint registration')
    require(np.array_equal(faces,reference_faces),'Face ring registration')
    cells=np.array(Image.open(ROOT/'layout/cells.png').convert('RGB'))
    ref_ids=np.full((N,N),-1,np.int16)
    for i,s in enumerate(layout['stones']):ref_ids[np.all(cells==s['id_colour'],axis=-1)]=i
    boundary=(ref_ids!=np.roll(ref_ids,1,0))|(ref_ids!=np.roll(ref_ids,1,1))
    safe=~binary_dilation(boundary,iterations=3)
    metrics['registration']['cells_png_mismatches_away_raster_edges']=int(np.count_nonzero((ids!=ref_ids)&safe))
    require(metrics['registration']['cells_png_mismatches_away_raster_edges']==0,'Cells raster agreement')
    # Measure the visible albedo boundary independently across every footprint edge.
    luma=np.sum(base.astype(np.float64)*np.array([.2126,.7152,.0722]),axis=-1)
    cross=np.arange(-8,8.001,.25);samples=[];skipped=0
    for s in layout['stones']:
        verts=np.array(s['footprint_metres'])*N/3
        for a,b in zip(verts,np.roll(verts,-1,0)):
            edge=b-a;length=np.linalg.norm(edge);inward=np.array([-edge[1],edge[0]])/length
            for along in np.arange(11/MM,length-11/MM,19/MM):
                point=a+edge*along/length
                coords=point[:,None]+inward[:,None]*cross/MM
                values=gaussian_filter1d(sample(luma,coords[0],coords[1]),1.0)
                low=np.median(values[cross<=-4]);high=np.median(values[cross>=4])
                if high-low<12:skipped+=1;continue
                half=(low+high)*.5;zc=np.flatnonzero((values[:-1]<half)&(values[1:]>=half))
                if not len(zc):skipped+=1;continue
                positions=cross[zc]+.25*(half-values[zc])/(values[zc+1]-values[zc])
                offset=float(positions[np.argmin(abs(positions))])
                samples.append([s['name'],float(point[0]%N),float(point[1]%N),offset])
    offsets=np.abs(np.array([s[3] for s in samples]))
    metrics['registration']['albedo_edge']={'samples':len(samples),'low_contrast_skipped':skipped,
                                          'mean_mm':float(offsets.mean()),'p95_mm':float(np.percentile(offsets,95)),
                                          'max_mm':float(offsets.max())}
    require(np.percentile(offsets,95)<2.5,'Visible mortar boundary offset')
    stones=[];geometry_errors=[];macro_errors=[];fitted_crowns=[]
    fit=meta['macro_fit']
    def fitted(h):return fit['mortar_mm']+fit['amplitude_mm']*(1-np.exp(-h/fit['decay_mm']))
    for i,s in enumerate(layout['stones']):
        m=faces==i;safe_face=m&(face_distance>3)
        vals=residual[safe_face];p=np.percentile(vals,[1,50,99])
        stones.append({'name':s['name'],'surface':meta['stones'][i]['surface'],
                       'mean_srgb':base[m].mean(0).tolist(),'surface_relief_p01_p50_p99_mm':p.tolist(),
                       'surface_relief_min_max_mm':[float(vals.min()),float(vals.max())],
                       'face_height_mean_mm':float(height[safe_face].mean())})
        triangles,peak=model_triangles(s)
        for vertices,levels in triangles:
            # Interior barycentres avoid texel interpolation at sharp triangle edges.
            point=vertices.mean(0);expected_model=float(levels.mean())
            geometry_errors.append(abs(float(sample(model_height,point[0],point[1]))-expected_model))
            expected_macro=fitted(expected_model)
            macro_errors.append(abs(float(sample(macro,point[0],point[1]))-expected_macro))
        stones[-1].update({'model_crown_mm':s['crown_mm'],'model_peak_mm':peak,
                           'fitted_peak_mm':fitted(peak),
                           'macro_face_range_mm':[float(macro[safe_face].min()),float(macro[safe_face].max())]})
        require(p[2]-p[0]>=1 and vals.max()-vals.min()<=13,'Surface relief range: '+s['name'])
        fitted_crowns.append(float(fitted(peak)-fitted(peak-s['crown_mm'])))
    metrics['stones']=stones
    # Fit the sampled model before filtering, as the authoring raster does.
    # Fitting an interpolated continuous triangle height is not equivalent:
    # the nonlinear curve and subpixel bevel filtering do not commute.
    reference_macro=gaussian_filter(fitted(model_height),.36,mode='wrap')
    fit_errors=np.abs(macro-reference_macro)
    metrics['crown_fit']={'fit':meta['macro_fit'],'triangle_samples':len(geometry_errors),
                          'model_interpolation_error_max_mm':float(max(geometry_errors)),
                          'macro_raster_fit_error_max_mm':float(fit_errors.max()),
                          'continuous_vs_filtered_raster_max_mm':float(max(macro_errors)),
                          'continuous_vs_filtered_raster_p99_mm':float(np.percentile(macro_errors,99)),
                          'model_crown_range_mm':[min(s['crown_mm'] for s in layout['stones']),max(s['crown_mm'] for s in layout['stones'])],
                          'fitted_crown_range_mm':[min(fitted_crowns),max(fitted_crowns)]}
    require(max(geometry_errors)<.1 and fit_errors.max()<.001,'Crown/tilt fit agrees with layout vertices and sampled fit')
    # Prove unchanged named faces keep their approved micro relief and roughness.
    old_der=np.load(ROOT/'round3/derivation.npz');old_meta=json.loads((ROOT/'round3/build_metadata.json').read_text())
    old_h=np.array(Image.open(ROOT/'round3/masonry_height.png'),np.float64)*(48/65535)
    old_res=old_h-old_der['macro_height_mm'];old_orm=np.array(Image.open(ROOT/'round3/masonry_orm.png'))
    old_normal=np.array(Image.open(ROOT/'round3/masonry_normal.png'))
    old_base=np.array(Image.open(ROOT/'round3/masonry_base.png'))
    old_faces=old_der['face_id'];old_distance=old_der['face_distance_mm'];old_ids=old_der['stone_id']
    preserved=[]
    for record in meta['stones']:
        if not record['appearance_reused']:continue
        i=record['index'];oldi=record['previous_index']
        require(np.array_equal(ids==i,old_ids==oldi),'Reused footprint: '+record['name'])
        stable=(faces==i)&(old_faces==oldi)&(face_distance>5)&(old_distance>5)
        error=np.abs(residual[stable]-old_res[stable]);rough_mismatch=int(np.count_nonzero(orm[...,1][stable]!=old_orm[...,1][stable]))
        normal_delta=np.abs(arr['normal'][stable].astype(int)-old_normal[stable].astype(int))
        preserved.append({'name':record['name'],'face_pixels':int(stable.sum()),'max_relief_change_mm':float(error.max()),
                           'roughness_mismatches':rough_mismatch,'normal_max_code_delta':int(normal_delta.max())})
        require(error.max()<.001 and rough_mismatch==0,'Preserved micro surface: '+record['name'])
    metrics['preserved_surfaces']={'count':len(preserved),'rebuilt_count':len(meta['stones'])-len(preserved),'stones':preserved}
    require(len(preserved)==29,'29 unchanged named footprints retained')
    stone_mean=base[face].mean(0);mortar_mean=base[mortar].mean(0)
    metrics['pigment']={'face_mean_srgb':stone_mean.tolist(),'mortar_mean_srgb':mortar_mean.tolist(),
                        'mortar_minus_face_luminance':float((mortar_mean-stone_mean)@np.array([.2126,.7152,.0722])),
                        'stone_mean_luminance_range':[float(min(np.dot(s['mean_srgb'],[.2126,.7152,.0722]) for s in stones)),float(max(np.dot(s['mean_srgb'],[.2126,.7152,.0722]) for s in stones))],
                        'stone_red_minus_blue_range':[float(min(s['mean_srgb'][0]-s['mean_srgb'][2] for s in stones)),float(max(s['mean_srgb'][0]-s['mean_srgb'][2] for s in stones))]}
    require(metrics['pigment']['mortar_minus_face_luminance']<-10,'Mortar must be darker')
    require(metrics['pigment']['stone_red_minus_blue_range'][0]>5,'No blue stone family')
    green_excess=base[...,1].astype(float)-.5*(base[...,0].astype(float)+base[...,2].astype(float))
    old_green_excess=old_base[...,1].astype(float)-.5*(old_base[...,0].astype(float)+old_base[...,2].astype(float))
    metrics['pigment']['face_green_excess_median']=float(np.median(green_excess[face]))
    metrics['pigment']['round3_face_green_excess_median']=float(np.median(old_green_excess[old_der['face_id']>=0]))
    seams={}
    for k in names:
        a=height if k=='height' else arr[k].astype(np.float64)
        if a.ndim==2:a=a[...,None]
        sx=np.abs(a[:,0]-a[:,-1]).mean();sy=np.abs(a[0]-a[-1]).mean()
        cx=np.abs(np.diff(a,axis=1)).mean((0,2));cy=np.abs(np.diff(a,axis=0)).mean((1,2))
        seams[k]={'x_wrap_mean':float(sx),'x_interior_p95':float(np.percentile(cx,95)),
                  'y_wrap_mean':float(sy),'y_interior_p95':float(np.percentile(cy,95)),
                  'units':'mm' if k=='height' else '8-bit levels'}
        require(sx<np.percentile(cx,95)*1.3 and sy<np.percentile(cy,95)*1.3,k+' wrap discontinuity')
    metrics['seams']=seams
    yy,xx=np.mgrid[:N,:N];xm=(xx-(N-1)/2)/N;ym=(yy-(N-1)/2)/N
    metrics['base_best_fit_ramp_levels']={'x':float(np.mean((luma-luma.mean())*xm)/np.mean(xm*xm)),
                                        'y':float(np.mean((luma-luma.mean())*ym)/np.mean(ym*ym))}
    displays={k:(Image.fromarray(np.rint(height/48*255).astype(np.uint8)) if k=='height' else ims[k]) for k in names}
    sheet([(displays[k],f'masonry_{k}') for k in names],OUT/'layers.jpg',768,4)
    sheet([(Image.fromarray(np.roll(np.roll(np.array(displays[k]),N//2,0),N//2,1)),f'{k}: half-tile offset') for k in names],OUT/'offset.jpg',768,4)
    tile3(ims['base'],OUT/'tiled3x3.jpg')
    overlay=ims['base'].copy();draw=ImageDraw.Draw(overlay)
    for stone in layout['stones']:
        for key,color in [('footprint_metres',(245,66,96)),('face_metres',(68,225,213))]:
            c=np.array(stone[key])*N/3
            for shift in [-N,0,N]:
                coords=[(float(x+shift),float(y)) for x,y in c]
                draw.line(coords+[coords[0]],fill=color,width=2)
    edge=metrics['registration']['albedo_edge']
    sheet([(ims['base'],'Base color'),(overlay,'Pink: footprint / cyan: face ring'),
           (displays['height'],f'Visible edge p95 {edge["p95_mm"]:.2f} mm; exact polygon IDs')],OUT/'registration.jpg',1024,3)
    s=base.astype(np.float32)/255;linear=np.where(s<=.04045,s/12.92,((s+.055)/1.055)**2.4)
    lights=[('Upper left',[-.65,.65,.7]),('Upper right',[.65,.65,.7]),('Lower left',[-.65,-.65,.7]),('Lower right',[.65,-.65,.7])]
    def relight(normals,geometry=None):
        images=[]
        for label,light in lights:
            light=np.array(light);light/=np.linalg.norm(light)
            lambert=np.maximum(0,(normals*light).sum(-1));shadow=1
            if geometry is not None:
                # Periodic height-field shadow approximation only for the mesh preview.
                horizontal=np.hypot(light[0],light[1]);obscure=np.zeros((N,N),np.float32)
                for distance in np.arange(2,52,2):
                    shiftx=int(round(distance*light[0]/horizontal));shifty=int(round(-distance*light[1]/horizontal))
                    above=np.roll(np.roll(geometry,-shifty,0),-shiftx,1)-geometry-distance*MM*light[2]/horizontal
                    obscure=np.maximum(obscure,above)
                shadow=1-.72*np.clip(gaussian_filter(obscure,1.0)/2.5,0,1)
            lit=linear*(.31+.86*(lambert*shadow)[...,None])*(.72+.28*orm[...,0:1]/255)
            rgb=np.where(lit<=.0031308,12.92*lit,1.055*np.maximum(lit,0)**(1/2.4)-.055)
            images.append((Image.fromarray(np.rint(np.clip(rgb,0,1)*255).astype(np.uint8)),label))
        return images
    relit=relight(normal);sheet(relit,OUT/'relit.jpg',1024,2)
    # Full-height normal is useful for flat LOD diagnostics and remains in checks/.
    flat_normal=normal_from_height(height)
    Image.fromarray(np.rint((flat_normal*.5+.5)*255).astype(np.uint8)).save(OUT/'flat_lod_normal.png')
    encoded_flat=np.array(Image.open(OUT/'flat_lod_normal.png'),np.float64)/127.5-1
    encoded_flat/=np.linalg.norm(encoded_flat,axis=-1,keepdims=True)
    flat_error=np.degrees(np.arccos(np.clip((flat_normal*encoded_flat).sum(-1),-1,1)))
    metrics['flat_lod_normal_error_degrees']={'mean':float(flat_error.mean()),'max':float(flat_error.max())}
    require(flat_error.max()<.4,'Full-height LOD normal')
    sheet(relight(flat_normal),OUT/'flat_lod_relit.jpg',1024,2)
    geometry=model_height+residual
    model_relit=relight(normal_from_height(geometry),geometry)
    sheet([(im,label+' | layout geometry approximation') for im,label in model_relit],OUT/'geometry_relit.jpg',1024,2)
    tile3(model_relit[0][0],OUT/'geometry_tiled3x3.jpg')
    # A consistent cool environment comparison, not a claim about the engine sky.
    cool=np.array([.86,.94,1.13],np.float32)
    def cool_image(picture):
        x=np.array(picture,np.float32)/255
        lin=np.where(x<=.04045,x/12.92,((x+.055)/1.055)**2.4)*cool
        rgb=np.where(lin<=.0031308,12.92*lin,1.055*np.maximum(lin,0)**(1/2.4)-.055)
        return Image.fromarray(np.rint(np.clip(rgb,0,1)*255).astype(np.uint8))
    sheet([(model_relit[0][0],'Neutral light | geometry approximation'),
           (cool_image(model_relit[0][0]),'Cool sky diagnostic | same exposure')],OUT/'cool_sky.jpg',1024,2)
    comparison=[]
    matched=['k0s1','k0s2','k3s0','k7s2']
    for source,label in [(Image.fromarray(old_base),'Round 3'),(ims['base'],'Round 4'),
                         (cool_image(Image.fromarray(old_base)),'Round 3 / cool'),(cool_image(ims['base']),'Round 4 / cool')]:
        a=np.array(source)
        for name in matched:
            stone=next(s for s in layout['stones'] if s['name']==name)
            cx,cy=np.rint(np.array(stone['face_metres']).mean(0)*N/3).astype(int)
            ys=np.arange(cy-128,cy+128)%N;xs=np.arange(cx-128,cx+128)%N
            comparison.append((Image.fromarray(a[ys[:,None],xs[None,:]]),label+' / '+name))
    sheet(comparison,OUT/'palette_comparison.jpg',256,4)
    selections=[];seen=set()
    for record in meta['stones']:
        if record['surface'] not in seen:seen.add(record['surface']);selections.append(record)
    crops=[]
    for picture,label in [(ims['base'],'Albedo'),(relit[0][0],'Detail light'),(model_relit[0][0],'With model shape')]:
        a=np.array(picture)
        for record in selections:
            c=np.array(layout['stones'][record['index']]['face_metres'])*N/3;cx,cy=np.rint(c.mean(0)).astype(int)
            ys=np.arange(cy-160,cy+160)%N;xs=np.arange(cx-160,cx+160)%N
            crops.append((Image.fromarray(a[ys[:,None],xs[None,:]]),label+': '+record['surface']))
    sheet(crops,OUT/'surface_samples.jpg',320,5)
    sheet([(displays[k].crop((540,540,1052,1052)),k+': native 512 px crop') for k in names],OUT/'detail.jpg',512,4)
    metrics['failures']=failures
    (OUT/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
    (OUT/'registration_samples.json').write_text(json.dumps(samples)+'\n')
    report=json.dumps({k:v for k,v in metrics.items() if k!='stones'},indent=2)
    status='FAIL: '+', '.join(failures) if failures else 'PASS: formats, mean, footprint/face registration, 48 mm height, normal convention/scale, ORM, seams.'
    (OUT/'validation.txt').write_text(report+'\n'+status+'\n')
    print(report+'\n'+status)
    assert not failures,status


if __name__=='__main__':main()

#!/usr/bin/env python3
"""Validate the delivered PNGs and render diagnostic inspection sheets."""
from pathlib import Path
import json
import struct
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import gaussian_filter, label, map_coordinates, binary_fill_holes
from geometry import ROOT,N,MM,load_geometry

OUT=ROOT/'checks';OUT.mkdir(exist_ok=True)
FONT=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',18)


def rgb(a):
    a=np.asarray(a)
    if a.ndim==2:a=np.repeat(a[:,:,None],3,axis=-1)
    return Image.fromarray(np.clip(np.rint(a),0,255).astype(np.uint8))


def sheet(items,cols,size,name,footer=None):
    rows=(len(items)+cols-1)//cols
    out=Image.new('RGB',(cols*size,rows*(size+36)+(50 if footer else 0)),(24,25,26))
    dr=ImageDraw.Draw(out)
    for i,(title,im) in enumerate(items):
        x,y=(i%cols)*size,(i//cols)*(size+36)
        dr.text((x+10,y+8),title,font=FONT,fill=(230,228,223))
        out.paste(im.resize((size,size),Image.Resampling.LANCZOS),(x,y+36))
    if footer:dr.text((12,rows*(size+36)+10),footer,font=FONT,fill=(230,228,223))
    out.save(OUT/name,quality=94,subsampling=0)


def stats(a):
    return {str(p):float(np.percentile(a,p)) for p in [0,1,50,99,100]}


def gradients(h):
    gx=np.empty_like(h);gy=np.empty_like(h)
    gx[:,1:-1]=(h[:,2:]-h[:,:-2])/(2*MM)
    gx[:,0]=(h[:,1]-h[:,-1])/(2*MM);gx[:,-1]=(h[:,0]-h[:,-2])/(2*MM)
    gy[1:-1]=(h[2:]-h[:-2])/(2*MM)
    gy[0]=(h[1]-h[-1])/(2*MM);gy[-1]=(h[0]-h[-2])/(2*MM)
    n=np.stack([-gx,gy,np.ones_like(h)],-1)
    return n/np.linalg.norm(n,axis=-1,keepdims=True)


def tiling(im,turned=False):
    im=im.resize((768,768),Image.Resampling.LANCZOS)
    result=Image.new('RGB',(2304,2304))
    for y in range(3):
        for x in range(3):
            t=im.transpose(Image.Transpose.ROTATE_90) if turned and (x+y)%2 else im
            result.paste(t,(x*768,y*768))
    return result


def srgb_to_linear(c):
    return np.where(c<=.04045,c/12.92,((c+.055)/1.055)**2.4)


def linear_to_srgb(c):
    return np.where(c<=.0031308,12.92*c,1.055*np.maximum(c,0)**(1/2.4)-.055)


def shade(albedo,n,orm,light,view=None,shadow=1):
    light=np.asarray(light,dtype=float);light/=np.linalg.norm(light)
    if view is None:view=np.array([0.,0.,1.])
    half=view+light;half/=np.linalg.norm(half,axis=-1,keepdims=True)
    nl=np.maximum((n*light).sum(-1),0)
    nv=np.maximum((n*view).sum(-1),.001)
    nh=np.maximum((n*half).sum(-1),0)
    a2=orm[:,:,1]**4
    d=a2/(np.pi*(nh*nh*(a2-1)+1)**2)
    k=(orm[:,:,1]+1)**2/8
    g=nl/(nl*(1-k)+k)*nv/(nv*(1-k)+k)
    spec=.04*d*g/np.maximum(4*nv*nl,.001)
    c=albedo*(.32*orm[:,:,0,None]+1.08*(nl*shadow)[:,:,None])+(.75*spec*nl*shadow)[:,:,None]
    return rgb(linear_to_srgb(c)*255)


def registration(layout,base,ids):
    # Locate the delivered albedo step along the normal of each footprint
    # segment. Compare it with both vector boundaries and the supplied raster.
    lum=.2126*base[:,:,0]+.7152*base[:,:,1]+.0722*base[:,:,2]
    # Independent segmentation of the delivered base: mortar and the rock
    # boundary have a deliberate reflectance gap. Interior fossil lows are
    # filled, leaving the observable outer paint boundary, not its author mask.
    painted=binary_fill_holes(lum>103)
    mismatch=int(np.count_nonzero(painted!=(ids>0)))
    offsets=np.arange(-3,3.01,.125)
    vector_errors=[];raster_errors=[];contrasts=[]
    for i,s in enumerate(layout['stones']):
        ownership=(ids==i+1).astype(np.float32)
        p=np.asarray(s['footprint_pixels'])
        for a,b in zip(p,np.roll(p,-1,axis=0)):
            v=b-a;length=np.linalg.norm(v)
            if length<12:continue
            inward=np.array([-v[1],v[0]])/length
            for t in np.arange(5,length-5,7):
                point=a+v*t/length
                samples=point[None,:]+offsets[:,None]*inward
                # Sampling convention is pixel centres x+.5, y+.5.
                coord=[samples[:,1]-.5,samples[:,0]-.5]
                profile=map_coordinates(lum,coord,order=1,mode='grid-wrap')
                target=map_coordinates(ownership,coord,order=1,mode='grid-wrap')
                cp=np.gradient(gaussian_filter(profile,.65))
                tp=np.gradient(gaussian_filter(target,.65))
                where=offsets[np.argmax(cp)];ref=offsets[np.argmax(tp)]
                vector_errors.append(abs(where)*MM)
                raster_errors.append(abs(where-ref)*MM)
                contrasts.append(profile[-1]-profile[0])
    return {'delivered_base_footprint_mismatch_pixels':mismatch,'segmentation_threshold_srgb':103,
            'samples':len(vector_errors),'albedo_boundary_to_vector_mm':stats(vector_errors),
            'albedo_boundary_to_supplied_raster_mm':stats(raster_errors),'boundary_material_contrast_srgb':stats(contrasts)}


def mark_audit(base,ids,distance):
    lum=.2126*base[:,:,0]+.7152*base[:,:,1]+.0722*base[:,:,2]
    broad=gaussian_filter(lum,5)-gaussian_filter(lum,30)
    candidates=[]
    for i in range(1,16):
        score=np.abs(broad)*((ids==i)&(distance>110))
        for _ in range(4):
            y,x=np.unravel_index(np.argmax(score),score.shape)
            if score[y,x]<=0:break
            patch=broad[y-36:y+37,x-36:x+37:2][::2].copy()
            patch-=patch.mean();patch/=max(np.linalg.norm(patch),1e-9)
            candidates.append((i,int(x),int(y),patch))
            score[max(0,y-90):y+91,max(0,x-90):x+91]=0
    best=[]
    for a,(ia,xa,ya,pa) in enumerate(candidates):
        for ib,xb,yb,pb in candidates[a+1:]:
            if ia==ib:continue
            corr=max(float((pa*np.rot90(pb,k)).sum()) for k in range(4))
            corr=max(corr,max(float((pa*np.rot90(pb[:,::-1],k)).sum()) for k in range(4)))
            best.append((corr,ia,xa,ya,ib,xb,yb))
    best.sort(reverse=True)
    items=[]
    im=rgb(base)
    for corr,ia,xa,ya,ib,xb,yb in best[:4]:
        for sid,x,y in [(ia,xa,ya),(ib,xb,yb)]:
            items.append((f'Flag {sid} / candidate correlation {corr:.3f}',im.crop((x-70,y-70,x+70,y+70))))
    sheet(items,4,320,'mark_audit.jpg',f'{len(candidates)} prominent regions, {len(best)} cross-flag pairs, 8 rotations/reflections. Visual review remains necessary.')
    return {'candidate_regions':len(candidates),'cross_flag_pairs':len(best),'highest_correlation':best[0][0],
            'top_pairs':[list(r) for r in best[:10]]}


def underfoot(base,h,normal,orm):
    w,hh=1440,1000;yy,xx=np.mgrid[:hh,:w]
    camera=np.array([1.5,1.65,-.7]);target=np.array([1.5,0,1.55])
    forward=target-camera;forward/=np.linalg.norm(forward)
    right=np.cross(forward,[0,1,0]);right/=np.linalg.norm(right)
    up=np.cross(right,forward);fov=np.tan(np.deg2rad(60/2))
    rays=forward+((xx+.5)/w*2-1)[:,:,None]*right*fov+((.5-(yy+.5)/hh)*2)[:,:,None]*up*fov*hh/w
    t=-camera[1]/rays[:,:,1]
    # Intersect the actual millimetre height field, not a flat textured box.
    for _ in range(4):
        hit=camera+rays*t[:,:,None]
        coords=np.array([hit[:,:,2]/3*N-.5,hit[:,:,0]/3*N-.5])
        z=map_coordinates(h,coords,order=1,mode='grid-wrap')/1000
        t=(z-camera[1])/rays[:,:,1]
    hit=camera+rays*t[:,:,None]
    coords=np.array([hit[:,:,2]/3*N-.5,hit[:,:,0]/3*N-.5])
    def sample(a):return np.stack([map_coordinates(a[:,:,c],coords,order=1,mode='grid-wrap') for c in range(a.shape[2])],-1)
    alb=sample(srgb_to_linear(base/255))
    nt=sample(normal);nt/=np.linalg.norm(nt,axis=-1,keepdims=True)
    nw=np.stack([nt[:,:,0],nt[:,:,2],-nt[:,:,1]],-1)
    mat=sample(orm);view=camera-hit;view/=np.linalg.norm(view,axis=-1,keepdims=True)
    light=np.array([-.45,.7,-.5]);light/=np.linalg.norm(light)
    shadow=np.ones((hh,w),np.float32)
    for length in np.linspace(.002,.035,14):
        q=hit+light*length
        c=np.array([q[:,:,2]/3*N-.5,q[:,:,0]/3*N-.5])
        z=map_coordinates(h,c,order=1,mode='grid-wrap')/1000
        shadow=np.minimum(shadow,np.clip((q[:,:,1]-z)/.0015+.5,0,1))
    out=shade(alb,nw,mat,light,view,shadow)
    out.save(OUT/'underfoot.jpg',quality=95,subsampling=0)


def main():
    names=['flags_base','flags_height','flags_normal','flags_orm']
    images={n:Image.open(ROOT/(n+'.png')) for n in names}
    formats={}
    for name,im in images.items():
        width,height,depth,color=struct.unpack('>IIBB',(ROOT/(name+'.png')).read_bytes()[16:26])
        formats[name]={'size':[width,height],'bits':depth,'png_color_type':color,'srgb_profile':bool(im.info.get('icc_profile'))}
        assert (width,height)==(N,N)
        assert depth==(16 if name=='flags_height' else 8)
        assert color==(0 if name=='flags_height' else 2)
        assert bool(im.info.get('icc_profile'))==(name=='flags_base')
    base=np.asarray(images['flags_base'],np.float64)
    h=np.asarray(images['flags_height'],np.float64)*16/65535
    normal=np.asarray(images['flags_normal'],np.float64)/127.5-1
    normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
    orm=np.asarray(images['flags_orm'],np.float64)/255
    manifest=json.loads((ROOT/'build/manifest.json').read_text())
    layout,expected_ids,expected_faces,geometry,patches=load_geometry()
    fields=np.load(ROOT/'build/fields.npz');ids=fields['ids'];faces=fields['face_ids']
    distance=fields['distance_mm'].astype(np.float32)
    mismatch=int(np.count_nonzero(ids!=expected_ids));fmismatch=int(np.count_nonzero(faces!=expected_faces))
    assert mismatch==fmismatch==0
    assert np.array_equal(geometry,fields['geometry_mm'])
    derive_h=h-geometry if manifest['normal_mode']=='detail' else h
    expected=gradients(derive_h)
    error=np.rad2deg(np.arccos(np.clip((normal*expected).sum(-1),-1,1)))
    assert error.max()<.5
    mean=base.mean((0,1));assert np.all(abs(mean-[132,128,120])<=8)
    assert np.all(orm[:,:,2]==0)
    top=(faces>0)&(distance>45);mortar=ids==0
    assert orm[top,1].min()>=.55 and orm[top,1].max()<=.75
    components,count=label(h>6);assert count==15, count
    seam={};normal_seam={}
    for name,a in [('base',base),('height_mm',h),('orm',orm*255)]:
        seam[name]={}
        for k in range(4):
            b=np.rot90(a,k)
            maximum=max(float(abs(a[:,-1]-b[:,0]).max()),float(abs(a[-1]-b[0]).max()))
            seam[name][str(k*90)]=maximum
            assert maximum==0,(name,k,maximum)
    for k in range(4):
        b=np.rot90(normal,k).copy();x,y=b[:,:,0].copy(),b[:,:,1].copy()
        c,s=round(np.cos(k*np.pi/2)),round(np.sin(k*np.pi/2))
        b[:,:,0]=c*x-s*y;b[:,:,1]=s*x+c*y
        normal_seam[str(k*90)]=float(np.rad2deg(np.arccos(np.clip((normal[:,-1]*b[:,0]).sum(-1),-1,1))).max())
    assert max(normal_seam.values())<.65
    reg=registration(layout,base,ids)
    assert reg['delivered_base_footprint_mismatch_pixels']==0
    assert reg['albedo_boundary_to_supplied_raster_mm']['99']<1.5
    assert reg['albedo_boundary_to_vector_mm']['99']<2.5
    assignments=[(s['source']['atlas'],s['source']['quadrant']) for s in manifest['stones']]
    assert len(set(assignments))==15
    assert np.max(fields['cracks'][faces==0])==0
    audit=mark_audit(base,ids,distance)
    assert audit['highest_correlation']<.9
    stones=[]
    for i,s in enumerate(layout['stones']):
        m=(ids==i+1)&top
        assert np.ptp((h-geometry)[m])<=3.0
        stones.append({'name':s['name'],'mean_rgb':base[m].mean(0).tolist(),
                       'height_mm':stats(h[m]),'detail_height_mm':stats((h-geometry)[m]),
                       'roughness':stats(orm[m,1])})
    metrics={'formats':formats,'mean_srgb':mean.tolist(),'normal_mode':manifest['normal_mode'],
             'height_mm':stats(h),'mortar_height_mm':stats(h[mortar]),'face_height_mm':stats(h[top]),
             'normal_error_degrees':stats(error),'normal_mean_error_degrees':float(error.mean()),
             'footprint_pixels_mismatched':mismatch,'face_pixels_mismatched':fmismatch,
             'components_above_6mm':count,'registration':reg,'metalness_nonzero':0,
             'face_roughness':stats(orm[top,1]),'face_ao':stats(orm[top,0]),
             'mortar_roughness':stats(orm[mortar,1]),'seams_max_error_all_axes':seam,
             'normal_seams_degrees':normal_seam,'unique_source_quadrants':len(set(assignments)),
             'mark_audit':audit,'polish_roughness_correlation':float(np.corrcoef(fields['polish'][top],orm[top,1])[0,1]),
             'stones':stones}
    (OUT/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
    layers=[('BASE / sRGB',images['flags_base']),('HEIGHT / 0 to 16 mm',rgb(h/16*255)),
            ('NORMAL / OpenGL / '+manifest['normal_mode'],images['flags_normal']),('ORM / linear',images['flags_orm'])]
    sheet(layers,4,640,'layers.jpg')
    sheet([(t,rgb(np.roll(np.asarray(im),(N//2,N//2),(0,1)))) for t,im in layers],4,640,'offset.jpg')
    repeat=tiling(images['flags_base']);turned=tiling(images['flags_base'],True)
    repeat.save(OUT/'tiled3x3_regular.jpg',quality=94,subsampling=0)
    turned.save(OUT/'tiled3x3_rotated.jpg',quality=94,subsampling=0)
    sheet([('3 x 3 / 9 m square',repeat),('3 x 3 / alternate tiles quarter-turned',turned)],2,1536,'tiled3x3.jpg')
    overlay=images['flags_base'].copy();dr=ImageDraw.Draw(overlay)
    for s in layout['stones']:
        p=[tuple(v) for v in s['footprint_pixels']];f=[tuple(v) for v in s['face_pixels']]
        dr.line(p+[p[0]],fill=(235,79,44),width=1);dr.line(f+[f[0]],fill=(70,214,208),width=1)
    sheet([('Orange: footprint / cyan: face ring',overlay),('Footprint and face detail',overlay.crop((600,820,1112,1332)))],2,1024,'registration.jpg',
          f"{reg['samples']} profiles. Raster boundary p99 {reg['albedo_boundary_to_supplied_raster_mm']['99']:.3f} mm. Ownership mismatch: 0 pixels.")
    lighting=[('Left',[-.8,0,.6]),('Right',[.8,0,.6]),('Above',[0,.8,.6]),('Below',[0,-.8,.6])]
    alb=srgb_to_linear(base/255)
    sheet([(title+' / delivered normal',shade(alb,normal,orm,l)) for title,l in lighting],2,1024,'relit.jpg')
    full=gradients(h)
    sheet([(title+' / geometry plus detail',shade(alb,full,orm,l)) for title,l in lighting],2,1024,'model_relit.jpg')
    underfoot(base,h,full,orm)
    sheet([('Roughness / brighter is rougher',rgb(orm[:,:,1]*255)),('AO / cavities only',rgb(orm[:,:,0]*255))],2,1024,'roughness_ao.jpg')
    sheet([('Geometry height / 0 to 16 mm',rgb(geometry/16*255)),
           ('Residual height / displayed +/- 1.5 mm',rgb((h-geometry+1.5)/3*255)),
           ('Detail normal crop',images['flags_normal'].crop((400,850,1040,1490))),
           ('Base crop / 0.94 m wide',images['flags_base'].crop((400,850,1040,1490)))],2,640,'detail.jpg')
    slab_items=[]
    for p in patches:
        sl=p['sl'];box=(sl[1].start,sl[0].start,sl[1].stop,sl[0].stop)
        slab_items.append((p['stone']['name'],images['flags_base'].crop(box)))
    sheet(slab_items,5,360,'slab_audit.jpg')
    print(json.dumps({k:metrics[k] for k in ['mean_srgb','normal_mode','normal_mean_error_degrees','registration','face_height_mm','face_roughness','unique_source_quadrants']},indent=2))
    print('All checks passed; diagnostic images rebuilt.')


if __name__=='__main__':main()

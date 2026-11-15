#!/usr/bin/env python3
"""Independent saved-PNG checks, review sheets, opposite-light diagnostics.

Use --rebuild to also check byte-for-byte reproducibility. This verifier never
imports the builder or its normal routine. Diagnostics are not delivery maps.
"""
from pathlib import Path
import argparse
import hashlib
import json
import struct
import subprocess
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import map_coordinates, gaussian_filter

ROOT=Path(__file__).resolve().parent
CHECKS=ROOT/'checks'
PREFIX='stump_cuts_'

def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def stats(a):
    return {k:float(v) for k,v in zip(('min','mean','p05','p50','p95','p99','max'),
            [np.min(a),np.mean(a),*np.percentile(a,[5,50,95,99]),np.max(a)])}

def font(size):
    for name in ['/System/Library/Fonts/Supplemental/Arial.ttf','/System/Library/Fonts/Helvetica.ttc']:
        if Path(name).exists(): return ImageFont.truetype(name,size)
    return ImageFont.load_default(size=size)

def label(im,title):
    out=Image.new('RGB',(im.width,im.height+46),(25,29,28)); out.paste(im,(0,46))
    ImageDraw.Draw(out).text((16,12),title,font=font(19),fill=(230,232,226))
    return out

def grid(images,cols=2):
    w=max(x.width for x in images); h=max(x.height for x in images)
    out=Image.new('RGB',(cols*w,((len(images)+cols-1)//cols)*h),(25,29,28))
    for i,im in enumerate(images): out.paste(im,((i%cols)*w,(i//cols)*h))
    return out

def preview(a):
    if a.dtype!=np.uint8: a=np.uint8(np.clip(a,0,1)*255+.5)
    return Image.fromarray(a)

def srgb_linear(a): return np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)
def linear_srgb(a): return np.where(a<=.0031308,12.92*a,1.055*np.maximum(a,0)**(1/2.4)-.055)

def relight(albedo,n,orm,light,grey=False):
    """Linear diffuse + modest dielectric GGX. No painted-light reuse."""
    c=np.full_like(albedo,.45) if grey else srgb_linear(albedo)
    l=np.array(light,dtype=np.float64); l/=np.linalg.norm(l)
    v=np.array([0.,0.,1.]); half=l+v; half/=np.linalg.norm(half)
    nl=np.maximum(np.sum(n*l,axis=-1),0); nv=np.maximum(n[:,:,2],.001); nh=np.maximum(np.sum(n*half,axis=-1),0)
    vh=np.sum(v*half)
    rough=orm[:,:,1]
    a2=rough**4
    distribution=a2/(np.pi*(nh*nh*(a2-1)+1)**2+1e-7)
    k=(rough+1)**2/8
    g=(nl/(nl*(1-k)+k+1e-7))*(nv/(nv*(1-k)+k+1e-7))
    fresnel=.04+.96*(1-vh)**5
    spec=distribution*g*fresnel/(4*np.maximum(nl*nv,.001))
    ao=orm[:,:,0]
    out=c*(.22*ao+1.12*nl)[:,:,None]+(.75*spec*nl)[:,:,None]
    return np.clip(linear_srgb(out),0,1)

def round2_checks(measurements, arrays, data, meta, check):
    """Measure saved layer behaviour, not just the declared feature count."""
    yy,xx=np.mgrid[:1024,:1024]; radius=np.hypot(xx-511.5,yy-511.5)
    feature_panels=[]
    palette=np.array([[0,0,0],[201,133,97],[117,166,174],[198,181,105],
                      [143,144,190],[139,182,126],[196,135,168]],dtype=np.uint8)
    previous=ROOT/'checks/round1'
    old_base=np.asarray(Image.open(previous/'stump_cuts_base.png')) if previous.exists() else None
    old_height=np.asarray(Image.open(previous/'stump_cuts_height.png')) if previous.exists() else None
    for name,s in meta['patches'].items():
        sl=np.s_[s['y']:s['y']+1024,s['x']:s['x']+1024]
        wood=data[name+'_wood']; hinge=data[name+'_preserve_hinge']
        concrete=data[name+'_concrete']; seams=data[name+'_seams']
        valid=(wood>.999)&(hinge<.01)&(concrete<.001)&(seams<.01)&(radius<365)
        ids=np.rint(data[name+'_facets']).astype(int)
        counts={str(i):int(np.sum((ids==i)&valid)) for i in range(1,7)}
        mm=arrays['height'][sl].astype(float)/65535*48
        # Find vertical and horizontal pixel adjacencies with different facet
        # IDs. Extrapolate each plane back to the boundary from 4 and 10 texels
        # away, separating true steps from broad plane slope.
        steps=[]
        for axis in (0,1):
            edge=(ids!=np.roll(ids,1,axis=axis))&valid
            y,x=np.where(edge); y=y[::5]; x=x[::5]
            dy,dx=(1,0) if axis==0 else (0,1)
            keep=(x>12)&(x<1011)&(y>12)&(y<1011)
            y=y[keep];x=x[keep]
            m4=mm[y-4*dy,x-4*dx]; m10=mm[y-10*dy,x-10*dx]
            p4=mm[y+4*dy,x+4*dx]; p10=mm[y+10*dy,x+10*dx]
            same=(ids[y-4*dy,x-4*dx]==ids[y-10*dy,x-10*dx])
            same&=(ids[y+4*dy,x+4*dx]==ids[y+10*dy,x+10*dx])
            same&=(ids[y-4*dy,x-4*dx]!=ids[y+4*dy,x+4*dx])
            same&=valid[y-10*dy,x-10*dx]&valid[y+10*dy,x+10*dx]
            steps.extend(abs((10*p4-4*p10)/6-(10*m4-4*m10)/6)[same].tolist())
        step=np.asarray(steps)
        ring=data[name+'_rings']; ring_h=data[name+'_ring_height']
        lum=np.sum(arrays['base'][sl]*np.array([.2126,.7152,.0722]),axis=-1)
        residual=lum-gaussian_filter(lum,4)
        corr=float(np.corrcoef(ring[valid],residual[valid])[0,1])
        m=dict(visible_facet_areas_px=counts,facet_step_mm=stats(step),
               ring_relief_mm=stats(ring_h[valid]),ring_to_saved_base_correlation=corr,
               exposed_bark_notch_area_px=float(np.maximum(wood-data[name+'_original_wood'],0).sum()),
               lifted_bark_area_px=float(data[name+'_lift'].sum()),
               check_area_px=float(data[name+'_cracks'].sum()))
        measurements['patches'][name]['round2']=m
        check(name+' six broad visible facets',all(v>12000 for v in counts.values()),counts)
        check(name+' facet steps measured in mm',np.median(step)>2 and np.percentile(step,95)<11,m['facet_step_mm'])
        check(name+' shallow nonzero ring relief',.03<np.std(ring_h[valid]) and np.max(abs(ring_h))<.25,m['ring_relief_mm'])
        check(name+' rings aligned with saved colour',corr>.65,corr)
        check(name+' broken bark notches',m['exposed_bark_notch_area_px']>500,m['exposed_bark_notch_area_px'])
        check(name+' raised bark flanges',m['lifted_bark_area_px']>80,m['lifted_bark_area_px'])
        if name=='oak':
            check('oak fine radial checks',m['check_area_px']>500,m['check_area_px'])
            # Read heartwood hue from delivered RGB, independently of its
            # construction mask. Follow the first boundary out from the pith.
            c=arrays['base'][sl].astype(float)
            chroma=(c[:,:,0]-c[:,:,1])/(c[:,:,0]+c[:,:,1]+1)
            pith=np.array([591,613])-626.5
            pith=pith*(409.6-s['rim_mm']/s['mm_per_pixel'])/588+511.5
            theta=np.linspace(-np.pi,np.pi,720,endpoint=False)
            rr=np.linspace(180,335,620)
            rays=map_coordinates(chroma,[pith[1]+np.sin(theta[:,None])*rr,
                                         pith[0]+np.cos(theta[:,None])*rr],order=1)
            edge=rr[np.argmax(rays<.102,axis=1)]
            # Ignore the protected torn hinge, whose pale fibres cross the core.
            ray_hinge=map_coordinates(hinge,[pith[1]+np.sin(theta)*edge,
                                            pith[0]+np.cos(theta)*edge],order=1)
            edge=edge[ray_hinge<.01]
            m['heartwood_radius_px']=stats(edge)
            check('oak rounded heartwood in saved base',200<np.median(edge)<280 and np.percentile(edge,95)/np.percentile(edge,5)<1.16,m['heartwood_radius_px'])
        if old_base is not None:
            exterior=radius>414
            m['exterior_base_identical']=bool(np.array_equal(arrays['base'][sl][exterior],old_base[sl][exterior]))
            preserved=(hinge>.999)&(wood>.999)
            # h is lightly filtered at delivery, so verify the interior of the
            # protected band rather than its deliberately blended shoulder.
            from scipy.ndimage import binary_erosion
            preserved=binary_erosion(preserved,iterations=3)
            m['hinge_base_error_max']=int(abs(arrays['base'][sl].astype(int)-old_base[sl].astype(int))[preserved].max())
            m['hinge_height_error_mm_max']=float(abs(arrays['height'][sl].astype(float)-old_height[sl].astype(float))[preserved].max()/65535*48)
            check(name+' original bark colour preserved',m['exterior_base_identical'])
            check(name+' original torn hinge preserved',m['hinge_base_error_max']<=1 and m['hinge_height_error_mm_max']<.02,m)
        id_pic=palette[ids.clip(0,6)]; id_pic[wood<.5]=[31,36,34]
        feature_panels.append(label(Image.fromarray(id_pic).resize((600,600)),name.upper()+' | six facet regions'))
        rp=np.uint8(np.clip(.5+ring_h/.5,0,1)*255)
        feature_panels.append(label(Image.fromarray(rp).convert('RGB').resize((600,600)),name.upper()+' | ring relief +/- 0.25 mm'))
    grid(feature_panels,2).save(CHECKS/'round2_structure.jpg',quality=94)
    if old_base is not None:
        comparisons=[]
        for name,s in meta['patches'].items():
            sl=np.s_[s['y']:s['y']+1024,s['x']:s['x']+1024]
            for a,title in [(old_base[sl],'BEFORE / colour'),(arrays['base'][sl],'ROUND 2 / colour'),
                            (np.uint8(old_height[sl].astype(float)/65535*255),'BEFORE / height'),
                            (np.uint8(arrays['height'][sl].astype(float)/65535*255),'ROUND 2 / height')]:
                comparisons.append(label(Image.fromarray(a).convert('RGB').resize((480,480)),name.upper()+' / '+title))
        grid(comparisons,4).save(CHECKS/'round2_before_after.jpg',quality=95,subsampling=0)

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--rebuild',action='store_true'); args=parser.parse_args()
    CHECKS.mkdir(exist_ok=True)
    meta=json.loads((ROOT/'material.json').read_text())
    data=np.load(ROOT/'derivation.npz')
    measurements=dict(checks=[],files={},patches={},height_range_mm=meta['height_range_mm'],normal_convention=meta['normal_convention'])
    def check(name,condition,details=None):
        measurements['checks'].append(dict(name=name,passed=bool(condition),details=details))
    images={}; arrays={}
    for layer in ['base','height','normal','orm']:
        p=ROOT/(PREFIX+layer+'.png'); im=Image.open(p); images[layer]=im
        raw=np.asarray(im); arrays[layer]=raw
        header=struct.unpack('>IIBBBBB',p.read_bytes()[16:29])
        info=dict(size=list(im.size),mode=im.mode,bit_depth=header[2],png_colour_type=header[3],
                  has_icc='icc_profile' in im.info,sha256=digest(p),bytes=p.stat().st_size)
        measurements['files'][p.name]=info
        check(layer+' dimensions',im.size==(2048,2048))
        check(layer+' bit depth',header[2]==(16 if layer=='height' else 8))
        check(layer+' channels',header[3]==(0 if layer=='height' else 2))
        check(layer+' colour profile',info['has_icc']==(layer=='base'))
        if layer!='base': check(layer+' linear metadata',not any(k in im.info for k in ['srgb','gamma','icc_profile']))
    base=arrays['base']/255.; h=arrays['height'].astype(np.float64)/65535*meta['height_range_mm']
    encoded=arrays['normal'].astype(np.float64)/255*2-1
    length=np.linalg.norm(encoded,axis=-1)
    n=encoded/length[:,:,None]
    orm=arrays['orm']/255.
    check('metalness identically zero',np.count_nonzero(arrays['orm'][:,:,2])==0)
    check('no height saturation',arrays['height'].min()>0 and arrays['height'].max()<65535)
    check('normal hemisphere',bool(np.all(n[:,:,2]>0)))
    check('normal quantization length',float(abs(length-1).max())<.007)
    measurements['normal_lengths']=stats(length)
    angles_all=[]
    yy,xx=np.mgrid[:1024,:1024]; rad=np.hypot(xx-511.5,yy-511.5)
    disc=rad<=409.6
    lits=[]; greys=[]; details=[]; align=[]
    lights=[(-.65,.58,.49),(.65,-.58,.49)]
    for name,s in meta['patches'].items():
        x,y=s['x'],s['y']; sl=np.s_[y:y+1024,x:x+1024]
        p=h[sl]; pitch=s['diameter_mm']/819.2
        # Explicit one-sided edges and central interior stencil, independent of
        # builder np.gradient. No derivatives cross a quadrant boundary.
        dx=np.empty_like(p); dy=np.empty_like(p)
        dx[:,1:-1]=(p[:,2:]-p[:,:-2])/(2*pitch)
        dx[:,0]=(p[:,1]-p[:,0])/pitch; dx[:,-1]=(p[:,-1]-p[:,-2])/pitch
        dy[1:-1]=(p[2:]-p[:-2])/(2*pitch)
        dy[0]=(p[1]-p[0])/pitch; dy[-1]=(p[-1]-p[-2])/pitch
        expected=np.stack([-dx,dy,np.ones_like(dx)],axis=-1)
        expected/=np.linalg.norm(expected,axis=-1,keepdims=True)
        actual=n[sl]
        angular=np.rad2deg(np.arccos(np.clip(np.sum(expected*actual,axis=-1),-1,1)))
        angles_all.append(angular.ravel())
        wood=data[name+'_wood']; cm=data[name+'_concrete']; dm=data[name+'_disc']
        wood_valid=(wood>.995)&(cm<.005)
        area=float(dm.sum()); eq=2*np.sqrt(area/np.pi)
        cx=float((dm*xx).sum()/area); cy=float((dm*yy).sum()/area)
        theta=np.arange(2048)*2*np.pi/2048
        rr=np.linspace(325,413,1761)
        sample=map_coordinates(wood,[511.5+np.sin(theta[:,None])*rr,511.5+np.cos(theta[:,None])*rr],order=1)
        crossing=np.argmin(abs(sample-.5),axis=1)
        rim=(409.6-rr[crossing])*pitch
        m=dict(mm_per_pixel=pitch,square_coverage_mm=s['diameter_mm']/.8,
               normal_error_degrees=stats(angular),disc_normal_error_degrees=stats(angular[disc]),
               height_mm=stats(p[disc]),wood_height_mm=stats(p[wood_valid]),
               roughness_wood=stats(orm[sl][:,:,1][wood_valid]),ao=stats(orm[sl][:,:,0][disc]),
               equivalent_disc_diameter_px=eq,disc_centre_px=[cx,cy],rim_width_mm=stats(rim),
               concrete_area_px=float(cm.sum()),seam_area_px=float(data[name+'_seams'].sum()),
               mean_wood_srgb=list(np.mean(arrays['base'][sl][wood_valid],axis=0)),
               master_fibre_standard_deviation=float(np.std(data[name+'_micro'][wood_valid])))
        measurements['patches'][name]=m
        check(name+' normal agreement',angular.max()<.45 and angular.mean()<.23,m['normal_error_degrees'])
        check(name+' 80 percent disc',abs(eq-819.2)<.15,eq)
        check(name+' disc centered',abs(cx-511.5)<.02 and abs(cy-511.5)<.02)
        intact=data[name+'_original_wood']
        original_sample=map_coordinates(intact,[511.5+np.sin(theta[:,None])*rr,511.5+np.cos(theta[:,None])*rr],order=1)
        original_rim=(409.6-rr[np.argmin(abs(original_sample-.5),axis=1)])*pitch
        m['intact_rim_width_mm']=stats(original_rim)
        check(name+' intact rim 20 to 40 mm',original_rim.min()>19.8 and original_rim.max()<40.2,m['intact_rim_width_mm'])
        check(name+' chipped rim exposes wood',rim.min()<8 and np.mean(rim<19.8)<.22,m['rim_width_mm'])
        check(name+' roughness .75 to .90',m['roughness_wood']['min']>=.75 and m['roughness_wood']['max']<=.90)
        check(name+' height relief present',np.ptp(p[wood_valid])>12)
        check(name+' added fine fibres',m['master_fibre_standard_deviation']>.9)
        check(name+' bark outside disc',np.max(wood[rad>410.5])==0)
        check(name+' nonflat rim',np.std(p[(rad>395)&(rad<409)])>.15)
        check(name+' concrete allocation',(m['concrete_area_px']>8000) if name=='fig' else m['concrete_area_px']==0)
        if name=='banyan': check('banyan fused seams present',m['seam_area_px']>2500)
        for li,light in enumerate(lights):
            title=['upper_left','lower_right'][li]
            lit=relight(base[sl],actual,orm[sl],light)
            grey=relight(base[sl],actual,orm[sl],light,grey=True)
            check(name+' finite '+title+' relighting',bool(np.all(np.isfinite(lit)) and np.all(np.isfinite(grey))))
            # Show only the intended mesh disc, exposing the real bark rim.
            backdrop=np.array([.125,.145,.14])
            for ar in (lit,grey): ar[~disc]=backdrop
            im=preview(lit); im.save(CHECKS/f'{name}_lit_{title}.png')
            g=preview(grey); g.save(CHECKS/f'{name}_clay_{title}.png')
            lits.append(label(im.resize((600,600),Image.Resampling.LANCZOS),f'{name.upper()} | light {title.replace("_"," ")}'))
            greys.append(label(g.resize((600,600),Image.Resampling.LANCZOS),f'{name.upper()} | height-derived relief'))
        # Native-pixel 384px crop around source hinge, transformed approximately.
        crops={'fig':(480,440),'oak':(455,340),'mangrove':(355,535),'banyan':(350,390)}
        u,v=crops[name]; u=min(u,640);v=min(v,640)
        for layer in ['base','height','normal','orm']:
            a=arrays[layer][sl][v:v+320,u:u+320]
            if layer=='height': a=np.uint8(a.astype(np.float64)/65535*255)
            details.append(label(Image.fromarray(a).convert('RGB'),name+' / '+layer))
        # Large aligned concrete / heart / fusion detail uses the actual files.
        if name=='fig':
            for layer in ['base','height','normal','orm']:
                a=arrays[layer][sl][210:530,120:440]
                if layer=='height': a=np.uint8(a.astype(np.float64)/65535*255)
                align.append(label(Image.fromarray(a).convert('RGB'),'CONCRETE / '+layer))

    round2_checks(measurements, arrays, data, meta, check)
    measurements['normal_error_degrees']=stats(np.concatenate(angles_all))
    # Analytical sign checks applied to delivered normals on strong slopes.
    sign_metrics={}
    for name,s in meta['patches'].items():
        x,y=s['x'],s['y']; sl=np.s_[y:y+1024,x:x+1024]
        dy=(h[sl][2:]-h[sl][:-2])/(2*s['mm_per_pixel'])
        strong=abs(dy)>.02
        agree=np.mean(np.sign(encoded[sl][1:-1,:,1][strong])==np.sign(dy[strong]))
        sign_metrics[name]=float(agree)
        check(name+' OpenGL green sign',agree==1.)
    measurements['opengl_green_sign_agreement']=sign_metrics

    layers=[]
    for layer in ['base','height','normal','orm']:
        im=images[layer]
        if layer=='height': im=preview(arrays[layer].astype(np.float64)/65535)
        im=im.convert('RGB').resize((800,800),Image.Resampling.LANCZOS)
        title={'base':'BASE | sRGB reflectance','height':'HEIGHT | linear 16-bit / 48 mm','normal':'NORMAL | OpenGL / physical scale','orm':'ORM | AO, roughness, zero metal'}[layer]
        layers.append(label(im,title))
    grid(layers).save(CHECKS/'layers.jpg',quality=95,subsampling=0)
    grid(lits).save(CHECKS/'relighting.jpg',quality=94,subsampling=0)
    grid(greys).save(CHECKS/'relief_clay.jpg',quality=94,subsampling=0)
    grid(details,4).save(CHECKS/'native_details.jpg',quality=96,subsampling=0)
    grid(align,4).save(CHECKS/'concrete_alignment.jpg',quality=96,subsampling=0)
    overlay=Image.blend(Image.open(ROOT/'guide/layout.png').convert('RGB'),images['base'],.90)
    d=ImageDraw.Draw(overlay)
    for name,s in meta['patches'].items():
        cx=s['x']+511.5;cy=s['y']+511.5
        d.ellipse((cx-409.6,cy-409.6,cx+409.6,cy+409.6),outline=(51,222,220),width=2)
        d.line((cx-10,cy,cx+10,cy),fill=(51,222,220),width=2)
        d.line((cx,cy-10,cx,cy+10),fill=(51,222,220),width=2)
        d.text((s['x']+22,s['y']+22),f'{name.upper()} / {s["diameter_mm"]} mm / 819.2 px',fill=(245,245,234),font=font(22))
    d.line((1024,0,1024,2048),fill=(51,222,220),width=2)
    d.line((0,1024,2048,1024),fill=(51,222,220),width=2)
    overlay.save(CHECKS/'base_over_layout.png')
    channels=[label(preview(orm[:,:,i]).convert('RGB').resize((650,650)),name) for i,name in enumerate(['AO','ROUGHNESS','METALNESS = 0'])]
    grid(channels,3).save(CHECKS/'orm_channels.jpg',quality=94)
    images['base'].resize((1200,1200),Image.Resampling.LANCZOS).save(CHECKS/'base_preview.jpg',quality=95,subsampling=0)
    concept=ROOT/'../../ref/concept/broadleaf/stumps.png'
    if concept.exists():
        ref=Image.open(concept).convert('RGB')
        ref=label(ref.resize((1600,round(ref.height*1600/ref.width))), 'SUPPLIED CONCEPT / stone-hatchet cuts')
        row=grid([label(Image.open(CHECKS/f'{name}_lit_upper_left.png').resize((400,400)),name.upper()+' / revised material') for name in meta['patches']],4)
        compare=Image.new('RGB',(1600,ref.height+row.height),(25,29,28))
        compare.paste(ref,(0,0));compare.paste(row,(0,ref.height))
        compare.save(CHECKS/'concept_comparison.jpg',quality=95,subsampling=0)

    manifest=json.loads((ROOT/'source/manifest.json').read_text())
    for filename,entry in manifest.items():
        p=ROOT/'source'/filename
        check(filename+' original size',list(Image.open(p).size)==entry['size']==[1254,1254])
        check(filename+' frozen hash',digest(p)==entry['sha256'])
    measurements['sources']=manifest
    if args.rebuild:
        paths=[ROOT/(PREFIX+k+'.png') for k in ['base','height','normal','orm']]
        before={p.name:digest(p) for p in paths}
        subprocess.run([sys.executable,str(ROOT/'build_material.py')],check=True,cwd=ROOT)
        after={p.name:digest(p) for p in paths}
        check('byte-identical rebuild',before==after)
        (CHECKS/'rebuild.json').write_text(json.dumps(dict(before=before,after=after,passed=before==after),indent=2)+'\n')
    failures=[x for x in measurements['checks'] if not x['passed']]
    measurements['summary']=dict(passed=len(measurements['checks'])-len(failures),failed=len(failures))
    (CHECKS/'metrics.json').write_text(json.dumps(measurements,indent=2)+'\n')
    print(json.dumps(measurements['summary']))
    print('Normal angular error (degrees):',measurements['normal_error_degrees'])
    if failures:
        print(json.dumps(failures,indent=2)); sys.exit(1)

if __name__=='__main__': main()

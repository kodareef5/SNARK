#!/usr/bin/env python3
"""Independent material checks and review images. No generator/network is needed."""
from pathlib import Path
import json, struct, hashlib
import numpy as np
from scipy.ndimage import label, distance_transform_edt
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parent
OUT=ROOT/'checks';OUT.mkdir(exist_ok=True)
LAYOUT=json.loads((ROOT/'guide/LAYOUT.json').read_text())
META=json.loads((ROOT/'source/build_metadata.json').read_text()) if (ROOT/'source/build_metadata.json').exists() else {}
FONT='/System/Library/Fonts/Helvetica.ttc'

def font(n):
    try:return ImageFont.truetype(FONT,n)
    except OSError:return ImageFont.load_default()

def label_image(im,title):
    im=im.convert('RGB');c=Image.new('RGB',(im.width,im.height+38),(24,28,28));c.paste(im,(0,38))
    ImageDraw.Draw(c).text((12,10),title,font=font(16),fill=(226,230,218))
    return c

def linear(rgb):
    c=rgb/255
    return np.where(c<=.04045,c/12.92,((c+.055)/1.055)**2.4)

def srgb(c):
    c=np.clip(c,0,1)
    return np.uint8(np.clip(np.round(np.where(c<=.0031308,c*12.92,1.055*c**(1/2.4)-.055)*255),0,255))

def area(a,f):
    s=a.shape
    return a.reshape(s[0]//f,f,s[1]//f,f,*s[2:]).mean(axis=(1,3))

def composite(rgb,a,bg=(128,128,128),cut=True):
    mask=(a>=.5).astype(float) if cut else a
    b=np.array(bg)
    out=rgb*mask[:,:,None]+b*(1-mask[:,:,None])
    return Image.fromarray(np.uint8(np.clip(np.round(out),0,255)))

def main():
    metrics={'status':'PASS','files':{},'slots':[],'reduction_method':'Direct box/area averaging of alpha; cutoff >= 0.5. RGB averaged in linear light using the delivered dilated colour; no alpha-coverage rescaling.'}
    names=['base','height','normal','orm'];ims={};arrays={}
    for n in names:
        path=ROOT/f'coconut_frond_{n}.png'
        im=Image.open(path);a=np.array(im);ims[n]=im;arrays[n]=a
        raw=path.read_bytes();width,height,depth,ctype=struct.unpack('>IIBB',raw[16:26])
        expected={'base':(8,6),'height':(16,0),'normal':(8,2),'orm':(8,2)}[n]
        assert im.size==(2048,2048),(n,im.size)
        assert (depth,ctype)==expected,(n,depth,ctype)
        assert bool(im.info.get('icc_profile'))==(n=='base'),(n,'colour profile')
        metrics['files'][n]=dict(file=path.name,mode=im.mode,width=width,height=height,bit_depth=depth,png_color_type=ctype,srgb_profile=bool(im.info.get('icc_profile')),sha256=hashlib.sha256(raw).hexdigest())
    base=arrays['base'];rgb=base[:,:,:3];alpha=base[:,:,3]/255
    h=arrays['height'].astype(np.float64)/65535*.008
    normal=arrays['normal'].astype(float)/127.5-1
    nlen=np.linalg.norm(normal,axis=-1)
    normal/=nlen[:,:,None]
    orm=arrays['orm']
    assert np.all(orm[:,:,2]==0),'metalness'
    # Explicit independent finite differences, including one-sided image boundaries.
    dx=np.empty_like(h);dy=np.empty_like(h)
    sx=1/LAYOUT['pixels_per_metre_across'];sy=1/LAYOUT['pixels_per_metre_along']
    dx[:,1:-1]=(h[:,2:]-h[:,:-2])/(2*sx)
    dx[:,0]=(h[:,1]-h[:,0])/sx;dx[:,-1]=(h[:,-1]-h[:,-2])/sx
    dy[1:-1]=(h[2:]-h[:-2])/(2*sy)
    dy[0]=(h[1]-h[0])/sy;dy[-1]=(h[-1]-h[-2])/sy
    expected=np.stack([-dx,dy,np.ones_like(h)],-1)
    expected/=np.linalg.norm(expected,axis=-1,keepdims=True)
    angles=np.degrees(np.arccos(np.clip((normal*expected).sum(-1),-1,1)))
    metrics['normal_height_agreement_deg']={region:{'mean':float(angles[mask].mean()),'p99':float(np.percentile(angles[mask],99)),'max':float(angles[mask].max())} for region,mask in [('all_pixels',np.ones_like(alpha,bool)),('visible_alpha',alpha>=.5)]}
    assert angles.max()<.5,'normal agreement'
    metrics['normal_encoded_length']={'min':float(nlen.min()),'max':float(nlen.max())}
    metrics['height_full_range_mm']=8.0
    metrics['metalness_nonzero_pixels']=int(np.count_nonzero(orm[:,:,2]))
    overlay=Image.open(ROOT/'guide/layout.png').convert('RGBA');overlay.alpha_composite(ims['base'])
    overlay.convert('RGB').save(OUT/'base_over_layout.png')
    am=Image.fromarray(np.uint8(np.round(alpha*255))).convert('RGB');d=ImageDraw.Draw(am)
    totaloutside=0
    envelopes=[]
    for slot in LAYOUT['slots']:
        x0,x1=slot['x0'],slot['x1'];a=alpha[:,x0:x1];solid=a>=.5
        border=np.zeros_like(solid);border[:,:12]=1;border[:,-12:]=1
        outside=int(np.count_nonzero((a>0)&border));totaloutside+=outside
        assert outside==0,'margin violation'
        labs,count=label(solid,np.ones((3,3)))
        comps=np.bincount(labs.ravel())[1:]
        env=np.zeros_like(solid)
        for row in range(2048):
            ix=np.flatnonzero(solid[row])
            if len(ix):env[row,ix[0]:ix[-1]+1]=True
        globalenv=np.zeros_like(alpha);globalenv[:,x0:x1]=env
        envelopes.append(globalenv)
        di=distance_transform_edt(~solid,return_distances=False,return_indices=True)
        localrgb=rgb[:,x0:x1]
        differences=np.abs(localrgb.astype(int)-localrgb[tuple(di)].astype(int))
        hidden=a==0
        dilerr=int(differences[hidden].max())
        assert dilerr==0,'transparent RGB is not nearest leaf colour'
        stalk_start=int(np.floor(2047-.85*LAYOUT['pixels_per_metre_along']))
        c=slot['midrib_x']-x0
        rows=np.arange(stalk_start+15,2048)
        cols=np.arange(x1-x0)
        bareoutside=int(np.count_nonzero(solid[rows][:,np.abs(cols-c)>12]))
        assert bareoutside==0,'leaflet intrusion into bare stalk'
        vals=orm[:,x0:x1][solid]
        reductions=[]
        for factor in [1,2,4,8,16]:
            aa=area(alpha,factor)
            ee=area(globalenv,factor)
            cut=aa>=.5
            # Fractional envelope weights avoid assigning one atlas-boundary pixel to both slots.
            slotmask=np.zeros_like(alpha);slotmask[:,x0:x1]=1
            weights=area(slotmask,factor)
            covered=float((cut*weights).sum()*factor**2)
            envarea=float(env.sum())
            reductions.append(dict(factor=factor,height_px=2048//factor,alpha_cut_pixels_equivalent_fullres=covered,frond_envelope_area_px=envarea,coverage_of_fullres_row_envelope=covered/envarea,retention_of_fullres_alpha_area=covered/solid.sum(),slot_area_coverage=covered/(2048*(x1-x0))))
        m=dict(slot=slot['slot'],outside_margin_nonzero_alpha_pixels=outside,nonzero_components=int(label(a>0,np.ones((3,3)))[1]),cutout_components=int(count),largest_cutout_component_fraction=float(comps.max()/comps.sum()),transparent_rgb_max_error=dilerr,bare_stalk_intrusions=bareoutside,foot_alpha_max=int(base[-1,x0:x1,3].max()),tip_alpha_max=int(base[0,x0:x1,3].max()),visible_roughness_mean=float(vals[:,1].mean()/255),visible_roughness_range=[float(vals[:,1].min()/255),float(vals[:,1].max()/255)],visible_ao_mean=float(vals[:,0].mean()/255),height_visible_mm_range=[float(h[:,x0:x1][solid].min()*1000),float(h[:,x0:x1][solid].max()*1000)],reductions=reductions)
        assert m['foot_alpha_max']>=128 and m['tip_alpha_max']>=128
        assert m['nonzero_components']==1,'stray alpha islands'
        assert m['cutout_components']==1,'detached alpha-cut fragments'
        assert reductions[3]['coverage_of_fullres_row_envelope']>.5,'eighth mip lost majority coverage'
        if slot['slot']<2:
            assert reductions[3]['coverage_of_fullres_row_envelope']>.5,'live frond mip coverage below majority'
            assert reductions[3]['retention_of_fullres_alpha_area']>.8,'live frond dissolves in mip'
        metrics['slots'].append(m)
        for x in [x0+12,x1-13]:d.line((x,0,x,2047),fill=(233,110,68),width=2)
        d.line((slot['midrib_x'],0,slot['midrib_x'],2047),fill=(94,168,205),width=1)
    metrics['outside_margin_nonzero_alpha_pixels']=totaloutside
    am.save(OUT/'alpha_margins.png')
    # Pixel-native mip comparisons, with labelled sheets and separate exact-size files.
    for bgname,bg in [('grey',(128,128,128)),('sky',(184,211,229))]:
        sheet=Image.new('RGB',(2048,1170),(25,29,29));d=ImageDraw.Draw(sheet)
        d.text((20,14),'COCONUT / alpha cutoff 0.5 / '+bgname,font=font(24),fill=(231,233,216))
        x=0
        for f in [2,4,8,16]:
            aa=area(alpha,f)
            cc=srgb(area(linear(rgb),f))
            im=composite(cc,aa,bg)
            im.save(OUT/f'mip_{2048//f}_{bgname}.png')
            lab=label_image(im,f'1/{f} — {2048//f} px')
            sheet.paste(lab,(x,65));x+=im.width+18
        sheet.save(OUT/f'mips_{bgname}.jpg',quality=95)
    # Four layers on a neutral grey background; data maps masked only for this preview.
    lay=[]
    for n in names:
        if n=='base':im=composite(rgb,alpha,cut=False)
        elif n=='height':im=composite(np.repeat((arrays[n]/257)[:,:,None],3,axis=-1),alpha,cut=False)
        else:im=composite(arrays[n],alpha,cut=False)
        lay.append(label_image(im.resize((1024,1024),Image.Resampling.LANCZOS),{'base':'BASE / sRGB + cutout alpha','height':'HEIGHT / 16 bit / 0–8 mm','normal':'NORMAL / OpenGL / physical scale','orm':'ORM / linear / metalness = 0'}[n]))
    sheet=Image.new('RGB',(2048,2124),(24,28,28))
    for i,im in enumerate(lay):sheet.paste(im,((i%2)*1024,(i//2)*1062))
    sheet.save(OUT/'layers.jpg',quality=96)
    # Two directional-light diagnostics. Deliberately no geometry/lighting in base texture.
    previews=[]
    for title,light in [('Upper left',(-.65,.40,.64)),('Lower right',(.65,-.40,.64))]:
        l=np.array(light);l/=np.linalg.norm(l)
        ndotl=np.maximum(0,(normal*l).sum(-1))
        halfvec=l+np.array([0,0,1]);halfvec/=np.linalg.norm(halfvec)
        spec=np.maximum(0,(normal*halfvec).sum(-1))**(8/(orm[:,:,1]/255)**2)
        result=linear(rgb)*(.37+.73*ndotl[:,:,None])*(.82+.18*orm[:,:,:1]/255)+.06*spec[:,:,None]
        im=composite(srgb(result),alpha,(57,67,73))
        im.save(OUT/('lit_'+title.lower().replace(' ','_')+'.png'))
        previews.append(label_image(im.resize((1024,1024),Image.Resampling.LANCZOS),title+' / identical albedo, opposite light'))
    rel=Image.new('RGB',(2048,1062))
    rel.paste(previews[0],(0,0));rel.paste(previews[1],(1024,0));rel.save(OUT/'relighting.jpg',quality=96)
    # One native-resolution crop per age, with the four layers kept pixel-aligned.
    detail=Image.new('RGB',(1536,4*550),(25,29,29))
    for i,slot in enumerate(LAYOUT['slots']):
        cx=int(slot['midrib_x']);box=(cx-256,950,cx+256,1462)
        for j,n in enumerate(names):
            im=ims[n]
            if n=='height':im=Image.fromarray(np.uint8(arrays[n]/257)).convert('RGB')
            elif n=='base':im=composite(rgb,alpha,(139,148,148),cut=False)
            detail.paste(label_image(im.crop(box),f'{["Mature","Older","Dead"][i]} / {n} / native pixels'),(i*512,j*550))
    detail.save(OUT/'detail.jpg',quality=98)
    (OUT/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
    print(json.dumps({'status':'PASS','outside_margins':totaloutside,'normal_agreement':metrics['normal_height_agreement_deg'],'slots':[{'slot':s['slot'],'eighth':s['reductions'][3],'sixteenth':s['reductions'][4]} for s in metrics['slots']]},indent=2))

if __name__=='__main__':main()

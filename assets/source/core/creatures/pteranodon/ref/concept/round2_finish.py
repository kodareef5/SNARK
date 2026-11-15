"""Round 2 packaging: fixed guide stencils, no spatial warps.

All surface paint is imagegen content. Missing edge coverage is extended from
the nearest interior painted pixel, then clipped by the original guide stencil.
Raw and final measurements are separately saved; constrained metrics are not
presented as independent generator fidelity. Temporary diagnostic region IDs
from this script are replaced by the generated, quantized maps in round2_sheets.
"""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
from scipy import ndimage as ndi
import numpy as np
import json,hashlib
from export_images import extract
R=Path(__file__).resolve().parent
C=R/'checks'/'round2';C.mkdir(exist_ok=True)
BG=np.array([214,212,206],np.uint8)
ORTHO=['top','underside','front','side','folded_side','folded_front']
SADDLED=['saddled_side','saddled_folded_side','saddled_top']
EXTRA=['three_quarter','head_side','head_front','saddled_three_quarter','saddle_detail']
PALETTE=np.array([[0,0,0],[255,0,0],[0,255,0],[0,0,255],[0,255,255],[255,0,255],[255,255,0],[255,255,255]],np.uint8)
def measure(a,b):
    ea=a&~ndi.binary_erosion(a);eb=b&~ndi.binary_erosion(b)
    da=ndi.distance_transform_edt(~eb)[ea];db=ndi.distance_transform_edt(~ea)[eb]
    return {'iou':float((a&b).sum()/(a|b).sum()),'paint_to_guide_max_px':float(da.max()),'guide_to_paint_max_px':float(db.max()),'paint_to_guide_p95_px':float(np.percentile(da,95)),'guide_to_paint_p95_px':float(np.percentile(db,95)),'within_12px':bool(max(da.max(),db.max())<=12)}
def circle(shape,x,y,rx,ry=None):
    yy,xx=np.ogrid[:shape[0],:shape[1]];return ((xx-x)/rx)**2+((yy-y)/(ry or rx))**2<=1
def polygon(shape,points):
    im=Image.new('1',(shape[1],shape[0]));ImageDraw.Draw(im).polygon(points,fill=1);return np.array(im,dtype=bool)
def guide_regions(n,g,a):
    im=np.array(Image.open(R/'blockout_guides'/f'guide_{n}.png').convert('RGB'),float)
    r,gr,b=im.transpose(2,0,1);lab=np.ones(g.shape,np.uint8)
    lab[r/(b+1)>1.025]=6
    lab[(r/(b+1)>1.16)&(r/(gr+1)>1.05)]=2
    lab[b/(r+1)>1.20]=5
    lab[r/(gr+1)>1.30]=3
    lab[~g]=0
    # Smooth pixel-scale material transitions, not geometry.
    scores=np.stack([ndi.gaussian_filter((lab==k).astype(np.float32),1.4) for k in [1,2,3,5,6]])
    lab=np.array([1,2,3,5,6],np.uint8)[np.argmax(scores,axis=0)];lab[~g]=0
    yy,xx=np.indices(g.shape)
    # Single smooth crest band; broadside uses a clean transverse band,
    # viewed edge-on it is narrow, and top projection is on rear crest only.
    if n in ['side','folded_side']:
        dx,dy=(0,0) if n=='side' else (72,-44)
        zone=polygon(g.shape,[(754+dx,731+dy),(780+dx,692+dy),(810+dx,711+dy),(786+dx,756+dy)])
        crest=(yy<865+dy)&(xx>690+dx)&g
        lab[crest&(lab==1)]=3;lab[zone&crest]=4
    elif n in ['front','folded_front']:
        cx=1600 if n=='front' else 800;top=622 if n=='front' else 628
        lab[(lab==1)&(abs(xx-cx)<20)&(yy<820)]=3
        lab[g&(abs(xx-cx)<18)&(yy>top+26)&(yy<top+49)]=4
    elif n=='top':
        lab[g&(abs(xx-1600)<12)&(yy>741)&(yy<762)]=4
    # Eyes are real painted eyes, selected only in known eye neighborhoods.
    eye_centres={'side':[(630,913)],'folded_side':[(672,858)],'front':[(1571,851),(1628,851)],'folded_front':[(772,855),(828,855)],'top':[(1565,599),(1634,599)],'underside':[]}[n]
    for x,y in eye_centres:lab[circle(g.shape,x,y,6,7)&g]=7
    # Use painted claws where visible in the guide-defined hands / feet area.
    orange=lab==3
    appendages=orange&(yy>(1100 if n in ['side','folded_side','folded_front'] else 790))
    nearby=ndi.binary_dilation(appendages,iterations=8)
    lum=a.mean(axis=2);dark=(lum<92)&nearby&g
    lab[dark]=0
    return lab
def regrade_folded_tips(a,lab,n):
    # The front painter omitted dark folded finger ends. Restore exactly the
    # guide marking while retaining the generated leather microtexture.
    if n!='folded_front':return a
    yy,xx=np.indices(lab.shape);sel=(lab==1)&(yy>990)&(yy<1200)&((xx<735)|(xx>865))
    lum=a.mean(axis=2);factor=np.clip(lum/np.median(lum[sel]),.7,1.3)
    color=np.array([46,49,52])[None,None,:]*factor[:,:,None]
    weight=ndi.gaussian_filter(sel.astype(float),1.2)[:,:,None]
    return np.uint8(np.clip(a*(1-weight)+color*weight,0,255))
def export(n):
    p=R/'round2_originals'/f'{n}.png';im=Image.open(p).convert('RGB');source_size=im.size
    gp=R/'blockout_guides'/f'guide_{n}_mask.png'
    constrained=n in ORTHO+SADDLED
    size=Image.open(gp).size if constrained else ((1800,1300) if n=='head_side' else ((1100,1300) if n=='head_front' else im.size))
    im=im.resize(size,Image.Resampling.LANCZOS);a=np.array(im)
    if n in ['side','folded_side','saddled_side','saddled_folded_side']:
        # Shared, imagegen-repaired head surface at one fixed registration.
        # It is a crop replacement (no overlaid second eye or old lower jaw).
        source='common_head_halter.png' if n.startswith('saddled') else 'common_head_repair.png'
        ha=np.array(Image.open(R/'round2_originals'/source).convert('RGB').resize((560,330),Image.Resampling.LANCZOS))
        ox,oy=(352,596) if 'folded' in n else (280,640)
        weight=np.ones((330,560),float);weight[-16:]=np.linspace(1,0,16)[:,None]
        target=a[oy:oy+330,ox:ox+560].astype(float)
        a[oy:oy+330,ox:ox+560]=np.uint8(ha*weight[:,:,None]+target*(1-weight[:,:,None]))
    fg=extract(a)>=128
    raw=fg.copy();stats={'source_size':list(source_size),'output_size':list(size),'source':str(p.relative_to(R)),'fixed_guide_stencil':constrained}
    if constrained:
        g=np.array(Image.open(gp).convert('L'))>=128
        stats['raw']=measure(raw,g)
        stencil=g.copy()
        if n in ['side','folded_side','saddled_side','saddled_folded_side']:
            yy,xx=np.indices(g.shape)
            # The render's 1–2px background slit between the two jaws is an
            # internal hole, not an outside silhouette. Close it in the paint.
            jaw_hole=ndi.binary_fill_holes(g)&~g&(xx<750)&(yy>850)&(yy<950)
            stencil|=jaw_hole
            stats['closed_internal_jaw_slot_pixels']=int(jaw_hole.sum())
        # Extend only missing coverage and the old extracted fringe, without
        # rescaling any limb, landmark or interior texture.
        donors=ndi.binary_erosion(fg,iterations=4)
        idx=ndi.distance_transform_edt(~donors,return_distances=False,return_indices=True)
        repair=stencil&~donors
        a[repair]=a[tuple(idx[:,repair])]
        stats['edge_extension_pixels']=int((g&~fg).sum())
        stats['edge_extension_fraction']=float((g&~fg).sum()/g.sum())
        # Original stencil with 0.55px antialias, no geometric fitting.
        alpha=np.clip(ndi.gaussian_filter(stencil.astype(float),.55)*255,0,255).astype(np.uint8)
        alpha[alpha<2]=0;alpha[alpha>253]=255
        if n in ORTHO:
            lab=guide_regions(n,g,a);a=regrade_folded_tips(a,lab,n)
            Image.fromarray(PALETTE[lab]).save(R/f'regions_{n}.png')
            Image.fromarray(lab).save(C/f'{n}_region_ids.png')
        fg=alpha>=128;stats['final']=measure(fg,g)
    else:
        alpha=(fg*255).astype(np.uint8)
    # Locally repainted rider heads, generated from 4x registered crops.
    # Natural face contours are allowed within an 8px band of the mannequin.
    hp=R/'round2_originals'/f'{n}_head_patch.png'
    if constrained and hp.exists():
        boxes=json.loads((R/'round2_inputs'/'rider_head_boxes.json').read_text())
        x0,y0,x1,y1=boxes[n];w,h=x1-x0,y1-y0
        patch=np.array(Image.open(hp).convert('RGB').resize((w,h),Image.Resampling.LANCZOS))
        pm=extract(patch)>=128;gm=g[y0:y1,x0:x1]
        inside=ndi.distance_transform_edt(gm)>8
        allowed=ndi.distance_transform_edt(~gm)<=8
        mm=(pm&allowed)|inside
        donors=ndi.binary_erosion(pm,iterations=1)
        ix=ndi.distance_transform_edt(~donors,return_distances=False,return_indices=True)
        missing=mm&~donors;patch[missing]=patch[tuple(ix[:,missing])]
        weight=np.ones((h,w),float);weight[-18:]=np.linspace(1,0,18)[:,None]
        orig=a[y0:y1,x0:x1].copy();a[y0:y1,x0:x1]=np.uint8(patch*weight[:,:,None]+orig*(1-weight[:,:,None]))
        pa=ndi.gaussian_filter(mm.astype(float),.55)*255
        alpha[y0:y1,x0:x1]=np.uint8(pa*weight+alpha[y0:y1,x0:x1]*(1-weight))
        fg=alpha>=128;stats['final']=measure(fg,g);stats['rider_head_patch']=str(hp.relative_to(R))
    rgba=Image.fromarray(a);rgba.putalpha(Image.fromarray(alpha));out=Image.new('RGBA',size,tuple(BG)+(255,));out.alpha_composite(rgba);out=out.convert('RGB')
    out.save(R/f'{n}.png');Image.fromarray(alpha).save(C/f'{n}_matte.png')
    if constrained:Image.fromarray(alpha).save(R/f'{n}_mask.png')
    stats['background_exact']=bool(np.all(np.array(out)[alpha==0]==BG))
    stats['sha256']=hashlib.sha256((R/f'{n}.png').read_bytes()).hexdigest()
    if constrained:
        ar=np.array(out);eg=g&~ndi.binary_erosion(g);ea=fg&~ndi.binary_erosion(fg)
        ar[ndi.binary_dilation(eg)]=[0,150,170];ar[ea]=[215,40,110]
        Image.fromarray(ar).save(C/f'{n}_final_overlay.png')
        ar=np.full_like(ar,BG);ar[g&raw]=[115,135,140];ar[g&~raw]=[0,155,175];ar[raw&~g]=[215,40,110]
        Image.fromarray(ar).save(C/f'{n}_raw_difference.png')
    return stats
def main():
    import sys
    names=sys.argv[1:] or ORTHO+SADDLED+EXTRA
    path=C/'export_manifest.json';data=json.loads(path.read_text()) if path.exists() else {}
    for n in names:
        data[n]=export(n);print(n,data[n].get('raw',{}).get('iou'),data[n].get('final',{}))
    path.write_text(json.dumps(data,indent=2))
if __name__=='__main__':main()

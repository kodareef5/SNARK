"""Independent silhouette measurements of generated paintings, never guide masks as outputs."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import numpy as np
from scipy import ndimage as ndi
import json
from export_images import extract
R=Path(__file__).resolve().parent
BG=(214,212,206)
def process(name):
    p=R/'round2_originals'/f'{name}.png'
    gpath=R/'blockout_guides'/f'guide_{name}_mask.png'
    im=Image.open(p).convert('RGB')
    alpha=Image.fromarray(extract(np.array(im)))
    size=Image.open(gpath).size if gpath.exists() else im.size
    rgba=im.copy();rgba.putalpha(alpha);rgba=rgba.resize(size,Image.Resampling.LANCZOS)
    out=Image.new('RGBA',size,BG+(255,));out.alpha_composite(rgba)
    out.convert('RGB').save(R/f'{name}.png')
    m=rgba.getchannel('A');m.save(R/'checks'/'round2'/f'{name}_matte.png')
    if not gpath.exists():return {}
    m.save(R/f'{name}_mask.png')
    a=np.array(m)>=128;b=np.array(Image.open(gpath).convert('L'))>=128
    ea=a&~ndi.binary_erosion(a);eb=b&~ndi.binary_erosion(b)
    d_ab=ndi.distance_transform_edt(~eb)[ea];d_ba=ndi.distance_transform_edt(~ea)[eb]
    stat={'iou':float((a&b).sum()/(a|b).sum()),'paint_to_guide_max_px':float(d_ab.max()),'guide_to_paint_max_px':float(d_ba.max()),'paint_to_guide_p95_px':float(np.percentile(d_ab,95)),'guide_to_paint_p95_px':float(np.percentile(d_ba,95)),'size':list(size),'bbox':list(m.getbbox())}
    ar=np.array(out.convert('RGB'));ar[ndi.binary_dilation(ea)]=[205,35,100];ar[ndi.binary_dilation(eb)]=[0,145,165]
    Image.fromarray(ar).save(R/'checks'/'round2'/f'{name}_overlay.png')
    return stat
if __name__=='__main__':
    import sys
    names=sys.argv[1:] or [p.stem for p in (R/'round2_originals').glob('*.png') if not p.stem.endswith('_v1')]
    f=R/'checks'/'round2'/'measurements.json';stats=json.loads(f.read_text()) if f.exists() else {}
    for n in names:
        stats[n]=process(n);print(n,stats[n])
    f.write_text(json.dumps(stats,indent=2))

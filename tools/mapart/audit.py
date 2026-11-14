"""Verify delivery structure and emit SHA-256 inventory without modifying sources."""
import hashlib,json,struct
from datetime import datetime,timezone
from PIL import Image
import numpy as np
from common import ROOT,CFG,N

def png_info(p):
    with p.open('rb') as f:header=f.read(29)
    assert header[:8]==b'\x89PNG\r\n\x1a\n',p
    w,h,depth,color=struct.unpack('>IIBB',header[16:26])
    return {'width':w,'height':h,'bit_depth':depth,'color_type':color}

def main():
    assert CFG['size_m']==8128 and N==4065
    assert (N-1)*2==127*64
    result={'time_utc':datetime.now(timezone.utc).isoformat(),'layers':{},'zooms':{},'files':{}}
    for p in sorted((ROOT/'base').glob('*.png')):
        info=png_info(p);fine=p.name.endswith('_fine.png')
        assert info['width']==info['height']==(8192 if fine else N),(p,info)
        assert info['bit_depth']==(16 if p.name=='height.png' else 8),(p,info)
        assert info['color_type']==0,(p,info)
        a=np.asarray(Image.open(p));info['minimum']=int(a.min());info['maximum']=int(a.max())
        if p.name!='height.png':info['value_counts']={str(v):int(c) for v,c in zip(*np.unique(a,return_counts=True))}
        result['layers'][p.name]=info
    for z in range(4):
        count=2**z
        expected={f'{x}_{y}.png' for y in range(count) for x in range(count)}
        found={p.name for p in (ROOT/'tiles'/f'z{z}').glob('*.png')}
        assert expected==found,(z,'missing',expected-found,'extra',found-expected)
        for y in range(count):
            for x in range(count):
                p=ROOT/'tiles'/f'z{z}'/f'{x}_{y}.png';info=png_info(p)
                assert info=={'width':1024,'height':1024,'bit_depth':8,'color_type':2},(p,info)
                assert (ROOT/'paintings'/f'z{z}'/f'{x}_{y}.raw.png').exists()
                assert (ROOT/'paintings'/f'z{z}'/f'{x}_{y}.prompt.txt').exists()
        result['zooms'][str(z)]={'tile_count':count*count,'m_per_pixel':8128/(1024*count),'all_originals_present':True}
    # Hash all delivery layers, vector inputs, style, prompts, original/final paint
    # and references. Raw downloads have their separate frozen manifest.
    for folder in ['base','tiles','style','paintings','references']:
        for p in sorted((ROOT/folder).rglob('*')):
            if p.is_file():result['files'][str(p.relative_to(ROOT))]={'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
    dest=ROOT/'reports/round2-delivery-audit.json';dest.parent.mkdir(parents=True,exist_ok=True)
    dest.write_text(json.dumps(result,indent=2))
    print('PASS: 85 RGB tiles, 85 originals, base grid and bit depth,',len(result['files']),'hashed artifacts')

if __name__=='__main__':main()

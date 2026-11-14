"""Prepare one tile's native geometry, overlapping parent context and exact prompt."""
import argparse,json
import numpy as np
from PIL import Image,ImageOps
from common import *

def build(z,only=None):
    ref=ROOT/'references'/f'z{z}';paint=ROOT/'paintings'/f'z{z}';paint.mkdir(parents=True,exist_ok=True)
    geo=Image.open(ref/'whole.png').convert('RGB')
    parent_path=ROOT/'paintings'/f'z{z-1}'/'final-master.png'
    if not parent_path.exists():parent_path=ROOT/'checks'/f'partial_z{z-1}.png'
    par=Image.open(parent_path).convert('RGB').resize(geo.size,Image.Resampling.LANCZOS)
    geo=Image.fromarray(np.pad(np.asarray(geo),((64,64),(64,64),(0,0)),mode='edge'))
    par=Image.fromarray(np.pad(np.asarray(par),((64,64),(64,64),(0,0)),mode='edge'))
    tasks=[]
    previous={}
    if (paint/'queue.json').exists():
        previous={(t['x'],t['y']):t for t in json.loads((paint/'queue.json').read_text())}
    for y in range(2**z):
        for x in range(2**z):
            if only and (x,y) not in only:continue
            # Used prompts and inputs are provenance. Refresh only unpainted tiles.
            if (paint/f'{x}_{y}.raw.png').exists() and (x,y) in previous:
                tasks.append(previous[x,y]);continue
            box=(x*1024,y*1024,x*1024+1152,y*1024+1152)
            geo.crop(box).save(ref/f'{x}_{y}.context.png')
            par.crop(box).save(ref/f'{x}_{y}.parent.png')
            detail={1:'District scale: coherent city blocks, roofless ruin outlines, grove crowns, individual avenues, wharf structures and bridge spans.',2:'Neighborhood scale: individual building shells in their footprints, small broken wall segments, courtyards, palms and mangrove crowns, sandy verges, piers and causeway spans.',3:'Close exploration scale, about one metre per pixel: sharply drawn roofless rooms within actual building footprints, fallen masonry, wall hatching, empty windows, tiny green courtyard growth, palm crowns, individual mangrove roots, ruined bridge piers, eroded road shoulders, creek banks and fine beach/dune marks.'}[z]
            prompt=f'''Use case: style-transfer. Paint the FIRST image as a finished square section of our original drowned Miami expedition atlas. Image 1 is authoritative exact native-scale geometry, with 64 pixels of neighbor overlap around a 1024-pixel tile. KEEP THE ENTIRE FRAMING, do not crop the overlap. Image 2 is the accepted parent painting of exactly the same region and provides the same low-frequency colors and broad watercolor wash. Image 3 is our original style sheet for the artistic hand; do not reproduce its collage layout. Strict orthographic top-down, north up. Every coastline, island, roadway, bridge alignment and building footprint must retain image 1's exact pixel position and shape. Do not invent buildings in empty port yards or parks. {detail} This is a newly painted closer view, with genuinely new crisp pen marks, not an enlargement. Pale warm ivory rag parchment, luminous mineral teal sea, pale jade shallows, olive mangroves, cream sand, limestone ruins with confident fine warm-charcoal quill ink. Exact road corridors are pale paper ribbons with occasional flooded reaches. Rust is very sparse. Retain quiet negative space and beautifully controlled washes. If this region is mostly water, paint mostly water: gentle pigment blooms and a few fine current strokes, no invented islands or wrecks. All drawn symbols must serve a real feature. Same palette as the parent. Miami is low and flat, no mountains. Avoid blurry details, procedural-looking textures, black digital strokes and ornamental decoration. No text, lettering, compass, grid, borders, page edges or vignette. Deliver the entire square map section with rich native-scale detail, edge to edge.'''
            if z>=2:
                prompt+=' In the building footprints, draw roofless masonry rooms, thick broken walls and interior partitions, never generic filled roof slabs. Keep each footprint outer boundary unchanged; make the interior marks individual and legible.'
            (paint/f'{x}_{y}.prompt.txt').write_text(prompt+'\n')
            tasks.append({'z':z,'x':x,'y':y,'prompt':prompt,'references':[str(ref/f'{x}_{y}.context.png'),str(ref/f'{x}_{y}.parent.png'),str(ROOT/'style/style-sheet.png')],'output':str(paint/f'{x}_{y}.raw.png')})
    (paint/'queue.json').write_text(json.dumps(tasks,indent=2))
    print('contexts',z,len(tasks))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('zoom',type=int);a=p.parse_args();build(a.zoom)

"""Prepare round-two neighborhood originals from exact native geometry and new parent."""
import json,sys
import numpy as np
from PIL import Image
from common import ROOT

def build():
 z=2;n=4096;g=64;ref=ROOT/'references/z2';paint=ROOT/'paintings/z2'
 geo=Image.open(ref/'whole.png').convert('RGB')
 par=Image.open(ROOT/'paintings/z1/final-master.png').convert('RGB').resize((n,n),Image.Resampling.LANCZOS)
 geo=Image.fromarray(np.pad(np.array(geo),((g,g),(g,g),(0,0)),mode='edge'));par=Image.fromarray(np.pad(np.array(par),((g,g),(g,g),(0,0)),mode='edge'))
 tasks=[]
 for y in range(4):
  for x in range(4):
   box=(x*1024,y*1024,x*1024+1152,y*1024+1152)
   gp=ref/f'{x}_{y}.context.png';pp=ref/f'{x}_{y}.parent.png';geo.crop(box).save(gp);par.crop(box).save(pp)
   prompt=f'''Use case: style-transfer. Paint this neighborhood-scale square of our original drowned-Miami atlas, zoom 2 tile {x},{y}, about two metres per pixel. Image 1 is the EXACT native map geometry: every building footprint, road, waterway, island and coast. Image 2 is the new accepted district painting of exactly the same region: retain its BROAD COLORS, translucent washes, revealed ivory rag paper, hand-drawn pen quality and district identity, but resolve its schematic symbols into true roofless buildings ON image1's footprints. Image 3 is our original style sheet. Keep the ENTIRE framing, including 64 pixels of overlap at all four edges. North up, orthographic plan. Coast and roads remain EXACT. Draw all building outer walls in their exact footprints; inside them are roofless limestone rooms, broken walls, courtyards, vines and shadowed stair shafts, NOT generic filled roof rectangles. Do not project tall tower icons beyond footprints at this closer scale. More detail than image2, beautifully legible confident pen marks, never a blurred enlargement. Buildings must be economical: warm thin dark ink walls and mostly pale paper interiors. Large areas of exposed ivory parchment between marks, transparent sage wash, directional hatching. No opaque mustard ground, gray slab city, photorealistic texture, glowing outlines or raised-relief bevels. Distinguish districts IF present: port warehouses have long open trusses and sparse rusty beams in empty yards; downtown has densely hatched broken high-rise shafts within footprints; low residential buildings have intimate courtyards; beach hotels have elongated pale galleries and Art Deco wall ribs; parks are wild palms, scrub and mangrove crowns. Flood the low street corridors indicated in the references, expose roots at the shoreline, keep the specified causeway breaks open. Luminous quiet mineral teal water and pale jade shallows following each actual coast; very restrained watercolor blooms and fine currents with paper tooth. Keep the parent's broad color distribution rather than adding dark masses everywhere. No new islands, new buildings in empty yards, boats or wrecks. No text, letters, numbers, grid, compass, border, margins, vignette or page edge. Full-bleed finished square map art, a richly drawn world long after people.'''
   tasks.append({'x':x,'y':y,'z':z,'prompt':prompt,'references':[str(gp),str(pp),str(ROOT/'style/style-sheet.png')],'output':str(paint/f'{x}_{y}.raw.png')})
 (paint/'round2-queue.json').write_text(json.dumps(tasks,indent=2))
 print('prepared',len(tasks),'neighborhood contexts')
if __name__=='__main__':build()

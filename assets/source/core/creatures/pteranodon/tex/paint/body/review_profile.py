#!/usr/bin/env python3
"""Measure delivered profile coverage and verify round 2 changed only neck IDs.

Run after paint.py and check.py; uses locally archived review renders and baseline.
Renderer source is retained as render_details.ts.txt. Measurements
sample the delivered region PNG in projected animal space, including its fringe;
they do not report the requested width as if it were a measured result.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.spatial import cKDTree

from paint import nape_profile, unit

HERE=Path(__file__).resolve().parent
PAINT=HERE.parent
CHECKS=HERE/'checks'
ARCHIVE=HERE/'superseded/checks'


def evidence(path):
    current=CHECKS/path
    return current if current.exists() else ARCHIVE/path


def load(path):
    return np.asarray(Image.open(path))


def main():
    CHECKS.mkdir(exist_ok=True)
    meta=json.loads((PAINT/'pteranodon_pieces.json').read_text())
    ids={p['name']:p['number'] for p in meta['pieces']}
    pieces=load(PAINT/'pteranodon_pieces.png')[...,0]
    neck=pieces==ids['neck']
    lo,hi=np.array(meta['position_box']['min']),np.array(meta['position_box']['max'])
    p=np.stack([load(PAINT/f'pteranodon_position_{a}.png')/65535*(hi[i]-lo[i])+lo[i]
                for i,a in enumerate('xyz')],-1)[neck]
    n=unit(load(PAINT.parent.parent/'ref/bakes/pteranodon_normal_object.png')[...,:3][neck]/127.5-1)
    _,_,_,curve,arc=nape_profile(p,n)
    before=ARCHIVE/'round2_before/layers'
    current=HERE/'layers'
    facts={'changed_texels':{},'changed_outside_neck':{},'profile_sections':[]}
    for layer in ['base','height','rough','occlusion','regions']:
        old=load(before/f'pteranodon_{layer}.png')
        new=load(current/f'pteranodon_{layer}.png')
        changed=np.any(old!=new,axis=-1) if old.ndim==3 else old!=new
        facts['changed_texels'][layer]=int(changed.sum())
        facts['changed_outside_neck'][layer]=int(changed[~neck].sum())
        assert not changed[~neck].any(), f'{layer} changed outside the neck'
        if layer!='regions':
            assert not changed.any(), f'Accepted {layer} changed'
    old=load(before/'pteranodon_regions.png')[neck,1]==0
    new=load(current/'pteranodon_regions.png')[neck,1]==0
    assert np.all(new[old]), 'Accepted dorsal stripe lost coverage'
    facts['region_changes']='ivory to charcoal on neck only'
    tree=cKDTree(p[:,1:])
    depth=np.arange(0,65.01,.25)/1000
    along=np.arange(-10,10.01,.5)/1000
    # Avoid the two cut rings: a perpendicular section needs surface on both
    # sides. The last station is where the widening stripe enters the mantle.
    for label,fraction,target,tolerance in [
        ('behind head',.06,15,3),
        ('one third down',1/3,20,4),
        ('two thirds down',2/3,30,4),
        ('mantle approach',.92,37.5,3.5),
    ]:
        i=int(np.argmin(np.abs(arc/arc[-1]-fraction)))
        tangent=unit(curve[min(i+8,len(curve)-1)]-curve[max(i-8,0)])
        outward=np.array([-tangent[1],tangent[0]])
        yz=curve[i]+along[:,None,None]*tangent-depth[None,:,None]*outward
        distance,near=tree.query(yz)
        valid=distance<.0015
        count=valid.sum(0)
        widths=[]
        for dark in [old,new]:
            coverage=(dark[near]*valid).sum(0)/np.maximum(count,1)
            coverage[count<len(along)*.5]=0
            widths.append(float(coverage.sum()*.25))
        facts['profile_sections'].append({
            'station':label,'silhouette_arc_fraction':fraction,
            'distance_from_head_mm':float(arc[i]*1000),
            'silhouette_yz_m':curve[i].tolist(),'requested_depth_mm':target,
            'before_coverage_depth_mm':widths[0],'after_coverage_depth_mm':widths[1],
        })
        assert abs(widths[1]-target)<=tolerance,(label,widths[1],target)
    facts['measurement']='Dark projected area / 20 mm of contour: equivalent solid-band depth, counting interlocking dark/pale locks. Samples 0.25 mm inward and 0.5 mm along the contour; nearest live texel within 1.5 mm. Both sides share mirrored texels.'
    facts['silhouette_length_mm']=float(arc[-1]*1000)
    (CHECKS/'round2_profile.json').write_text(json.dumps(facts,indent=2)+'\n')
    # Review sheets only; the unmodified game-rendered PNGs remain beside them.
    sheet=Image.new('RGB',(1800,960),(46,46,46));draw=ImageDraw.Draw(sheet)
    for col,view in enumerate(['head','side','rider']):
        for row,(label,folder) in enumerate([('Before','round2_before/look'),('Round 2','look')]):
            im=Image.open(evidence(f'{folder}/{view}_design.png')).convert('RGB')
            sheet.paste(im.resize((600,450),Image.Resampling.LANCZOS),(col*600,row*480+30))
            draw.text((col*600+12,row*480+10),f'{label}: {view}',fill='white')
    sheet.save(CHECKS/'round2_review.png')
    sheet=Image.new('RGB',(2000,830),(46,46,46));draw=ImageDraw.Draw(sheet)
    for i,(label,folder) in enumerate([('Before','round2_before/round1_details'),('Round 2','round2_details')]):
        sheet.paste(Image.open(evidence(f'{folder}/neck_profile_1000ppm_design.png')).convert('RGB'),(i*1000,30))
        draw.text((i*1000+12,10),f'{label}: game profile, 1,000 px/m at the midline',fill='white')
    sheet.save(CHECKS/'round2_profile_comparison.png')
    print(json.dumps(facts,indent=2))


if __name__=='__main__':
    main()

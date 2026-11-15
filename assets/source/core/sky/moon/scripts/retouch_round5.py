#!/usr/bin/env python3
"""Select local image-tool paint over the reproducible round-three painting.

Masks select painted pixels; they do not synthesize texture, coastlines or rays.
All pixels outside the masks, including the complete alpha channel, are retained.
"""
import argparse
import json
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from build_moon import ROOT, PROFILE, NIGHT, paint, check_sheet, statistics, font


def baseline():
    return paint(ROOT/'originals/round-08.png', radius_retained=0.975)


def shore_mask(base):
    rgb = np.asarray(base, dtype=float)[..., :3]
    luma = (rgb * np.array([0.2126, 0.7152, 0.0722])).sum(axis=-1)
    y, x = np.mgrid[:512, :512]
    region = (x > 255) & (x < 502) & (y > 76) & (y < 375)
    region &= (y < 184) | (x > 282)
    labels, _ = ndimage.label((luma < 202) & region)
    selected = [labels[yy, xx] for xx, yy in [(320,130),(360,230),(450,275),(362,337),(465,180)]]
    assert 0 not in selected
    seas = ndimage.binary_fill_holes(np.isin(labels, selected))
    distance = np.where(seas, ndimage.distance_transform_edt(seas),
                        ndimage.distance_transform_edt(~seas))
    # Fully retain generated boundary paint; taper back to the original within 13 px.
    mask = np.clip((13-distance)/6, 0, 1)
    mask *= region
    return mask


def composite(base, tool_paint, mask):
    old = np.asarray(base).copy()
    new = np.asarray(tool_paint)
    old[..., :3] = np.rint(old[..., :3]*(1-mask[...,None]) +
                          new[..., :3]*mask[...,None]).astype(np.uint8)
    return Image.fromarray(old)


def add_painted_difference(current, original, edited, mask):
    """Carry only the tool's local change across already-corrected shore paint."""
    out = np.asarray(current).copy()
    delta = np.asarray(edited,dtype=float)[...,:3] - np.asarray(original,dtype=float)[...,:3]
    rgb = out[...,:3].astype(float) + delta*mask[...,None]
    out[...,:3] = np.rint(np.clip(rgb,0,255)).astype(np.uint8)
    return Image.fromarray(out)


def feathered_selection(points, feather=4):
    selection = Image.new('L', (512,512), 0)
    ImageDraw.Draw(selection).polygon(points, fill=255)
    # Finite support keeps unaffected pixels exactly untouched.
    mask = ndimage.gaussian_filter(np.asarray(selection,dtype=float)/255, feather,
                                   truncate=2)
    return mask


def comparison(before, after, title, labels=('ROUND THREE','LOCAL EDIT')):
    sheet = Image.new('RGB', (1080, 760), NIGHT)
    d = ImageDraw.Draw(sheet)
    d.text((24,16), title, font=font(20), fill=(221,229,238))
    for col,(label,asset) in enumerate(zip(labels,(before,after))):
        left = 20+536*col
        d.text((left,54),label,font=font(17),fill=(190,205,223))
        sheet.paste(asset,(left,86),asset)
        for offset,size in [(90,32),(240,48),(390,64)]:
            small = asset.resize((size,size),Image.Resampling.LANCZOS)
            sheet.paste(small,(left+offset-size//2,661-size//2),small)
            d.text((left+offset,710),f'{size} px',anchor='mt',font=font(14),fill=(168,187,210))
    return sheet


def build(stage='shores'):
    base, metadata = baseline()
    shores,_ = paint(ROOT/'originals/round-15.png',radius_retained=.975)
    masks = {'shores': shore_mask(base)}
    result = composite(base,shores,masks['shores'])
    metadata.update({'workflow':'round-five-local-composite','base_source':'originals/round-08.png',
                     'local_sources':['originals/round-15.png'],'stage':stage,
                     'unchanged_alpha_from_round_three':True})
    if stage in ('imbrium','rays'):
        arc,_ = paint(ROOT/'originals/round-16.png',radius_retained=.975)
        masks['imbrium'] = feathered_selection([
            (246,87),(267,92),(264,124),(253,155),(243,184),
            (213,199),(182,201),(179,186),(204,164),(223,140),(236,111)])
        masks['imbrium'] *= 1-masks['shores']
        result = composite(result,arc,masks['imbrium'])
        metadata['local_sources'].append('originals/round-16.png')
    if stage == 'rays':
        rays,_ = paint(ROOT/'originals/round-17.png',radius_retained=.975)
        northwest = feathered_selection([
            (96,215),(111,212),(131,257),(148,296),(175,347),(194,393),
            (184,400),(161,357),(138,316),(116,277),(100,246)],feather=4)
        northeast = feathered_selection([
            (229,394),(244,402),(272,359),(302,324),(329,289),(356,262),
            (347,248),(326,264),(295,302),(265,341)],feather=4)
        masks['rays'] = np.maximum(northwest,northeast)
        y,x = np.mgrid[:512,:512]
        masks['rays'] *= np.clip((np.hypot(x-208,y-437)-51)/12,0,1)
        result = add_painted_difference(result,base,rays,masks['rays'])
        metadata['local_sources'].append('originals/round-17.png')
    return result,metadata,masks


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage',choices=['shores','imbrium','rays'],default='shores')
    parser.add_argument('--prefix',default='iterations/round-17-local-shores')
    args=parser.parse_args()
    result,meta,masks=build(args.stage)
    folder=ROOT/args.prefix
    folder.mkdir(parents=True,exist_ok=True)
    result.save(folder/'moon.png',icc_profile=PROFILE)
    check_sheet(result).save(folder/'check.png',icc_profile=PROFILE)
    base,_=baseline()
    comparison(base,result,'ROUND FIVE / '+args.stage.upper()).save(folder/'comparison.png',icc_profile=PROFILE)
    for name,mask in masks.items():
        Image.fromarray(np.rint(mask*255).astype(np.uint8)).save(folder/(name+'-mask.png'))
    (folder/'metrics.json').write_text(json.dumps(statistics(result,meta),indent=2)+'\n')
    print(folder)


if __name__=='__main__':
    main()

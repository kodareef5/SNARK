"""Feedback evidence from the supplied renderers, without repainting images.

Run after paint.py, look.ts, world/snap.ts and review.py. --round 3 is the
default; optional checks/roundN snapshots supply the before/after comparison.
"""
from pathlib import Path
import argparse
import hashlib
import json
import site

site.addsitedir(site.getusersitepackages())
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
BG = (233, 230, 224)


def font(size=19):
    try:
        return ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", size)
    except OSError:
        return ImageFont.load_default()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--round", type=int, choices=(1, 2, 3), default=3)
    round_no = parser.parse_args().round
    old_dir = ROOT/f"checks/round{round_no}"
    old_look = old_dir/"look" if (old_dir/"look").exists() else old_dir
    facts = {}
    for name in ("dodo_hurt.png", "dodo_decay.png", "dodo_cards_hurt.png", "dodo_cards_decay.png"):
        if not (old_dir/name).exists():
            continue
        old = np.array(Image.open(old_dir/name))
        new = np.array(Image.open(ROOT.parent/name))
        a, b = old[..., 3], new[..., 3]
        retained = (a > 0) & (b > 0)
        changed = int(np.count_nonzero(retained & (a != b)))
        assert changed == 0, f"Retimed existing paint: {name}"
        if round_no >= 2 or name.endswith("_hurt.png"):
            assert np.array_equal(a, b), f"Changed arrival/footprint: {name}"
        if round_no == 3 and name != "dodo_hurt.png":
            assert (old_dir/name).read_bytes() == (ROOT.parent/name).read_bytes(), name
        facts[name] = dict(retained_arrival_changes=changed,
                          all_alpha_changes=int(np.count_nonzero(a != b)),
                          removed_texels=int(np.count_nonzero((a > 0) & (b == 0))),
                          added_texels=int(np.count_nonzero((a == 0) & (b > 0))),
                          rgb_changed_texels=int(np.count_nonzero(np.any(old[..., :3] != new[..., :3], axis=-1))),
                          identical_file=(old_dir/name).read_bytes() == (ROOT.parent/name).read_bytes())
    if (old_dir/"marks.json").exists():
        source = ROOT/"source/marks.json"
        assert source.read_bytes() == (old_dir/"marks.json").read_bytes()
        facts["marks_json_unchanged"] = hashlib.sha256(source.read_bytes()).hexdigest()
    if round_no >= 2 and (old_dir/"pigments.json").exists():
        old = json.loads((old_dir/"pigments.json").read_text())
        new = json.loads((ROOT/"source/pigments.json").read_text())
        for name in ("belly_continuation", "focus"):
            assert old[name] == new[name], f"Moved source placement: {name}"
        if round_no == 3:
            assert old["carcass"] == new["carcass"], "Changed accepted decay pigments"

    # Match the art director's unhurt / hurt 3 / decay 3 comparison, using only
    # native renderer pixels followed by an explicitly labelled 2x enlargement.
    rows = [("CURRENT", ROOT/"look")]
    if (old_look/"stages_front_left_default.png").exists():
        rows.insert(0, (f"BEFORE FEEDBACK {round_no}", old_look))
    sheet = Image.new("RGB", (1800, 650*len(rows)), BG)
    draw = ImageDraw.Draw(sheet)
    for row, (label, directory) in enumerate(rows):
        im = Image.open(directory/"stages_front_left_default.png").convert("RGB")
        for j, (k, stage) in enumerate(((0,"UNHURT"),(3,"HURT 3 / FRESH"),(6,"DECAY 3"))):
            x = 8+308*k
            tile = im.crop((x,8,x+300,308)).resize((600,600),Image.Resampling.NEAREST)
            sheet.paste(tile,(600*j,row*650+50))
            draw.text((600*j+12,row*650+12),f"{label} / {stage} / 2x",fill=(52,49,44),font=font())
    sheet.save(ROOT/f"FEEDBACK_{round_no}_REVIEW.jpg", quality=95, subsampling=0)

    if round_no >= 2:
        # The deciding comparison for blood colour: native 10 m living birds,
        # then those exact pixels enlarged 4x, before and after in all dyes.
        sheet = Image.new("RGB", (1920, 1200), BG)
        draw = ImageDraw.Draw(sheet)
        for row, dye in enumerate(("default", "loud", "dark")):
            for col, (label, directory) in enumerate((("BEFORE",old_look),("CURRENT",ROOT/"look"))):
                path = directory/f"sizes_{dye}.png"
                if not path.exists():
                    continue
                strip = Image.open(path).convert("RGB").crop((0,268,240,334))
                x, y = col*960, row*400
                draw.text((x+10,y+8),f"{dye.upper()} / {label} / 10 m",fill=(52,49,44),font=font())
                sheet.paste(strip,(x,y+38))
                draw.text((x+260,y+48),"Native pixels above; same pixels enlarged 4x below",fill=(52,49,44),font=font(16))
                for k, stage in enumerate(("UNHURT","HURT 1","HURT 2","HURT 3")):
                    draw.text((x+32+k*232,y+112),stage,fill=(52,49,44),font=font(16))
                sheet.paste(strip.resize((960,264),Image.Resampling.NEAREST),(x,y+136))
        sheet.save(ROOT/f"FEEDBACK_{round_no}_DISTANCE.jpg",quality=95,subsampling=0)

    if round_no == 3:
        # Measure the same injured pixels before/after at native 10 m. This
        # supports (but does not replace) viewing the distance sheets: the
        # new close feather contrast must not darken the whole injury mass.
        values = {}
        for dye in ("default", "loud", "dark"):
            a = np.asarray(Image.open(old_look/f"sizes_{dye}.png"),float)[..., :3]
            b = np.asarray(Image.open(ROOT/"look"/f"sizes_{dye}.png"),float)[..., :3]
            clean = a[276:326,8:58]
            for stage in (1,2,3):
                x = 8+58*stage
                before, after = a[276:326,x:x+50], b[276:326,x:x+50]
                mask = np.max(abs(before-clean),axis=-1)>6
                means=[]
                for q in (before,after):
                    srgb=q[mask]/255
                    linear=np.where(srgb<=.04045,srgb/12.92,((srgb+.055)/1.055)**2.4)
                    means.append(float((linear@[.2126,.7152,.0722]).mean()))
                values[f"{dye}_hurt{stage}"]=dict(pixel_count=int(mask.sum()),
                    before_mean_luminance=round(means[0],6),
                    current_mean_luminance=round(means[1],6),
                    relative_change_percent=round(100*(means[1]/means[0]-1),2))
        facts["native_10m_same_injury_pixels"] = values

    # All four stages in actual world poses; retain a native-size 10 m strip
    # and label every enlargement. No colour correction or synthetic render.
    world_rows = []
    for kind in ("hurt", "decay"):
        near = Image.open(ROOT/"world"/f"{kind}_2m_medium.png").convert("RGB")
        box = (200,200,1050,440) if kind == "hurt" else (200,280,1050,440)
        near = near.crop(box)
        world_rows.append((f"{kind.upper()} / 2 m, medium / native pixels",near))
        world_rows.append((f"{kind.upper()} / 2 m, medium / enlarged 2x",near.resize((near.width*2,near.height*2),Image.Resampling.NEAREST)))
        far = Image.open(ROOT/"world"/f"{kind}_10m_medium.png").convert("RGB").crop((540,325,740,400))
        world_rows.append((f"{kind.upper()} / 10 m, medium / native pixels",far))
        world_rows.append((f"{kind.upper()} / 10 m, medium / enlarged 5x",far.resize((1000,375),Image.Resampling.NEAREST)))
    sheet = Image.new("RGB",(1700,sum(im.height+45 for _,im in world_rows)),BG)
    draw = ImageDraw.Draw(sheet)
    y = 0
    for label, im in world_rows:
        draw.text((12,y+10),label,fill=(52,49,44),font=font())
        sheet.paste(im,(0,y+45))
        y += im.height+45
    sheet.save(ROOT/"WORLD_REVIEW.jpg",quality=95,subsampling=0)
    facts["world_sources"] = {p.name:hashlib.sha256(p.read_bytes()).hexdigest()
                              for p in sorted((ROOT/"world").glob("*.png"))}
    (ROOT/f"checks/feedback{round_no}_verification.json").write_text(json.dumps(facts,indent=2)+"\n")
    print(json.dumps(facts,indent=2))


if __name__ == "__main__":
    main()

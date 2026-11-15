#!/usr/bin/env python3
"""Write the handoff notes and palette board from verified delivered samples."""
from pathlib import Path
import json
import re
from datetime import datetime, timezone
from PIL import Image, ImageDraw
from build_style import font, ICC, TITLES

ROOT=Path(__file__).resolve().parents[1]
rows=json.loads((ROOT/'style/palette.json').read_text())['keys']
checks=json.loads((ROOT/'reports/verification.json').read_text())
rgb=lambda v: '('+', '.join(map(str,v))+')'
name=lambda k:k.replace('-',' ').title()
sky='| Hour | Near zenith | 30° away | Horizon toward light | Horizon away |\n| --- | --- | --- | --- | --- |\n'
light='| Hour | Open grey card | Shaded grey card | Cloud lit ribbon | Cloud shaded underside |\n| --- | --- | --- | --- | --- |\n'
exposure='| Hour | Open target | Toward / away measured | Shade target | Toward / away measured |\n| --- | ---: | ---: | ---: | ---: |\n'
for r in rows:
    sky+='| '+name(r['key'])+' | '+' | '.join(rgb(r[k]) for k in ['zenith','sky30_away','horizon_toward','horizon_away'])+' |\n'
    light+='| '+name(r['key'])+' | '+' | '.join(rgb(r[k]) for k in ['card_open','card_shade','cloud_lit','cloud_shade'])+' |\n'
    exposure+=f"| {name(r['key'])} | {r['open_target']} | {r['card_open_equiv']:.2f} / {r['away_card_open_equiv']:.2f} | {r['shade_target']} | {r['card_shade_equiv']:.2f} / {r['away_card_shade_equiv']:.2f} |\n"

style=f'''# Limestone / Lagoon / Ember

These are the first sky style studies: one island, eight hours, two directions. [Toward the light](sheet.png), [away from the light](away.png), and the [larger golden-hour painting](golden-hour-study.png) establish the palette and hand before the proving-ground renders arrive.

## The character

Our daylight has a mineral blue ceiling and a pale celadon, almost porcelain horizon. The limestone belongs to that cool family until low sunlight catches it. Warmth then arrives as a thin apricot seam, honey on the wall, and finally copper at the sea's rim. It never needs to replace all the blue. Across the sun, dusty rose floats above the earth's blue-grey shadow. Night returns the wall to silver and the water to marine blue.

The recognizable combination is **chalky limestone, a cool luminous sea-haze, and a small, persistent ember line beneath a large blue sky**. Broad quiet air and fine broken cloud ribbons give the day room to breathe. Saturated noon, a lingering warm hour, and navigable blue night supply the tropical survival feeling; our material colours and the narrow warmth/cool-air relationship give it its own identity. No other game's art or sky photograph was used as an image input.

## The hand

- Build the sky from broad, smooth colour fields with slight brush variation. Give almost three quarters of each frame to air. Keep the darkest clear-sky blue overhead and gather luminance low down and near the light.
- Clouds are thin, broken horizontal ribbons. Let a few edges catch warm light; keep their translucent undersides cooler. Avoid a ceiling of detailed cumulus. At dusk, “lit” means residual afterglow; at night it means moonlight.
- Reduce jungle to overlapping masses with a few palm tips. Reduce masonry to uneven rectangular planes, a timber cap, and a few decisive joints. Reserve the hardest edges for nearby stone, the cards, and occasional leaves. Distant coast edges dissolve.
- The sky makes the picture luminous. Keep the land within its exposure. A vertical wall catching grazing sunlight can be much brighter than the face-up card at golden hour.
- Blue shade remains visible even beside honey light. Dusk and night have similarly dark ground; the residual ember and rose sky distinguish dusk from night.

## Palette read from the delivered panels

All triples below are **8-bit sRGB, D65**, measured after grading and export. These are pixel readings, not values merely copied from a generation prompt. The [palette board](palette.png) shows the same samples. [CSV](palette.csv) and [JSON](palette.json) provide machine-readable values.

{sky}
{light}

The zenith reading comes from the away view to avoid the source halo. Cards and clouds in the second table come from the toward view; both directions' card readings are in the data files. Horizon samples deliberately avoid the solar disc and bright water. The thin clouds have very shallow painted volume: the cloud pair records a bright ribbon and its cooler, translucent lower edge, rather than two faces of a thick cloud.

## Through the day

**Dawn (+2°):** slate blue air, a small apricot opening toward the sun, pale cool rose away. The open card remains blue because ambient skylight still dominates the horizontal ground; only grazing edges receive warmth.

**Morning (+15°):** cleaner azure and a pearl horizon. A little gold enters direct light, while the shade remains blue. The land comes up in value without losing long shadows.

**Noon (+66°):** the strongest mineral blue overhead and the clearest celadon-to-pearl haze below. Hard white-gold light, cool stone shade, turquoise shallows. The away sky at the 30° guide reads exactly **(150, 190, 230)**; its neutral-equivalent brightness is **185.87**.

**Afternoon (+35°):** less austere blue, a softer, warmer low sky, and the first substantial gold on limestone. Haze broadens the low light without bleaching the zenith.

**Golden hour (+8°):** honey and amber belong to the sunward horizon and the wall's catching planes. Most of the sky stays blue; the reverse view receives a faint rose band. The open/shade card gap is deliberately small at 64/55 even though vertical surfaces catch strong raking light.

**Sunset (0°):** copper-orange at the rim, violet-blue above. Away, the rose band sits over a distinct blue earth shadow. Preserve this directional difference; do not apply an orange wash to the whole dome.

**Dusk (−8°):** the zenith is already deep blue. A thin ember remains sunward; the away earth shadow has risen and the rose is subdued. The first sparse stars appear. The ground receives sky afterglow, not direct sunlight.

**Night (high moon):** dark marine air, a brighter horizon and a local silver halo. The card is 36 in the open and 21 in shade. Stone, beach and jungle remain separable; stars stay sparse. For the night row, “toward/away” follows the **moon**, the active light. The sun is opposite it and below the horizon.

## Exposure and how to read it

The card material is the brief's nominal sRGB-128 grey. Its painted output is tinted by the light. Compare brightness using linear luminance, not the arithmetic average of its R, G and B channels:

`sRGB → linear RGB; Y = 0.2126 R + 0.7152 G + 0.0722 B; neutral = sRGB_encode(Y) × 255`.

{exposure}

Across the 32 card samples, the largest error is **{checks['max_card_error_srgb_levels']:.2f} sRGB levels**. The larger golden-hour painting measures **63.70 / 54.92**, against **64 / 55**. Every sampled horizon is brighter than its key's sampled zenith. Each sampled cloud light is brighter than its shaded edge. These checks cover the recorded regions, not every pixel or all atmospheric directions.

## Sampling and transfer to the game

Each clean panel is 1024 × 512; the presentation sheets are 2136 × 2524. Coordinates are measured inside each panel, with the origin at its upper left. The study uses a painted elevation guide: near-zenith at the top, sea horizon at about `y=0.744H`, and 30° at `y=0.496H`. It is **not a calibrated camera projection**. Sun heights are approximate compositional cues; the final render must establish exact geometry.

The sky/card readings use a 7 × 7 pixel channel median; fine cloud edges use 3 × 3. [Sample coordinates](../reports/samples.json) include the panel filename, exact panel and sheet pixel coordinates, radius, RGB and luminance. [Toward markers](../reports/samples-toward.png) and [away markers](../reports/samples-away.png) identify the sampled regions without marking up the paintings. The final paintings and presentation exports carry an sRGB profile.

Fit the atmosphere to clear-air samples after fixing the hour's exposure. Treat the sun or moon disc, its halo, cloud strokes, foliage, and water as separate visual evidence. Brush texture is an editorial surface, not a LUT requirement. Interpolate the low-dimensional grading controls smoothly between hours; judge the intervening sky as well as the eight anchors. The local grading script uses hand masks to finish a painting; it is not the proposed runtime algorithm.

The render team's final 2048 × 1024 keys should retain these relationships while replacing our invented coast with the actual proving ground. Verify the exact card orientation, sun/moon direction, sky angles and stone albedo there. A successful fit to the physical table has **not** yet been demonstrated.
'''
(ROOT/'style/STYLE.md').write_text(style)

# A numerical companion to the paintings: eight samples per hour.
columns=[('ZENITH','zenith'),('30° AWAY','sky30_away'),('HORIZON / LIGHT','horizon_toward'),('HORIZON / AWAY','horizon_away'),('OPEN CARD','card_open'),('SHADE CARD','card_shade'),('CLOUD / LIT','cloud_lit'),('CLOUD / SHADE','cloud_shade')]
board=Image.new('RGB',(1880,1180),(14,23,33));d=ImageDraw.Draw(board)
d.text((32,25),'LIMESTONE / LAGOON / EMBER',font=font(31,True),fill=(229,226,213))
d.text((32,72),'MEASURED PALETTE  /  sRGB  /  sampled from the delivered paintings',font=font(17),fill=(145,167,183))
for j,(title,_) in enumerate(columns):
    d.text((210+j*204,125),title,font=font(13,True),fill=(177,190,199))
for i,r in enumerate(rows):
    y=166+i*117
    d.text((32,y+22),TITLES[i],font=font(17,True),fill=(229,226,213))
    for j,(_,field) in enumerate(columns):
        x=210+j*204;v=r[field]
        d.rectangle((x,y,x+184,y+62),fill=tuple(v))
        d.text((x,y+71),rgb(v),font=font(14),fill=(178,193,205))
d.text((32,1142),'Pixel medians; cloud pairs sample thin translucent ribbons. Full coordinates and brightness checks are supplied.',font=font(15),fill=(135,155,172))
board.save(ROOT/'style/palette.png',icc_profile=ICC)

# Put the verbatim prompt records into chronological order, without editing them.
p=ROOT/'prompts.md';text=p.read_text()
blocks=re.split(r'(?=^## \d\d: )',text,flags=re.M)
intro='''# Sky mood keys: prompt log

Tool: built-in `image_gen.imagegen`, three calls. Only the user-supplied game render and our own generated paintings were image inputs. No external visual references. Images returned by the tool were copied unchanged into `originals/` before further work.

Generation prompts below are verbatim. Subsequent cropping, interpolation, exposure and colour grading, the noon sun-position correction, emission-disc colour preservation, labels, sampling and export were deterministic local Python operations, recorded in `scripts/build_style.py`; there were no additional image-tool prompts.

'''
records=[b for b in blocks if b.startswith('## ')]
p.write_text(intro+'\n\n'.join(sorted(records,key=lambda s:s[:5])))

session=json.loads((ROOT/'reports/session.json').read_text())
finished=datetime.now(timezone.utc)
started=datetime.fromisoformat(session['started_utc'].replace('Z','+00:00'))
elapsed=(finished-started).total_seconds()
session.update({'finished_utc':finished.isoformat(timespec='seconds'),'elapsed_seconds':round(elapsed),'generation_calls_completed':3,'local_grading_review_passes':4,'verification':'PASS'})
(ROOT/'reports/session.json').write_text(json.dumps(session,indent=2)+'\n')

report=f'''# Sky style-sheet report

Completed the first style package in this folder. The proposed hand is **Limestone / Lagoon / Ember**: mineral-blue air, pale celadon haze, warm chalky stone, a narrow apricot-to-copper sunward seam, and a restrained rose return over the earth shadow.

## Deliverables

- [style/sheet.png](style/sheet.png): eight hours toward the active light, 2136 × 2524, with eight 1024 × 512 painted panels.
- [style/away.png](style/away.png): the matching eight hours away from the active light, same dimensions and panel layout.
- [style/STYLE.md](style/STYLE.md): the hand, all eight requested colour samples per hour, exposure readings, sampling method, and transfer guidance.
- [style/golden-hour-study.png](style/golden-hour-study.png): a separately generated larger painting, exported at 2048 × 1024.
- [style/palette.png](style/palette.png), [palette.csv](style/palette.csv), and [palette.json](style/palette.json): visual and machine-readable samples.
- `style/panels/toward/` and `style/panels/away/`: all sixteen clean 2:1 panel crops.
- `originals/`: all three image-tool source images, unchanged. [Source manifest](reports/sources.json) records native dimensions and SHA-256 hashes. [prompts.md](prompts.md) retains every generation prompt.
- `reports/`: sample coordinates, marked-up inspection sheets, verification, and work-session metadata. `scripts/`: the reproducible build, verification, and notes/export scripts.

## How it was made

I used the built-in image-generation tool. The only starting image was the supplied game render of the limestone and timber building. The first call painted all eight sunward hours together to establish one hand and one geography. The second used that painting and the supplied render to make the reverse view. The third expanded golden hour as a larger hand study. No sky photographs, other games, web images, API fallback, or outside visual assets were used.

The tool returned two 1254 × 1254 grids and one 1774 × 887 larger painting. These are kept untouched in `originals/`. The clean grid panels are roughly 627 × 313/314 natively; the delivered 1024 × 512 panels are Lanczos-resampled. The larger study is also modestly enlarged to 2048 × 1024. These dimensions are not claims of native generated detail.

Local Python work split the grids, graded the land in linear RGB against both painted cards, graded the sky with vertical colour controls and feathered silhouette masks, and preserved the water's source hue while scaling its value with the horizon. The noon sun was moved down in the upper-sky mapping to the 66° guide, with its disc kept round. Emitting discs retain their source colour. Noon cloud highlights received a small correction to prevent a sky-blue adjustment from making them pink. Captions and numerical material were added outside the paintings.

## Measurement and review

All 80 recorded RGB samples were re-read from the **final presentation PNGs** and checked against their data records. Of these, 32 are card readings: two cards in each of sixteen panels. Largest card error: **{checks['max_card_error_srgb_levels']:.2f} sRGB levels** relative to the brief, using linear-light luminance converted back to neutral sRGB. The noon sky at the away 30° guide is **(150, 190, 230)** exactly. The larger study's cards read **63.70 / 54.92**, within 0.31 of **64 / 55**.

All eight keys have brighter sampled horizons than sampled zeniths, in both directions. All eight sampled cloud lights are brighter than the corresponding shaded edges. The exports carry an sRGB profile. [Verification results](reports/verification.json) and [exact sample coordinates](reports/samples.json) make the checks repeatable.

I inspected both generated grids, the generated larger study, the assembled sheets, enlarged cloud regions, the graded larger painting, and the final images. The first grading pass met the numbers but pushed the water and limestone too orange; I rejected that grade and reduced the card tint while separating the water treatment. The later passes refined the cloud samples, noon cloud colour and disc colour preservation.

## Rounds and time

**Three image-generation calls**, one for each source painting; no failed or discarded generation calls. **Four local grading/review passes**. The image-tool calls took about 42, 35 and 22 seconds respectively as reported by the tool; the remaining time went to prompts, inspection, grading, sampling and the handoff.

Started **{started.strftime('%Y-%m-%d %H:%M:%S UTC')}**; package notes written **{finished.strftime('%Y-%m-%d %H:%M:%S UTC')}**. Elapsed to this report: **{int(elapsed//60)} minutes {int(elapsed%60)} seconds**. Exact session metadata is in [reports/session.json](reports/session.json).

## Where it falls short

1. **This is a style sheet, not the final scene paintover or a proven physical-LUT fit.** The coast is invented. The actual renderer, camera, albedo and atmosphere still need to demonstrate these colours at the locked exposure. A few measured anchors cannot prove the full dome is physically realizable.
2. **Geometry is consistent by eye, not registered.** Masonry joints, leaves and the shoreline drift slightly across generated panels; the reverse view is an artistic companion rather than a surveyed 180° turn. The final proving-ground render should lock all of this.
3. **Angular placement is illustrative.** The painted elevation guide compresses a large span of sky into a wide panel; it is not a rectilinear camera. The noon correction improves its height, but the other sun placements can still be a few degrees off the labels. Discs and halos are oversized for legibility, and dawn's disc sits closer to the rim than I would keep in the exact final key. Night follows the moon as the active light; the sun is opposite and below the horizon.
4. **The hand is still too regular in parts of the sky.** Some diagonal brush texture repeats, the cloud ribbons are similar from hour to hour, and fine native detail is limited. The larger painting improves the scale test but remains an enlarged generated source, not a fully hand-finished native 2K painting.
5. **Cloud and shadow evidence is simplified.** The ribbons have shallow translucent undersides, not fully resolved cloud volumes. The shaded cards' placement does not prove physically correct penumbrae or sky occlusion. The hand-traced grade masks can leave small edge transitions around foliage and shore.
6. **Night is deliberately subdued.** Broad forms remain readable at the requested 36/21 card values, but small jungle detail will be lost on a dim display. I would review it in the game at normal display brightness before approving the final key.

Rebuild from this folder with `python3 scripts/build_style.py`, then `python3 scripts/verify_style.py`, then `python3 scripts/write_notes.py`. The last command refreshes the report timestamp. All project writes are inside this folder; the image tool's automatic staging files were copied here without modifying the supplied reference.
'''
(ROOT/'REPORT.md').write_text(report)
print(f'Wrote STYLE.md, palette.png, prompts.md, REPORT.md; elapsed {elapsed/60:.1f} minutes.')

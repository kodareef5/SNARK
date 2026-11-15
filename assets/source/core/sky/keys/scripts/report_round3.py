#!/usr/bin/env python3
"""Append/refresh round three without rewriting the two historical reports."""
from pathlib import Path
from datetime import datetime, timezone
import json, hashlib

ROOT = Path(__file__).resolve().parents[1]


def main():
    points = json.loads((ROOT / 'points.json').read_text())['keys']
    measured = json.loads((ROOT / 'points-read.json').read_text())['keys']
    verified = json.loads((ROOT / 'reports/keys-verification.json').read_text())['keys']
    session_path = ROOT / 'reports/round-3-session.json'
    session = json.loads(session_path.read_text())
    now = datetime.now(timezone.utc)
    elapsed = round((now - datetime.fromisoformat(session['startedUTC'])).total_seconds())
    source = ROOT / 'originals/12-afternoon-round-3.png'
    session.update(reportWrittenUTC=now.isoformat(), elapsedSeconds=elapsed,
                   clockScope='From the round-two archive, after initial brief/report reading.',
                   imageToolCalls=1, completedAssemblyReviewPasses=2,
                   source=str(source.relative_to(ROOT)), sourceSHA256=hashlib.sha256(source.read_bytes()).hexdigest(),
                   nativeSourceSize=[1774, 887])
    session_path.write_text(json.dumps(session, indent=2) + '\n')
    lines = [
        '# Round 3: Mineral ceiling, reflected light, clean silhouettes', '',
        'Revised all eight registered keys and refreshed [keys-sheet.png](keys-sheet.png), the sixteen 100° × 16:9 player views in [views/](views/), [their sheet](views/sheet.png), [points.json](points.json), and [points-read.json](points-read.json). Every key is still **2048 × 1024 RGB sRGB**. All eight pass the revised, unmodified measure; the worst `afterBestGrade` is **5.8**.', '',
        'The untouched round-two keys, sheets, views, point records, report, prompts, and scripts are in [rounds/round-2/](rounds/round-2/). Its [SHA-256 manifest](rounds/round-2/manifest.json) covers 70 files and is checked by the verifier. The copied measure is the owner’s revised version that was present at the start of this round.', '',
        '## What changed and why', '',
        '1. **The deep noon ceiling is back.** The revised measure first confirmed the existing noon at 3.4. The delivered near-zenith colour is now **(29, 86, 161)**, matching the original style sheet’s mineral blue instead of round two’s (80, 147, 212). Morning, noon, and afternoon now read approximately **(110, 194, 254)** at 30° away. That is the requested saturated hue lifted to the brightness reference: neutral-equivalent levels **185.81 / 185.71 / 185.99**, against **185.87** for (150, 190, 230). Literal (105, 185, 245) is darker than that reference. Morning’s ceiling received a small value lift to retain fit margin with the brighter high sky; afternoon’s ceiling is clearer and more saturated.', '',
        '2. **Afternoon’s light is gold-white.** One built-in image-tool edit used only our existing afternoon panorama as its input. The untouched result is [originals/12-afternoon-round-3.png](originals/12-afternoon-round-3.png); the exact prompt is appended in [prompts.md](prompts.md). The build blends 65% of its smooth air field with 35% of the earlier source, retains the earlier cloud filaments, and adds a soft angular gold-white veil in linear light. The first assembly was too peach-coloured around the sun; the second softened it into gold-white. The low sunward sample is now approximately (248, 231, 198), with clear blue above. No generated terrain or celestial placement is used.', '',
        '3. **Low-hour water carries the sky.** Dawn, golden, sunset, and dusk use the sky reflected at the same heading and opposite elevation. Reflection approaches full strength at grazing angles; a mild compression of the Fresnel value curve keeps the painter’s sea luminous farther below the horizon. This is an art grade of a reflection, not an unmodified dielectric BRDF. The warm side receives pearl, honey, copper, or afterglow; the opposite side receives its cooler blue and rose. Fine solar glints sit at the exact sun heading and remain clipped by the original water mask. Dawn’s direct path is largely hidden by the ridge. Dusk has no solar glitter because the sun is below the horizon. Morning, noon, afternoon, and night retain **every solid water pixel** from round two.', '',
        '4. **Night is readable through the sky.** It now measures about **(21, 37, 69)** overhead, **(62, 91, 131)** at the moonward horizon, and **(60, 90, 130)** opposite. The halo combines a soft 5.8° Gaussian core with a quieter 12° skirt, replacing the earlier 2.2° glow. The moon’s 1.5° disc, position, and sparse star catalogue are unchanged. Solid ground and all complete grey faces are unchanged.', '',
        '5. **The horizon defects were repaired at their source.** The vertical streaks came from copying row 530 into the sea/sky transition: where row 530 contained a tree or slope, that land colour was carried upward. The new compositor uses a local water field directly. It also recognizes the small non-flat water mixtures between ridge tops and sky. At terrain, tree, cube, and water boundaries, it recovers the existing blend coverage from the original base colours and nearby foreground material, allowing a foreground brightness difference where the slope/checker changes. It then recomposites that same pixel against the corrected sky or sea. No silhouette is shifted, dilated, or resampled. This removes the old water-coloured fringe without repainting the solid terrain.', '',
        '**Sunset uses the remaining room.** Its sunward point is now (239, 150, 110), up from (224, 147, 118): a hotter copper-orange rim, carried into the sea, while the dusky-blue ceiling and opposite rose/violet stay. More aggressive copper candidates exceeded 6, so this version stops at a measured 5.8.', '',
        '## What was preserved and inspected', '',
        'The verifier compares the delivered images directly with the archive. All solid land pixels and the entire connected lit, shaded, and face-up grey surfaces are byte-identical. The pure sky of **dawn, golden, and dusk is byte-identical**, including the pearl dawn, honeyed quarter, afterglow, clouds, and rising dusk moon. The sun/moon construction records and star coordinates are identical across every key. Boundary pixels containing mixed sky or water are the explicit exception to pixel preservation, because their old background contribution was the artifact being removed.', '',
        'I inspected all eight full panoramas at native resolution, all eight complete horizon strips at 100%, the enlarged reported golden-hour trouble area, and both player-view contact sheets. The final native horizon crops and the before/after strip sheet are in [reports/round-3-review/](reports/round-3-review/). The two vertical streak regions and the continuous blue ridge fringe are cleared. Remaining small dark silhouettes are the source terrain and vegetation.', '',
        '## Final readings', '',
        'These are rounded means of the actual 13 × 13 pixel patches, independently read by `scripts/read_points.py`. Z / H / T / A mean near zenith / 30° away / 3° toward / 3° away; JSON retains three decimals.', '',
        '| Key | Z | H | T | A | Lit face | Shaded face | Up card |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ]
    rgb = lambda c: '(' + ', '.join(str(round(v)) for v in c) + ')'
    for name, colours in points.items():
        lines.append('| ' + name + ' | ' + ' | '.join(rgb(colours[p]) for p in ['zenith', 'high', 'toward', 'away', 'lit', 'shaded', 'up']) + ' |')
    lines += ['', '| Key | Revised afterBestGrade | Card brightness | lowPolyUp | Card error |', '| --- | ---: | ---: | ---: | ---: |']
    for name, entry in measured.items():
        v = verified[name]
        lines.append(f"| {name} | **{entry['afterBestGrade']:.1f}** | {v['cardNeutralSRGB']:.2f} | {v['lowPolyUp']:.1f} | {v['cardError']:+.3f} |")
    lines += [
        '', 'All supplied-reader notes are empty. Largest card error: **0.412 levels**, unchanged from round two. Maximum sky edge difference: **1 level**. Each zenith row is exactly uniform. All cloud exclusion counts remain zero within 4° of the four sky points. All 56 independent readings agree with the supplied reader to rounding. Full preservation and acceptance results are in [reports/keys-verification.json](reports/keys-verification.json).', '',
        '## Rounds, time, and remaining limits', '',
        f"**One image-tool call and two completed assembly/review passes.** The first restored colour and reflection; the second refined the mixed edge treatment, water value, and afternoon warmth. The recorded clock starts with the archive at **{session['startedUTC']}**, after reading the briefs and report, and ends at **{now:%Y-%m-%d %H:%M:%S UTC}**: **{elapsed // 60} minutes {elapsed % 60} seconds**. [Session and source hash](reports/round-3-session.json).", '',
        '- The supplied angular horizon and raster sea edge still differ by roughly seven rows. Both original registrations are preserved, so the sunset disc remains slightly above the raster sea line.',
        '- The fit proves the requested four sky samples, not an unperformed full-dome runtime LUT comparison. Sunset has only 0.2 of reported fit margin.',
        '- Mixed boundary coverage is inferred from flattened RGB base renders, rather than supplied by a renderer alpha pass. The native inspection crops make this treatment reviewable.',
        '- The new afternoon source is 1774 × 887 and is enlarged for its smooth colour field. The retained cloud hand and procedural glitter are deliberately restrained; these are mood keys, not a detailed water simulation.', '',
        '## Rebuild this round', '',
        'Keep `rounds/round-2/`: it is the immutable source for the preserved foreground. The build also uses the existing originals, base renders, and palette controls. `report_keys.py` now dispatches to the round-three report writer, preserving the two historical report sections.', '',
        '```sh',
        'python3 -I scripts/build_keys.py',
        'python3 -I scripts/read_points.py',
        'python3 -I measure.py',
        'python3 -I scripts/verify_keys.py',
        'python3 -I scripts/report_keys.py',
        '```', '',
        '`physical.py`, the revised `measure.py`, `base/`, `underlay/`, and the original style package were not edited. The new surface work is in [scripts/round3_surfaces.py](scripts/round3_surfaces.py). All project writes are in this folder; the image tool’s staged result was copied here unchanged.',
    ]
    report = ROOT / 'REPORT.md'
    previous = report.read_text().split('\n\n# Round 3:')[0]
    report.write_text(previous + '\n\n' + '\n'.join(lines) + '\n')
    print('Round-three report appended; earlier reports preserved.')


if __name__ == '__main__':
    main()

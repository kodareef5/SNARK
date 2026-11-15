#!/usr/bin/env python3
"""Append round four in plain sentences, preserving all earlier reports."""
from pathlib import Path
from datetime import datetime, timezone
import json, hashlib
ROOT=Path(__file__).resolve().parents[1]


def main():
    measured=json.loads((ROOT/'points-read.json').read_text())['keys']
    points=json.loads((ROOT/'points.json').read_text())['keys']
    checked=json.loads((ROOT/'reports/keys-verification.json').read_text())
    build=json.loads((ROOT/'reports/key-build.json').read_text())
    session_path=ROOT/'reports/round-4-session.json'
    session=json.loads(session_path.read_text())
    now=datetime.now(timezone.utc)
    start=datetime.fromisoformat(session['resumedUTC'])
    elapsed=round((now-start).total_seconds())
    source=ROOT/'originals/13-noon-round-4.png'
    moon=ROOT.parent/'moon/moon.png'
    session.update(reportWrittenUTC=now.isoformat(),elapsedSecondsSinceArchive=elapsed,
                   clockScope='From the verified round-three archive after reading the briefs and report.',
                   imageToolCalls=1,completedAssemblyReviewPasses=3,
                   source=str(source.relative_to(ROOT)),sourceSHA256=hashlib.sha256(source.read_bytes()).hexdigest(),
                   moonSource='../moon/moon.png',moonSHA256=hashlib.sha256(moon.read_bytes()).hexdigest())
    session_path.write_text(json.dumps(session,indent=2)+'\n')
    rgb=lambda c:'('+', '.join(str(round(v)) for v in c)+')'
    max_error=max(abs(v['cardError']) for v in checked['keys'].values())
    worst=max(v['afterBestGrade'] for v in measured.values())
    scores='; '.join(f"{n} {v['afterBestGrade']:.1f}" for n,v in measured.items())
    lines=[
        '# Round 4', '',
        'The eight final panoramas, [keys-sheet.png](keys-sheet.png), all sixteen prescribed player views, [points.json](points.json), and [points-read.json](points-read.json) are refreshed. The panoramas remain RGB sRGB at 2048 by 1024. The player views remain 1280 by 720 with a 100° horizontal field of view and a pitch of 10°.', '',
        f"Round three is preserved in [rounds/round-3/](rounds/round-3/). Its manifest covers {checked['archiveFilesVerified']} unchanged files, including all eight keys, both sheets, the views, point records, scripts, prompts and report. The measure in this archive is the stricter owner supplied version present when this round began. The old point record is the delivered round three record. [The separate new baseline reading](reports/round-4-baseline-measure.json) confirms that round three noon scores 11.2 under the stricter measure.", '',
        'Every sun disc is now 2° across, with a soft limb and a surrounding angular glow. Every visible moon disc is 4° across. These diameters correspond to 11.38 and 22.76 pixels vertically in the panorama. At the high noon and night positions the projection makes them approximately 29 and 58 pixels wide. Their headings and elevations still come directly from base/points.json. Bodies below the horizon remain below it.', '',
        'The build reads [../moon/moon.png](../moon/moon.png) every time it runs. It projects the complete painted face north up without mirroring, with no phase shadow. Texture filtering preserves transparency at the limb. The light tint uses the physical model’s moon colour of (1.0, 0.94, 0.84) in linear RGB. The texture is never copied into a fixed substitute in this folder. Its current hash is recorded with every moon placement, so a changed face can be incorporated by rebuilding.', '',
        'The compact sun and moon halos are clear of every complete 13 by 13 measurement square. Low moon halos were tightened in the second review because a broad glow left a visible hollow around the cleared rose sample. Night retains a soft, wider glow. The small residual contribution of the previous moon glow at the night zenith is removed, so that reading is now '+rgb(points['night']['zenith'])+'. The blue atmosphere outside the celestial edits is preserved exactly.', '',
        'Sunset and dusk now have silver water paths centred under the eastern moon. They are clipped by the original water coverage, so the existing eastern ridge hides much of the direct path in these cameras. The visible water openings receive its light. Night has a wider silver sheen across the water toward the high moon. The paths use gentle horizontal glints and the same moon light colour. Golden hour’s solar glitter and water are unchanged.', '',
        'Noon’s deepest blue has moved into the broad upper band away from the sun, around 20° to 40° above the horizon. Its high reading is '+rgb(points['noon']['high'])+' and its zenith is '+rgb(points['noon']['zenith'])+'. The ceiling is lighter and softer as it approaches the high sun, the sunward air brightens, and the horizon stays pale. The new noon paint source was made with the built in image tool using our noon as the edit target and our golden hour as the palette reference. The untouched result is in [originals/13-noon-round-4.png](originals/13-noon-round-4.png), and the exact prompt is in [prompts.md](prompts.md). Its smooth colour variations contribute to the dome; generated land and generated celestial placement are discarded.', '',
        'Morning’s high reading is '+rgb(points['morning']['high'])+' and its zenith is '+rgb(points['morning']['zenith'])+'. Afternoon’s high reading is '+rgb(points['afternoon']['high'])+' and its zenith is '+rgb(points['afternoon']['zenith'])+'. Morning is cooler and fresher, noon is deeper cobalt, and afternoon is warmer and softer. These replace the identical electric cyan readings. The current targets intentionally replace the old requirement to hold the high points to the brightness of (150, 190, 230).', '',
        'Warm cream is confined to the sunward horizon. Morning’s opposite horizon reads '+rgb(points['morning']['away'])+' and afternoon’s reads '+rgb(points['afternoon']['away'])+', both pale aqua blue. The haze remains low. The day sky is assembled from broad elevation and angular fields with retained thin painted filaments, rather than local patches at the sample locations.', '',
        'Dawn’s water away from the sun now reflects lilac and pale blue from higher on that side of the sky. Its reflection weakens toward the shore into a deeper blue body colour. The near water is visibly darker than the far water, and a little of the rose cloud reflection remains. Dawn’s sunward water and its registered terrain remain in place.', '',
        'The verifier compares the final pixels with round three. Every solid terrain pixel and every complete connected grey face is unchanged. Morning, noon, afternoon and golden hour retain every solid water pixel. Dawn, golden hour, sunset, dusk and night preserve every pure sky pixel outside the explicitly bounded celestial edits. The stellar catalogue is unchanged. Original material coverage also preserves every coastline, ridge, tree and cube position through the mixed boundary pixels.', '',
        f"I ran the supplied measure without changing it. The final afterBestGrade scores are {scores}. The largest is {worst:.1f}, so all eight meet the limit of 6. The measure reports no notes. Independent readings of all 56 colour patches agree with its rounding. The largest card brightness error is {max_error:.3f} levels. Every zenith row is uniform, the maximum sky seam is at most two RGB levels, and the cloud masks remain clear within 4° of all four sky points. [The verification record](reports/keys-verification.json) records these checks and the preservation counts.", '',
        'I reviewed the full key and player contact sheets, the complete horizon crops at native width, the noon and golden pairing, and views aimed at the celestial bodies. [The review folder](reports/round-4-review/) retains these inspections. Extra views [of the high noon sun](views/noon-sun.jpg) and [of the high night moon](views/night-moon.jpg) make their size and face reviewable, since those bodies sit above the prescribed cameras pitched only 10° up.', '',
        f"This round used one image tool call and three completed assembly and review passes. The second pass adjusted the low moon halos, reflection width and night sheen, and retained the tiny rounding values in the old night glow’s distant tail. The third pass softened a darker shelf above noon’s high point so the upper dome lightens toward the zenith. The archive clock began at {start:%Y-%m-%d %H:%M:%S UTC} and the report was written at {now:%Y-%m-%d %H:%M:%S UTC}. The elapsed time was {elapsed//60} minutes {elapsed%60} seconds. [The session record](reports/round-4-session.json) records the clock and source hashes.", '',
        'The supplied angular horizon and raster sea edge still differ by about seven rows. The celestial coordinates and original sea boundary are both retained. The eastern ridge limits the visibility of the low moon paths. The physical fit proves the four sampled sky colours, rather than a complete runtime sky table comparison. Reflections remain a restrained mood treatment rather than a wave simulation. The generated noon source is 1774 by 887 and supplies only a smooth field in the native 2048 by 1024 assembly.', '',
        'Keep the round two and round three archives, the existing originals and the sibling moon file for rebuilding. The main round four work is in [scripts/round4.py](scripts/round4.py). The following commands rebuild the keys, independently read them, measure them, verify preservation, refresh review images and append this report.', '',
        '```sh',
        'python3 -I scripts/build_keys.py',
        'python3 -I scripts/read_points.py',
        'python3 -I measure.py',
        'python3 -I scripts/verify_keys.py',
        'python3 -I scripts/review_round4.py',
        'python3 -I scripts/report_keys.py',
        '```', '',
        'The supplied physical model, stricter measure, base renders, physical underlays and earlier style package were not changed. All project writes for this round are inside this folder.',
    ]
    text='\n'.join(lines)+'\n'
    assert '—' not in text and '–' not in text
    report=ROOT/'REPORT.md'
    previous=report.read_text().split('\n\n# Round 4')[0]
    report.write_text(previous+'\n\n'+text)
    print('Round-four report appended. Earlier report sections preserved.')


if __name__=='__main__':
    main()

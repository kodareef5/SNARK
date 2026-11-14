# Miami production state

**Round two complete.** 2026-11-14, 19:40–20:40 UTC. All final tiles and saved production inputs are in place; no generation, finishing or measurement process remains running.

- 85 final RGB PNG tiles, each 1,024², in the original z0/z1/z2/z3 filenames. Whole-map entry: [tiles/z0/0_0.png](tiles/z0/0_0.png).
- 21 replacement originals at z0–z2, plus retained supplementary overview/correction inputs. All 64 z3 original paintings are byte-identical to round one. Exact prompts are kept beside the originals.
- Far views generalize into districts and landmark pictures. Close views keep native footprints and rooms. Ivory paper, variable shore ink, flood/reclamation, port trusses, hotel galleries and scale-legible wreck symbols are finished across continuous canvases before cutting.
- 85 formats pass; all tile sets reconstruct their masters with zero error. All 140 joins measured and worst cases inspected. Broad adjacent-zoom RGB differences are 0.802, 1.440, 1.028 /255. Raw maximum join ratio is 1.568 at a real building wall coinciding with the cut; this is above round one's reported 1.29 and is explicitly explained, not hidden, in the report. No visible tile-shaped discontinuity was found.
- Reproduction check: both far canvases rebuilt identically from originals; three close registrations recomputed without caches with zero differences; full colour balance/export rerun with identical hashes for all 85 tiles.
- Base layers/vectors unchanged (21 artifacts checked). Engine conversion verified and documented in [base/VALUES.md](base/VALUES.md): x=4064−E, z=4064+N. Keep PNGs north-up; do not mirror them before the importer. No engine map file built.
- Final whole-map comparison made beside Harper's Sea of Thieves commission, Blaeu's Amsterdam and Baynes's Middle-earth. Assessment and remaining artistic weaknesses are in [REPORT.md](REPORT.md); foreign artwork was never passed to image generation.
- Measurements, production log, reproduction checks and hashes are kept under reports/. Downloads, references, review pictures and warped/continuous masters remain ignored and regenerable.
- Current export pipeline: reference.py → round2_restore.py → round2.py finish 0,1,2,3 → round2_balance.py → round2_measure.py → audit.py. The complete commands are in tools/mapart/README.md. Do not run the old finish.py entry point for round-two exports.
- Work is confined to assets/source/maps/miami/ and tools/mapart/. No git write command was run.

[Full report](REPORT.md) · [Production log](reports/round2-production-log.md) · [Export measurements](reports/round2-measurements.json) · [Reproduction result](reports/round2-reproduction.json)

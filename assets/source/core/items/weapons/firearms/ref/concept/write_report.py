"""Write the handoff report from final audit data and retained render logs."""
import json,re,datetime
from pathlib import Path
R=Path(__file__).resolve().parent
a=json.loads((R/'checks/measurements.json').read_text())
f=json.loads((R/'checks/file_audit.json').read_text())
start=datetime.datetime(2026,11,15,16,39,6,tzinfo=datetime.timezone.utc)
now=datetime.datetime.now(datetime.timezone.utc)
elapsed=(now-start).total_seconds()/60
rows=[];dimcount=0;dimfails=[]
for gun,g in a['guns'].items():
    v=g['view_agreement']
    rows.append(f'| {gun} | {v["z_endpoint_disagreement_mm"]:.3f} | {v["y_extent_disagreement_mm"]:.3f} | {v["x_extent_disagreement_mm"]:.3f} | {"PASS" if v["pass"] else "FAIL"} |')
    for group in ['measurements','component_dimensions']:
        for k,c in g[group].items():
            dimcount+=1
            if not c['pass']:dimfails.append(gun+'/'+k)
logtimes={}
for p in sorted((R/'checks').glob('*render.log')):
    m=re.search(r'COMPLETE ([\d.]+) seconds',p.read_text(errors='replace'))
    if m:logtimes[p.name]=float(m[1])
report=f'''# Frontier firearm concept handoff

Created entirely from BRIEF.md, without web searches or gun reference images. The numbered dimensions take priority when the brief contradicts itself. The files are a dimensionally consistent exterior concept set, with the unresolved aiming and 32-pixel readability issues below. Those issues prevent an unqualified claim that every requirement is satisfied.

## Deliverables

- Four sets of `revolver`, `rifle`, `shotgun`, and `flare` `_side.png`, `_top.png`, `_front.png`, each with a matching `_mask.png`.
- `rifle_action_side.png` and `rifle_action_top.png`, each with a matching mask.
- `lineup.png`, `hero.png`, `sights.png`, and `read_sizes.png`.
- All 14 orthographic colour views, 14 masks and four final sheets are 1254 × 1254. Only check sheets contain text.
- `checks/measurements.json`: measured dimensions, projected landmarks, raster comparisons, and exceptions. `checks/scene_measurements.json`: evaluated part bounds and camera definitions. `checks/file_audit.json`: independent pixel and file checks.
- `checks/*_projection_overlay.png`: shared longitudinal guides between side and top, plus corresponding height guides into the front view. Front scale differences are shown explicitly. `checks/rifle_action_overlay.png` covers the action crop.
- `checks/*_review.png`, `checks/masks_review.png`, `checks/sights_overlay.png`, `checks/read_sizes_labeled.png`, and `checks/rifle_left_detail.png` support visual review. The left-side detail exposes the cheek pad and its lacing.
- `concept_geometry.blend` contains the common source geometry in named collections, with the wood texture packed. It is an exterior concept model, not a finished production mesh or working mechanism.

## How the pictures were made

`build.py` constructs all four objects once in metres. Polygon profiles, eight-sided stock sections, simple faceted tubes, actual bore openings, five shallow chamber mouths, and geometry for all named fittings provide the shapes. Every orthographic view of a gun uses the same geometry and material assignments. No drawing is stretched to reconcile views. Fine surface detail is in the materials rather than in the silhouette.

The built-in imagegen tool generated one diffuse hardwood texture, retained as `textures/wood_albedo.png`; its complete prompt is `surface_prompt.txt`. No game, studio, or franchise was named. This was one generated image, with no CLI/API fallback. All gun images are Blender Cycles renders using that texture and procedural steel, brass, hide, fibre and flint surfaces. This is rendered concept artwork rather than a claim of hand-painted brushwork. No existing project material files were modified.

Orthographic lighting uses a uniform neutral world and a broad, soft frontal area source. There is no floor or cast ground shadow in these renders. Their transparent render passes are composited over exact RGB (214, 212, 206) by `finish.py`. Masks retain the identical 8-bit alpha coverage, including antialiased edges: white interior, black exterior. Measurement bounding boxes use the 50% coverage contour.

The physical camera observes the requested side. A horizontal reflection then implements the explicit screen axes in the brief, whose viewing-side and screen-axis combination is left-handed. This is a reflection, never a nonuniform scale. Pixel positions are continuous coordinates measured from the outer canvas edges; pixel index i has centre i + 0.5.

| Picture group | Production method |
|---|---|
| Side/top/front | Orthographic shared geometry, exact requested scale and origin; flat-background alpha composite. |
| Rifle action | Same rifle, 3000 px/m, origin (380, 760); clipped at columns 20 and 1220, corresponding to z = −0.120 and +0.280 m. |
| Lineup | Uniform resampling of the four side passes to a common 800 px/m. Row order: rifle, shotgun, revolver, flare. |
| Hero | Same four models, placed on their left sides on a plain neutral surface with small rigid rotations. Orthographic three-quarter camera, broad daylight-like illumination and soft contact shadows. |
| Sights | Cameras looking exactly along +Z at y = .062/.052/.040/.084 m. Original crops are 6500 px/m and are reduced uniformly into four quadrants. Order: revolver, rifle, shotgun, flare. No geometry is hidden to manufacture a clear aim. |
| Read sizes | Tight crops of the final side passes reduced uniformly to 128, 64 and 32 pixels along their longest side. Colour on the left, black silhouettes on the right. Actual native pixels, not enlarged previews. Row order: revolver, rifle, shotgun, flare. |

## Measurements

{dimcount} explicit dimension checks were made against evaluated geometry. Dimension failures: {', '.join(dimfails) if dimfails else 'none'}. The checks include muzzle endpoints, stock/grip extents, barrel axes and diameters, sight heights, receiver and action bounds, the bolt knob, bands, wraps, and the cheek pad. Projected grip, muzzle, butt, barrel-axis and sight landmarks are recorded in pixels and metres. All part bounds are retained, including small fittings.

The following are independent raster silhouette comparisons, converted back to metres. Longitudinal endpoints must agree within 1% of overall length; height and width disagreement must be at most 2 mm.

| Gun | Z endpoint disagreement, mm | Height disagreement, mm | Width disagreement, mm | Result |
|---|---:|---:|---:|---|
{chr(10).join(rows)}

All 14 colour views and masks have matching canvases. Exact alpha coverage, colour compositing and empty-background tests: **{'PASS' if f['all_file_checks_pass'] else 'FAIL'}**. Every orthographic output has the requested origin and pixels-per-metre in the camera manifest. Sights are measured against the numeric heights individually; this does not imply the aiming path is unobstructed.

## Brief conflicts and remaining concerns

1. **Material count.** The required revolver and shotgun each contain wood, steel, brass and hide: four substances. The rifle additionally requires cord lacing. All named details were retained. The flare contains only wood, fibre cord and flint; its dark bore is a darkened wood/interior treatment.
2. **Revolver aim.** A 46 mm cylinder centred at y = .040 reaches y = .063, above the specified y = .062 sight line. The brass front band reaches approximately .06335. The raised hammer also crosses the centreline. The sight markers meet their numeric heights, but a clear aiming picture is impossible with those unchanged shapes.
3. **Flare aim.** Barrel top .076, front bump .084 and hammer reference .095 are three different heights. The front-to-hammer discrepancy is approximately 11 mm, far beyond 1 mm. The drawing preserves the individual numbers. The rear camera uses the front bump's .084 height and shows the obstruction.
4. **Notch/rib tangency.** The rifle's front blade top is specified at the bottom of the rear notch. In an exact parallel view the rear base hides the blade below that tangent. The shotgun bead top is similarly tangent to the rear rib height. The aiming sheet is truthful about this instead of raising the front elements.
5. **Rifle neck.** The specified fore-stock runs .580 m of a 1.360 m overall gun: 42.65%, not more than half as the prose requests. The numeric endpoints +.120 and +.700 were retained.
6. **Grip origin.** The specified pistol gripping surfaces lie largely below y = 0, although the prose calls the origin the middle of the hand. All views retain the stated origin and geometry. The flare's grip top and barrel bottom also leave a 5 mm gap; a short carved wooden neck joins them without moving either specified endpoint. The wooden hammer has a joined wooden pivot support.
7. **32-pixel readability.** The pistols separate strongly. The rifle and shotgun silhouettes are distinct but too similar for confident instant recognition at 32 px. Their side-view barrels are only approximately .52 and .74 pixels thick at that size. I am not satisfied with that result. Increasing their visual separation would require revised proportions, a different inventory viewing angle, or permission for bespoke icon exaggeration. The delivered sheet uses the exact side designs without distortion.
8. **Finish quality.** The forms and surfaces provide a consistent modelling reference, but the wear is restrained, and the large forged action faces remain simple. More local wear painting could improve the presentation. The source meshes are deliberately faceted and are not UV-unwrapped, retopologized, rigged or validated as production assets.

## Iteration and elapsed time

Five visual design rounds, including a small preview subpass in round two. Round one established the forms. Round two corrected grip grain, hide wrapping, hammer hooks, the loading-lever attachment, and the flare's continuity. Round three corrected the wrap on the front face, gave the shotgun muzzle band visible end thickness, restricted the flint's pale area to its edge, and reframed the hero. A supplemental camera correction frames the rifle cheek pad. Round four corrected inward-facing stock and band polygons. Round five separated coplanar surfaces that caused black shading artifacts: the rifle receiver is 30.6 mm wide (2% over its nominal 30 mm), butt plates extend 0.2 mm beyond the nominal end surfaces, and the shotgun rib's rear cap extends 0.2 mm beyond the action. These changes are within tolerance and are included in the measured bounds. The first full raster audit caught a 2.24 mm shotgun front/top width mismatch; the band-end geometry corrected its cause.

Started {start.isoformat()}; report written {now.isoformat()}. Elapsed wall time to this report: **{elapsed:.1f} minutes**. The single generated texture took about 16 seconds. Successful retained render-run times: {json.dumps(logtimes)}. These timings include render work, not only imagegen latency. Render logs are retained under `checks/`.

## Rebuild

Requirements: Blender 5.3 (Cycles, CPU), Python 3, Pillow, NumPy, and DejaVu Sans for check-sheet labels. The generated wood artwork is already included; a rebuild does not need an image-generation call or network access.

```sh
bash rebuild.sh
```

The script runs `build.py`, `finish.py`, and `audit_outputs.py`. Run `python3 write_report.py` afterward to refresh this report's audit values and timestamp if desired. Intermediate RGBA passes, scripts, images and logs all live under this folder. No git commands were run.
'''
(R/'REPORT.md').write_text(report)
print(f'Wrote REPORT.md; {elapsed:.1f} minutes elapsed; {dimcount} dimensions.')

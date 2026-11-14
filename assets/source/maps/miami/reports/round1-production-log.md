# Miami painted world map — production report

Production started 2026-11-14 17:28 UTC. This is a live report; acceptance has not yet been reached.

## Intended delivery

An 8,128 m square of downtown Miami, the port, Biscayne Bay and South Beach. Four scale-specific zooms, 85 square 1,024 px PNG tiles, north up. Plain height, water, land cover, roads and building layers share the map projection and registration. The engine receives no new dependencies.

## Method under development

Public geographic geometry controls the paint, rather than relying on the image model to keep coastlines fixed. An original pigment and symbol sheet establishes the common hand. Native-scale geographic reference images will be generated independently at each zoom. Source imagery from other games will not be used.

The earlier test was reviewed. Its strong inked edges and textured water are useful quality references; the new map aims for lighter parchment, more legible district structure, much richer meaningful close-up detail and less repetitive hatching.

## Run log

- 17:28 UTC: inspected repository scope, first-test report, painting and finishing code. Began source discovery and isolated tool setup.
- 17:29–17:35: acquired source subsets, selected the local Transverse Mercator square, generated and inspected original style sheet. Downloaded 369 intersecting NOAA DEM tiles; 1,184 clipped road features, 38 water polygons, 11,919 clipped building footprints. First footprint query exceeded the service URL limit; corrected to 100 IDs per request and verified completeness against the ID inventory.
- 17:35–17:43: produced the base layers and independent references at 1,024, 2,048, 4,096 and 8,192 pixels; painted the whole map; rejected invented architecture as authority and constrained it to exact footprints. Added explicit fictional reclamation strips and flooded-street layers. First overview RGB geometry checks: water/building/road IoU 1, zero boundary discrepancy against native references.
- 17:43–17:47: painted four overlapping zoom-1 sections against the native references, parent and style sheet. Every original image and exact prompt is retained. Assembly and close-detail pilot in progress.
- 17:47–18:10: district pilot at zooms 2 and 3. Visual review rejected narrow-river-only registration, which could shear city blocks even while exact footprint masks still passed. Added position-constrained SIFT/RANSAC registration against the geographic reference, with a tightly bounded shoreline-only fallback. Pilot feature-fit median residuals are roughly 1.7–3.0 px before the exact geometry finish. This distinction matters: correct outer masks alone are not sufficient evidence of good artwork.
- Zoom-1 color correction was expanded from luminance-only to water RGB. At this intermediate checkpoint, parent-scale average color shift was less than 0.12/255 per channel; 8 px blurred mean error 0.82/255, unblurred mean error 9.70/255. Fine ink marks naturally differ between native scales. Final numbers will be rerun after all artwork and the shared authored canopy are frozen.

- 18:10–18:24: restored native vegetation and road texture; finished and visually reviewed all 16 neighborhood originals. Whole-map composition and port/shore geography held together.
- 18:24–18:59: 60 remaining close-scale originals generated with up to eight concurrent image-tool requests, against native 1,152 px overlap references and accepted parent crops. Registration caches are built while paintings arrive. Source/parent prompts for the four previously painted pilot tiles are preserved.
- Intermediate zoom-2 geometry found 102 water pixels clipped to white and 2,264 dark olive edge pixels that could be mistaken for road pigment. Added material-family enforcement after shading and limited water highlights so bright currents retain a water hue. Final measurements will verify this correction.

- 18:59–19:06: first complete 8,192 px assembly and native-size review. Found shoreline brushwork artifacts in several island/forest tiles despite good outer-mask scores.
- 19:06 onward: replaced the tightly bounded fallback with multistart similarity fitting of the main water silhouette; removed nearest-pixel land repair, which fragmented tree crowns; clean open-water pigment is now handled separately. Shared canopy is refrozen after this refinement. Reduced full-canvas intermediate arrays to 32-bit floats for more efficient finishing.

## Acceptance

Pending. Intermediate measurements are in checks/measurements.json; final acceptance will follow the completed shared-canopy finish. No final completeness claim yet.

- 19:23–19:30: final ordered finishing of all zooms, native reviews and complete contact sheet. RGB geometry is exact at every zoom. All tile reconstructions are exact; join statistics remain within neighboring image variation.
- 19:30–19:38: engine-grid comparison exposed outer-sample polygon convention and thin-feature loss. Added canonical 8,192 px geometry layers, fixed 292 water, 730 building and 185 road endpoint samples, and surface/tunnel precedence. Fine geometry matches native references exactly; 2 m quantization limitations are reported. Final audit, canopy provenance, source syntax and unchanged-tile hashes checked. Delivery accepted.

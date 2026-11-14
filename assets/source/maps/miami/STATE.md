# Miami production state

**Complete and accepted.** Run: 2026-11-14, 17:28–19:38 UTC, approximately 2 h 10 min.

- Accepted: all 85 finished 1,024² RGB tiles under tiles/z0 through tiles/z3; 85 independently generated original paintings and their used prompts/context crops; original style sheet; full-resolution final masters.
- Accepted: exact 8,128 m square and corners in map.json; source manifests and attribution; height, validity, water, roads, buildings, land cover, succession, flooding, bridge gaps, wrecks and canopy layers. Canonical 8,192² water/road/building/canopy masks preserve detail too fine for 2 m samples.
- Verified: final visible water, road and building masks have IoU 1.000 and zero boundary error against native vector references at all zooms. Fine canonical masks match exactly. All tiles reconstruct their masters with zero changed pixels. Adjacent-zoom broad-colour mean errors are 0.978, 0.849 and 0.829 / 255.
- Verified: 85 tile/original/prompt sets, required PNG dimensions and bit depths; SHA-256 inventory in checks/delivery_audit.json; canopy-source provenance; Python syntax. Offline viewer JavaScript syntax checked; automated browser launch was unavailable.
- Visually reviewed: whole map at all scales, complete close-scale contact sheet, native downtown/island/port/beach/mangrove cases and joined-corner crops. No visible joins, lettering, borders or compass in final tiles.
- Limits: the 2 m companions quantize very thin geometry. Use the fine masks or vectors for future world feature placement. Height gaps use explicit −1 m convention, not bathymetry. Source uncertainty and artistic compromises are detailed in REPORT.md. FEMA delivery attribution must accompany redistribution.
- Next handoff: consume the accepted layers and tiles in the game's later world-building/map-screen work. No painting or finishing work remains in this task. Reproduction commands are in tools/mapart/README.md.

Historical checks/partial_z*.png and SIFT experiments are development diagnostics, not delivery tiles. All repository changes stay under assets/source/maps/miami and tools/mapart. Raw downloads and the tool virtual environment are ignored. No git write commands. Engine and build untouched.

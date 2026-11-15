#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
export XDG_CACHE_HOME="$PWD/.cache"
blender -b --factory-startup --python build_concepts.py
blender -b --factory-startup --python measure_parts.py
blender -b --factory-startup --python measure_fittings.py
python3 finish_concepts.py
python3 audit_concepts.py
python3 registration_sheets.py
blender -b --factory-startup --python render_hero.py
# hero.png is the retained painted presentation. Its exact generated raster is
# preserved alongside the full prompts; image generation itself is stochastic.
python3 verify_deliverables.py

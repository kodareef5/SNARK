#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
mkdir -p checks source/cache renders textures
export XDG_CACHE_HOME="$PWD/source/cache"
export TMPDIR="$PWD/source/cache"
export TOOL_CONCEPT_BATCH=1
blender -noaudio --factory-startup -b -t 6 --python source/build_tools.py > checks/rebuild_geometry.log 2>&1
python3 source/finish_plates.py
blender -noaudio --factory-startup -b -t 6 --python source/export_audit.py > checks/rebuild_audit.log 2>&1
blender -noaudio --factory-startup -b -t 4 --python source/export_details.py > checks/rebuild_details.log 2>&1
python3 source/make_sheets.py
python3 source/measure_checks.py
blender -noaudio --factory-startup -b -t 6 --python source/render_hero.py > checks/rebuild_hero.log 2>&1
python3 source/final_audit.py
blender -noaudio --factory-startup -b -t 6 --python source/render_paint_guides.py > checks/rebuild_paint_guides.log 2>&1
python3 source/finish_guides.py
python3 source/assemble_paintings.py
python3 source/audit_revision.py

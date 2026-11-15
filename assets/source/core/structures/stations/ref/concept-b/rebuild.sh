#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
python3 prepare_textures.py
blender --background --threads 8 --python build_stations.py > checks/rebuild.log 2>&1
python3 finish_sheets.py > checks/sheet_build.log
python3 verify_assets.py > checks/validation_log.txt

#!/bin/sh
# Sound tools: a local venv, the pinned Stable Audio 3 MLX code and both models' pinned weights.
# Weights go to the Hugging Face cache (about 10 GB); code and work files to .work/ (git-ignored).
#   tools/sound/setup.sh               Python 3.10 or newer; PYTHON=... to choose one
#   tools/sound/.venv/bin/python tools/sound/generate.py <brief.json>
#   tools/sound/.venv/bin/python tools/sound/review.py <brief.json>
#   tools/sound/.venv/bin/python tools/sound/accept.py <brief.json> <picks.json>
#   tools/sound/.venv/bin/python tools/sound/remake.py <asset sound folder>
set -e
cd "$(dirname "$0")"
[ -d .venv ] || "${PYTHON:-python3.12}" -m venv .venv
.venv/bin/pip install -q -r requirements.txt
.venv/bin/python models.py

#!/bin/sh
# Sound tools: a local venv, the pinned model code and the models' pinned weights.
# Weights go to the Hugging Face cache, code and work files to .work/ (git-ignored).
#   Mac (MLX):    Stable Audio 3 MLX code and both models' MLX weights (about 10 GB); requirements.txt
#   Linux (CUDA): MOSS-TTS code and the upstream MOSS-SoundEffect v2.0 weights (about 11 GB);
#                 requirements-cuda.txt, Python 3.12, an NVIDIA GPU with 8 GB or more
#   tools/sound/setup.sh               PYTHON=... to choose the interpreter
#   tools/sound/.venv/bin/python tools/sound/generate.py <brief.json>     (Linux: add --model moss)
#   tools/sound/.venv/bin/python tools/sound/review.py <brief.json>
#   tools/sound/.venv/bin/python tools/sound/accept.py <brief.json> <picks.json>
#   tools/sound/.venv/bin/python tools/sound/remake.py <asset sound folder>
set -e
cd "$(dirname "$0")"
if [ "$(uname)" = Darwin ]; then
  [ -d .venv ] || "${PYTHON:-python3.12}" -m venv .venv
  .venv/bin/pip install -q -r requirements.txt
elif command -v uv >/dev/null; then
  [ -d .venv ] || uv venv -q --python "${PYTHON:-3.12}" .venv
  uv pip install -q --python .venv/bin/python --index-strategy unsafe-best-match -r requirements-cuda.txt
else
  [ -d .venv ] || "${PYTHON:-python3.12}" -m venv .venv
  .venv/bin/pip install -q -r requirements-cuda.txt
fi
.venv/bin/python models.py

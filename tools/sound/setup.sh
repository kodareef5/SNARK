#!/bin/sh
# Sound tools: the venvs, the pinned model code and the models' pinned weights. Not part of the build: run it only on
# a machine that makes sounds. README.md in this folder is the guide.
# Weights go to the Hugging Face cache, code and work files to .work/ (git-ignored).
#   Mac (MLX):    .venv from requirements.txt; Stable Audio 3 MLX code and both models' MLX weights (about 10 GB)
#   Linux (CUDA): .venv from requirements-cuda.txt (MOSS-SoundEffect) and .venv-stable from requirements-stable.txt
#                 (Stable Audio 3 music, MOSS-VoiceGenerator); the MOSS-TTS and Stable Audio 3 code, and the
#                 MOSS-SoundEffect v2.0 weights (about 11 GB). Python 3.12, an NVIDIA GPU with 8 GB or more.
#   tools/sound/setup.sh               PYTHON=... to choose the interpreter
# The venvs and .work may be links to a place outside the clone (README.md, "Setting up a machine").
set -e
cd "$(dirname "$0")"
venv() { # venv DIR REQUIREMENTS
  if command -v uv >/dev/null; then
    [ -d "$1" ] || uv venv -q --python "${PYTHON:-3.12}" "$1"
    uv pip install -q --python "$1/bin/python" --index-strategy unsafe-best-match -r "$2"
  else
    [ -d "$1" ] || "${PYTHON:-python3.12}" -m venv "$1"
    "$1/bin/pip" install -q -r "$2"
  fi
}
if [ "$(uname)" = Darwin ]; then
  venv .venv requirements.txt
else
  venv .venv requirements-cuda.txt
  venv .venv-stable requirements-stable.txt
fi
.venv/bin/python models.py

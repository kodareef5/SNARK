#!/usr/bin/env python3
"""Verify the current round; earlier verifiers remain in their archives."""
from pathlib import Path
import runpy

if __name__ == '__main__':
    runpy.run_path(str(Path(__file__).with_name('verify_round5.py')), run_name='__main__')

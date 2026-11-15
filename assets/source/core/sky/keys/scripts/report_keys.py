#!/usr/bin/env python3
"""Write the current round's report; round two's writer is in its archive."""
from pathlib import Path
import runpy

if __name__ == '__main__':
    runpy.run_path(str(Path(__file__).with_name('report_round5.py')), run_name='__main__')

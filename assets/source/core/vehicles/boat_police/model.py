"""The livery shares the original measured boat geometry and rig."""
import os
import runpy
import sys
folder=os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","boat")
sys.path.insert(0,folder)
for source in ("rig.py","model.py"):runpy.run_path(os.path.join(folder,source),run_name="__main__")

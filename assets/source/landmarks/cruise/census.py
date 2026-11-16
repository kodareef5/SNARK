"""Pre-export cell census: Blender --background --factory-startup --python this-file."""
import os,runpy,sys,bpy
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.dont_write_bytecode=True
sys.path.insert(0,str(HERE))
bpy.ops.wm.read_factory_settings(use_empty=True)
os.environ['CRUISE_CENSUS']='1'
runpy.run_path(str(HERE/'model.py'),run_name='__main__')

"""Additional concept-view cameras using the shared game's renderer.

Run look.sh first. This Python review changes only its camera list, keeping the
game's materials, mip selection, dyes and draw code. Its temporary executable
stays in /tmp/dodo-look, never in the repository's asset tree.
"""
from pathlib import Path
import hashlib,json,re,subprocess,tempfile

ROOT=Path(__file__).resolve().parent
LOOK=ROOT.parent/'look.ts'
TREE=Path('/tmp/dodo-look/tree')
OUT=ROOT/'checks/concept_views'

def main():
    source=LOOK.read_text()
    source=re.sub(r'from "(\.\./[^"]+)"',lambda m:'from '+json.dumps(str((LOOK.parent/m[1]).resolve())),source)
    cameras='''const SHOTS: Record<string, [readonly [number, number, number], number, number, number]> = {
      back: [[0, 0.33, 0.04], 0.418, 180, 0],
      top: [[0, 0.33, 0.04], 0.418, 180, 90],
      side: [[0, 0.33, 0.04], 0.418, 90, 0],
    };'''
    source,n=re.subn(r'const SHOTS:[\s\S]*?\n};',cameras,source,count=1)
    if n!=1:raise RuntimeError('Shared renderer camera declaration changed')
    marker='for (const [dyes, colors] of Object.entries(DYES)) {'
    first=source.index(marker);second=source.index(marker,first+len(marker))
    source=source[:first]+source[second:]
    source=source.replace('Object.entries(DYES)','Object.entries({default: DYES.default})')
    # A square frame matches the concept; retain the shared 2x supersampling.
    source=source.replace('const H = 900;','const H = 1200;')
    OUT.mkdir(parents=True,exist_ok=True)
    files=[TREE/'core/creatures/dodo/dodo.snpk',LOOK,ROOT/'layers/layers.json',*sorted((TREE/'core/creatures/dodo/tex').glob('*.png'))]
    receipt={str(f):hashlib.sha256(f.read_bytes()).hexdigest() for f in files}
    with tempfile.TemporaryDirectory(prefix='body-review-',dir='/tmp/dodo-look') as temp:
        script=Path(temp)/'camera.mts';script.write_text(source)
        subprocess.run(['bun',str(script),'--source',str(TREE),'--out',str(OUT)],check=True)
    if any(hashlib.sha256(f.read_bytes()).hexdigest()!=receipt[str(f)] for f in files):
        raise RuntimeError('Renderer inputs changed during review; rerun')
    (OUT/'inputs.json').write_text(json.dumps(receipt,indent=2)+'\n')

if __name__=='__main__':main()

"""Rebuild into an empty layers directory and compare all delivery bytes."""
from pathlib import Path
import argparse,hashlib,json,os,shutil,subprocess,sys,tempfile

ROOT=Path(__file__).resolve().parent

def hashes(folder):
    return {p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(folder.iterdir()) if p.is_file()}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--allow-provenance-update',action='store_true',
        help='Still require identical PNGs and settings; allow only input hashes to change.')
    args=parser.parse_args()
    layers=ROOT/'layers';qa=ROOT/'checks';qa.mkdir(exist_ok=True)
    expected=hashes(layers)
    previous_meta=json.loads((layers/'layers.json').read_text())
    inputs=previous_meta['inputs_sha256']
    changed=[name for name,digest in inputs.items()
             if hashlib.sha256((ROOT.parents[2]/name).read_bytes()).hexdigest()!=digest]
    assert not changed or args.allow_provenance_update, 'Repaint after changed inputs: '+', '.join(changed)
    with tempfile.TemporaryDirectory(prefix='rebuild-',dir=qa) as tmp:
        backup=Path(tmp)/'layers';shutil.move(layers,backup)
        try:
            subprocess.run([sys.executable,'-I',str(ROOT/'paint.py')],env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'},check=True)
            actual=hashes(layers)
            if actual!=expected:
                changed=[name for name,digest in inputs.items()
                         if hashlib.sha256((ROOT.parents[2]/name).read_bytes()).hexdigest()!=digest]
                (qa/'rebuild_mismatch.json').write_text(json.dumps(dict(
                    changed_inputs=changed,expected=expected,actual=actual),indent=2)+'\n')
            meta=json.loads((layers/'layers.json').read_text())
            images_equal={k:v for k,v in actual.items() if k.endswith('.png')}=={k:v for k,v in expected.items() if k.endswith('.png')}
            settings_equal={k:v for k,v in meta.items() if k!='inputs_sha256'}=={k:v for k,v in previous_meta.items() if k!='inputs_sha256'}
            assert images_equal and settings_equal, 'Clean rebuild changes delivered textures or settings'
            assert actual==expected or args.allow_provenance_update, 'Clean rebuild changes the input receipt'
        except BaseException:
            if layers.exists():shutil.rmtree(layers)
            shutil.move(backup,layers)
            raise
    meta=json.loads((layers/'layers.json').read_text())
    for name,digest in meta['inputs_sha256'].items():
        assert hashlib.sha256((ROOT.parents[2]/name).read_bytes()).hexdigest()==digest,name
    result=dict(round=5,clean_output_directory=True,byte_identical=actual==expected,
        texture_files_byte_identical=images_equal,texture_files=5,settings_identical=settings_equal,
        changed_input_receipt=[name for name,digest in meta['inputs_sha256'].items() if inputs.get(name)!=digest],
        files=len(actual),input_hashes_current=True,sha256=actual)
    (qa/'rebuild.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))

if __name__=='__main__':main()

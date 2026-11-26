"""Check the distributor's MP4 constraints and extract four actual frames per loop."""

import csv
import json
import struct
import subprocess

import numpy as np
from PIL import Image, ImageDraw, ImageOps

from render import DATA, OUT, WORK, FPS, W, H, REELS, RESAMPLE


def atom_order(path):
    with path.open('rb') as media:
        atoms = []
        while header := media.read(8):
            size, atom = struct.unpack('>I4s',header)
            if size == 1:
                size = struct.unpack('>Q',media.read(8))[0]
                header_size = 16
            else:
                header_size = 8
            atoms.append(atom)
            if not size:
                break
            assert size >= header_size
            media.seek(size - header_size, 1)
        return atoms


def verify(name, seconds, poster):
    source = ImageOps.fit(Image.open(WORK/(name+'.png')).convert('RGB'), (W,H), RESAMPLE)
    movement = REELS[name](source)
    assert movement(0).tobytes() == movement(1).tobytes(), 'artwork does not return to its first pose'
    path = OUT/(name+'.mp4')
    data = json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams',
            '-show_packets','-show_entries','packet=pts_time,size:stream=codec_type,codec_name,pix_fmt,width,height,avg_frame_rate,nb_frames,duration,bit_rate',
            '-of','json',str(path)]))
    assert len(data['streams']) == 1
    v = data['streams'][0]
    assert (v['codec_type'],v['codec_name'],v['pix_fmt']) == ('video','h264','yuv420p')
    assert (v['width'],v['height'],v['avg_frame_rate']) == (W,H,f'{FPS}/1')
    assert float(v['duration']) == seconds and int(v['nb_frames']) == FPS*seconds
    atoms = atom_order(path)
    assert atoms.index(b'moov') < atoms.index(b'mdat')
    bitrates = np.array([int(pkt['size'])*8/1000 for pkt in sorted(data['packets'],key=lambda pkt: float(pkt['pts_time']))])
    max_window = np.convolve(np.r_[bitrates,bitrates[:FPS-1]], np.ones(FPS), mode='valid').max()
    assert max_window <= 1500
    first = None
    previous = None
    deltas = []
    timesteps = dict.fromkeys([0,poster*FPS,seconds*FPS//2,3*seconds*FPS//4])
    if len(timesteps) != 4:
        timesteps[seconds*FPS//4] = None
    sample_grid = Image.new('RGB',(W,(H+20)*4),'#252828')
    pen = ImageDraw.Draw(sample_grid)
    j = 0
    cmd = ['ffmpeg','-v','error','-threads','2','-i',str(path),'-pix_fmt','rgb24','-threads','1','-f','rawvideo','-']
    with subprocess.Popen(cmd, stdout=subprocess.PIPE) as ff:
        for n in range(seconds*FPS):
            raw = ff.stdout.read(W*H*3)
            assert len(raw) == W*H*3
            frame = np.frombuffer(raw,np.uint8).reshape(H,W,3)
            if n in timesteps:
                pen.text((6,j*(H+20)+2),f'{name}     {n/FPS:.2f} s',fill='white')
                sample_grid.paste(Image.fromarray(frame),(0,j*(H+20)+20))
                j += 1
            sampled = frame[::2,::2].astype(np.int16)
            if first is None:
                first = sampled
            else:
                deltas.append(float(np.abs(sampled-previous).mean()))
            previous = sampled
        assert not ff.stdout.read(1)
        assert ff.wait() == 0
    seam = float(np.abs(first-previous).mean())
    assert max(deltas) > .2, 'motion is missing'
    # A fresh keyframe and a predicted end frame may differ by one RGB level on average.
    assert seam <= max(deltas) + 1, f'{name} has a discontinuous seam ({seam:.3f}; interior {max(deltas):.3f})'
    sample_grid.save(WORK/(name+'-inspection.jpg'),quality=95,subsampling=0)
    return [name,seconds,len(bitrates),round(int(v['bit_rate'])/1000),round(max_window),
            round(seam,3),round(max(deltas),3)]


if __name__ == '__main__':
    rows = [verify(name,duration,poster) for name,(_,duration,poster) in DATA.items()]
    with (WORK/'verification.csv').open('w',newline='') as report:
        writer = csv.writer(report)
        writer.writerow(['name','seconds','frames','kbps','peak_one_second_kbps','seam_mean_delta',
                         'largest_adjacent_mean_delta'])
        writer.writerows(rows)
    for row in rows:
        print(*row)

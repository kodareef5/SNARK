# Writes PNGs with NumPy and zlib alone, in and out of Blender: 8 or 16 bits,
# grey, RGB or RGBA, rows top to bottom.

import struct
import zlib

import numpy as np


def write(path, pixels, bits=8):
    """`pixels` is (h, w) or (h, w, channels) of 0 to 1, or of whole numbers already in range."""
    a = np.asarray(pixels)
    if a.ndim == 2:
        a = a[:, :, None]
    h, w, c = a.shape
    top = 255 if bits == 8 else 65535
    if a.dtype.kind == "f":
        a = np.round(np.clip(a, 0, 1) * top)
    a = a.astype(">u2" if bits == 16 else np.uint8)
    kind = {1: 0, 2: 4, 3: 2, 4: 6}[c]
    # Every row filtered by Paeth's predictor, from bytes.
    b = np.frombuffer(a.tobytes(), np.uint8).reshape(h, -1).astype(np.int16)
    bpp = c * (2 if bits == 16 else 1)
    left = np.zeros_like(b)
    left[:, bpp:] = b[:, :-bpp]
    up = np.zeros_like(b)
    up[1:] = b[:-1]
    ul = np.zeros_like(b)
    ul[1:, bpp:] = b[:-1, :-bpp]
    pa, pb, pc = np.abs(up - ul), np.abs(left - ul), np.abs(left + up - 2 * ul)
    pred = np.where((pa <= pb) & (pa <= pc), left, np.where(pb <= pc, up, ul))
    rows = ((b - pred) & 255).astype(np.uint8)
    raw = np.concatenate([np.full((h, 1), 4, np.uint8), rows], axis=1).tobytes()

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, bits, kind, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        f.write(chunk(b"IEND", b""))

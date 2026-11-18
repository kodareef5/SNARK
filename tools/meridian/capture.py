# /// script
# requires-python = ">=3.10"
# dependencies = ["playwright", "pillow"]
# ///
"""Retake the Meridian fitting sheet, material close-ups, field poses and running clip."""

import argparse
import hashlib
import io
from pathlib import Path
import shutil
import subprocess
from urllib.parse import urlencode

from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url", default="http://127.0.0.1:8756/")
parser.add_argument(
    "--out", type=Path, default=Path("planning/reference/survivor-armor/meridian-game")
)
parser.add_argument(
    "--chrome", default=shutil.which("google-chrome") or shutil.which("chromium")
)
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)


def font(size):
    try:
        return ImageFont.truetype("DejaVuSans.ttf", size)
    except OSError:
        return ImageFont.load_default()


def sheet(filename, title, panels, size):
    w, h = size
    pad, gap, caption, heading = 24, 14, 47, 76
    columns = 2
    rows = (len(panels) + 1) // columns
    board = Image.new(
        "RGB", (2 * pad + 2 * w + gap, heading + rows * (h + caption) + pad), "#12212c"
    )
    ink = ImageDraw.Draw(board)
    ink.text((pad, 18), title, font=font(32), fill="#eef4fa")
    for i, (label, photo, crop) in enumerate(panels):
        x, y = pad + (i % columns) * (w + gap), heading + (i // columns) * (h + caption)
        board.paste(photo.crop(crop).resize(size, Image.Resampling.LANCZOS), (x, y))
        ink.text((x + 2, y + h + 8), label, font=font(20), fill="#bfdaed")
    board.save(args.out / filename, quality=94, method=6)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        executable_path=args.chrome,
        args=[
            "--enable-unsafe-swiftshader",
            "--use-angle=swiftshader",
            "--disable-dev-shm-usage",
        ],
    )
    page = browser.new_page(
        viewport={"width": 960, "height": 850}, device_scale_factor=1
    )
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))

    def scene(**params):
        query = urlencode({"capture": "", "tick": 32, **params})
        page.goto(args.url.rstrip("/") + "/?" + query, wait_until="load")
        page.wait_for_selector("body[data-ready=true]", timeout=90000)
        expected = params.get("pose") == "air" and "shirt" not in params.get(
            "off", ""
        ).split(",")
        page.wait_for_function(
            "wanted => document.querySelector('canvas').dataset.vents === wanted",
            arg=str(expected).lower(),
            timeout=20000,
        )

    def photo(**params):
        scene(**params)
        return Image.open(io.BytesIO(page.screenshot())).convert("RGB")

    body_crop = (230, 0, 760, 850)
    sheet(
        "fits.webp",
        "Meridian   /   Survivor fits",
        [
            ("Male survivor", photo(fit="m"), body_crop),
            ("Female survivor", photo(fit="f", angle=-0.35), body_crop),
        ],
        (477, 765),
    )
    sheet(
        "materials.webp",
        "Meridian   /   Surface and hardware",
        [
            (
                "Ceramic shell and cobalt visor",
                photo(view="portrait", angle=0.46),
                (65, 25, 895, 770),
            ),
            (
                "Aperture under dusk light",
                photo(view="portrait", angle=-0.49, dusk=""),
                (65, 55, 895, 800),
            ),
            ("Folded vanes", photo(view="back"), (65, 55, 895, 800)),
            ("Airborne deployment", photo(view="back", pose="air"), (65, 55, 895, 800)),
        ],
        (556, 499),
    )
    sheet(
        "field.webp",
        "Meridian   /   Fit in use",
        [
            ("Pteranodon saddle", photo(pose="mount", angle=0.98), (0, 105, 960, 825)),
            (
                "Crouch and held pick",
                photo(pose="crouch", tool="", build="broad"),
                (90, 105, 930, 735),
            ),
            (
                "Cloth under helmet, gloves and boots",
                photo(fit="f", off="shirt,pants", mix="cloth", build="slight"),
                (0, 65, 960, 785),
            ),
            (
                "Hide with Meridian torso and legs",
                photo(off="hat,gloves,boots", mix="hide"),
                (0, 65, 960, 785),
            ),
        ],
        (600, 450),
    )

    page.set_viewport_size({"width": 720, "height": 820})
    scene(pose="run", angle=0.8, tool="", tick=0)
    clip = args.out / "stride.mp4"
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "image2pipe",
        "-framerate",
        "15",
        "-i",
        "pipe:0",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-crf",
        "18",
        "-movflags",
        "+faststart",
        str(clip),
    ]
    hashes = set()
    with subprocess.Popen(command, stdin=subprocess.PIPE) as encoder:
        for tick in range(2, 93, 2):
            page.evaluate(
                "t => dispatchEvent(new CustomEvent('armory-frame', {detail:t}))", tick
            )
            page.wait_for_function(
                "t => document.querySelector('canvas').dataset.tick === String(t)",
                arg=tick,
            )
            frame = page.screenshot(type="jpeg", quality=94)
            hashes.add(hashlib.sha256(frame).digest())
            encoder.stdin.write(frame)
        encoder.stdin.close()
        if encoder.wait() or len(hashes) < 30:
            raise RuntimeError(
                "The stride film did not encode distinct animation frames"
            )
    browser.close()
    if errors:
        raise RuntimeError(errors)

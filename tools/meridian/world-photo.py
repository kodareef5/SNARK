# /// script
# requires-python = ">=3.10"
# dependencies = ["playwright", "pillow"]
# ///
"""Photograph Meridian from a second survivor or the pilot in the local proving ground."""

import argparse
import io
from pathlib import Path
import shutil
import time
from urllib.parse import urlencode

from PIL import Image
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument(
    "--flight",
    action="store_true",
    help="Photograph the jets and fuel gauge from the pilot’s camera",
)
parser.add_argument("--port", type=int, default=8759)
parser.add_argument(
    "--chrome", default=shutil.which("google-chrome") or shutil.which("chromium")
)
parser.add_argument(
    "--out",
    type=Path,
)
args = parser.parse_args()
args.out = args.out or Path("planning/reference/survivor-armor/meridian-game") / (
    "flight.webp" if args.flight else "in-world.webp"
)
url = f"http://127.0.0.1:{args.port}/?"
stamp = str(time.time_ns())[-10:]


def join(browser, name, width, height):
    page = browser.new_page(viewport={"width": width, "height": height})
    page.goto(
        url
        + urlencode(
            {
                "quick": "",
                "trip": "",
                "look": "meridian",
                "tier": "high",
                "name": name + stamp,
            }
        ),
        wait_until="domcontentloaded",
    )
    page.wait_for_function(
        """() => { const a=window.snarkTrip?.app, i=a?.session.inventory;
      return i && i.item[i.armor] === a.reg.index.get('core:meridian_hat');
    }""",
        timeout=90000,
    )
    return page


def place(page, x, z, yaw, pitch):
    # The review preset just issued an armor command. Allow the server’s console interval to elapse.
    tick = page.evaluate("snarkTrip.app.session.serverTick")
    page.wait_for_function("last => snarkTrip.app.session.serverTick >= last + 24", arg=tick)
    page.evaluate("p => snarkTrip.app.session.text('tp ' + p.join(' '))", [x, z])
    page.wait_for_function(
        "([x,z]) => Math.abs(snarkTrip.x-x)<0.5 && Math.abs(snarkTrip.z-z)<0.5",
        arg=[x, z],
        timeout=25000,
    )
    page.evaluate(
        "([yaw,pitch]) => { const a=snarkTrip.app; a.controls.yaw=yaw; a.controls.pitch=pitch; }",
        [yaw, pitch],
    )


with sync_playwright() as pw:
    # Independent browser processes keep each player advancing while the other streams art.
    def browser():
        return pw.chromium.launch(
            executable_path=args.chrome,
            args=[
                *(
                    ["--enable-gpu", "--use-gl=angle", "--use-angle=gl"]
                    if args.flight
                    else ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
                ),
                "--disable-dev-shm-usage",
            ],
        )

    if args.flight:
        pilot_browser = browser()
        try:
            pilot = join(pilot_browser, "jet", 1160, 800)
            place(pilot, 243, 257, 0.25, -0.24)
            pilot.keyboard.press("v")
            pilot.wait_for_function(
                """() => {
              const a=snarkTrip.app, p=a.scene.packet, ids=a.scene.assets.manifest.meshes, drawn=new Set();
              for(let i=0;i<p.drawCount;i++) if((p.drawFlags[i]&32) && ids[p.drawMesh[i]].id.includes('/armor/meridian/')) drawn.add(ids[p.drawMesh[i]].id);
              return a.view.thirdPerson && drawn.size>=5 && a.session.own.grounded;
            }""",
                timeout=150000,
            )
            pilot.keyboard.down("Space")
            pilot.wait_for_function(
                "snarkTrip.app.session.own.jetSpent >= 55", timeout=20000
            )
            pilot.keyboard.down("ShiftLeft")
            pilot.wait_for_function(
                "snarkTrip.app.session.own.jetThrust === 2 && Math.abs(snarkTrip.app.session.own.vy)<0.01",
                timeout=10000,
            )
            args.out.parent.mkdir(parents=True, exist_ok=True)
            Image.open(io.BytesIO(pilot.screenshot())).convert("RGB").save(
                args.out, quality=95
            )
            pilot.wait_for_function(
                "snarkTrip.app.session.own.jetSpent === 300", timeout=25000
            )
            pilot.keyboard.up("Space")
            pilot.keyboard.up("ShiftLeft")
            pilot.wait_for_function(
                "snarkTrip.app.session.own.grounded && snarkTrip.app.session.own.jetSpent === 0",
                timeout=25000,
            )
        finally:
            pilot_browser.close()
        raise SystemExit(0)

    model_browser = browser()
    camera_browser = browser()
    try:
        model = join(model_browser, "fit", 320, 280)
        place(model, 243, 257, 3.14159, 0)
        camera = join(camera_browser, "cam", 1160, 800)
        place(camera, 242.3, 254.3, 0.254, -0.23)
        camera.wait_for_function(
            """() => {
          const s=snarkTrip.app.scene, p=s.packet, meshes=s.assets.manifest.meshes, slots=new Set();
          for (let i=0; i<p.drawCount; ++i) {
            const id=meshes[p.drawMesh[i]].id;
            // Textured remote geometry in the visible pass, excluding the photographer's gear.
            if ((p.drawFlags[i]&40)===32 && p.drawLod[i]<2 && id.includes('/armor/meridian/')) slots.add(id.split('/').pop());
          }
          return ['head','torso','hands','legs','feet'].every(slot=>slots.has(slot));
        }""",
            timeout=150000,
        )
        # Keep all five textured silhouettes and the actual game lighting, with a clear view of the suit.
        camera.evaluate(
            "() => { document.querySelector('#ui').style.visibility='hidden'; }"
        )
        camera.wait_for_timeout(1200)
        args.out.parent.mkdir(parents=True, exist_ok=True)
        Image.open(io.BytesIO(camera.screenshot())).convert("RGB").save(
            args.out, quality=95
        )
    finally:
        camera_browser.close()
        model_browser.close()

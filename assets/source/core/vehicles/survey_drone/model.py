"""The SV-4 survey drone: four guarded impellers, a gimballed nose camera and a payload pod. See ../air_freight."""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "air_freight"))
from kit import Kit  # noqa: E402
import drone  # noqa: E402

BONES = [("chassis", (0, 0, 0))] + [(f"impeller_{k + 1}", p) for k, p in enumerate(drone.IMPELLERS)] + [("gimbal", drone.GIMBAL)]
kit = Kit("survey_drone", BONES)
drone.build(kit, {name: name for name, _ in BONES})
kit.finish()

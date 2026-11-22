import { expect, test } from "bun:test";
import { linuxGpu } from "../../tools/chrome.ts";

const NVIDIA = { __EGL_VENDOR_LIBRARY_FILENAMES: "/usr/share/glvnd/egl_vendor.d/10_nvidia.json" };

test("headless Chrome on Linux is sent to the card through EGL, NVIDIA's when it is there", () => {
  expect(linuxGpu(undefined, true, true)).toEqual({ flags: ["--use-angle=gl-egl"], env: NVIDIA });
  expect(linuxGpu(undefined, true, false)).toEqual({ flags: ["--use-angle=gl-egl"], env: {} });
  expect(linuxGpu("mesa", true, true)).toEqual({ flags: ["--use-angle=gl-egl"], env: {} });
  expect(linuxGpu("nvidia", true, false).env).toEqual(NVIDIA);
});

test("a machine with no card, or one told to draw in software, is left as Chrome has it", () => {
  expect(linuxGpu(undefined, false, false)).toEqual({ flags: [], env: {} });
  expect(linuxGpu("software", true, true)).toEqual({ flags: [], env: {} });
});

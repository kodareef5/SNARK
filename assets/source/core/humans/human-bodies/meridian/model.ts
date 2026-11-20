// Meridian is built on the same rest vertices and bones the survivor actually wears.
// The dark liner supplies every mixed-set seam; each ceramic panel follows one rigid bone.
import type { PackRig } from "../../../../../../shared/pack/pack.ts";
import type { SourceMesh } from "../../../../../../tools/pack/write.ts";
import { B_CHEST, B_HEAD, B_HIPS, B_NECK, B_SPINE, B_UPPER_CHEST } from "../../../../../../shared/anim/human.ts";
import { contour, finish as f, Surface, type Form, type Profile, type Row } from "./surface.ts";

function band(s: Surface, form: Form, lo: number, hi: number, tile: number, bone: number, off = 0) {
  s.panel(
    form,
    [
      [lo, -180, 180, off],
      [hi, -180, 180, off],
    ],
    tile,
    bone,
    32,
    0,
  );
}
function mirror(rows: readonly Row[], side: number): Row[] {
  return rows.map(([y, a, b, d]) => (side > 0 ? [y, a, b, d] : [y, -b, -a, d]));
}

function helmet(s: Surface) {
  const shell = contour(
    [
      [1.475, 0, -0.004, 0.056, 0.068],
      [1.5, 0, 0.004, 0.074, 0.087],
      [1.535, 0, 0.012, 0.088, 0.114],
      [1.565, 0, 0.003, 0.098, 0.125],
      [1.6, 0, -0.003, 0.107, 0.13],
      [1.638, 0, -0.008, 0.11, 0.132],
      [1.665, 0, -0.014, 0.107, 0.125],
      [1.697, 0, -0.017, 0.095, 0.108],
      [1.725, 0, -0.018, 0.071, 0.081],
      [1.743, 0, -0.018, 0.041, 0.046],
      [1.75, 0, -0.017, 0.001, 0.001],
    ],
    0,
    0.88,
  );
  const collar = contour([
    [1.426, 0, -0.038, 0.083, 0.082],
    [1.451, 0, -0.038, 0.075, 0.077],
    [1.5, 0, -0.021, 0.066, 0.074],
    [1.543, 0, -0.014, 0.067, 0.075],
  ]);
  band(s, collar, 1.43, 1.52, f.rubber, B_NECK);
  for (let i = 0; i < 4; i++) band(s, collar, 1.443 + i * 0.016, 1.448 + i * 0.016, f.alloy, B_NECK, 0.0015);
  // Continuous graphite helmet shell; separate ceramic and glass pieces float just over its gasket.
  s.panel(
    shell,
    [
      [1.478, -180, 180],
      [1.5, -180, 180],
      [1.535, -180, 180],
      [1.565, -180, 180],
      [1.6, -180, 180],
      [1.638, -180, 180],
      [1.665, -180, 180],
      [1.697, -180, 180],
      [1.725, -180, 180],
      [1.743, -180, 180],
      [1.75, -180, 180],
    ],
    f.alloy,
    B_HEAD,
    44,
    0,
  );
  s.panel(
    shell,
    [
      [1.595, -30, 30, 0.007],
      [1.605, -66, 66, 0.007],
      [1.618, -101, 101, 0.008],
      [1.637, -108, 108, 0.008],
      [1.648, -95, 95, 0.007],
      [1.653, -58, 58, 0.007],
      [1.6535, -18, 18, 0.007],
    ],
    f.visor,
    B_HEAD,
    34,
  );
  s.panel(
    shell,
    [
      [1.651, -88, 88, 0.004],
      [1.664, -115, 115, 0.006],
      [1.687, -155, 155, 0.009],
      [1.701, -180, 180, 0.01],
      [1.725, -180, 180, 0.008],
      [1.743, -180, 180, 0.006],
      [1.751, -180, 180, 0.002],
    ],
    f.crown,
    B_HEAD,
    36,
  );
  for (const side of [-1, 1]) {
    s.panel(
      shell,
      mirror(
        [
          [1.496, 5, 34, 0.004],
          [1.51, 2, 66, 0.006],
          [1.535, 1, 94, 0.007],
          [1.556, 1, 118, 0.005],
          [1.58, 5, 112, 0.004],
          [1.601, 29, 94, 0.004],
          [1.611, 74, 91, 0.003],
        ],
        side,
      ),
      f.ceramic,
      B_HEAD,
      14,
    );
    s.panel(
      shell,
      mirror(
        [
          [1.548, 113, 156],
          [1.567, 105, 174, 0.004],
          [1.601, 109, 178, 0.006],
          [1.649, 111, 177, 0.005],
          [1.68, 129, 176, 0.002],
        ],
        side,
      ),
      f.seam,
      B_HEAD,
      11,
    );
    s.panel(
      shell,
      mirror(
        [
          [1.533, 48, 59, 0.014],
          [1.544, 38, 77, 0.016],
          [1.56, 53, 88, 0.016],
          [1.58, 79, 94, 0.014],
        ],
        side,
      ),
      f.alloy,
      B_HEAD,
      9,
    );
    s.panel(
      shell,
      mirror(
        [
          [1.544, 50, 61, 0.019],
          [1.55, 51, 70, 0.019],
          [1.561, 68, 77, 0.018],
        ],
        side,
      ),
      f.grille,
      B_HEAD,
      6,
    );
    s.panel(
      shell,
      mirror(
        [
          [1.657, 67, 83, 0.012],
          [1.669, 62, 98, 0.014],
          [1.691, 77, 124, 0.012],
          [1.709, 95, 127, 0.009],
          [1.721, 112, 128, 0.008],
        ],
        side,
      ),
      f.seam,
      B_HEAD,
      9,
    );
    s.dial(
      [side * 0.114, 1.615, -0.029],
      [side, 0, 0],
      [
        [0.034, 0, f.alloy],
        [0.031, 0.005, f.silver],
        [0.026, 0.008, f.alloy],
        [0.022, 0.009, f.seam],
        [0.016, 0.01, f.alloy],
        [0.012, 0.011, f.silver],
        [0.006, 0.011, f.grille],
        [0.0002, 0.011, f.alloy],
      ],
      B_HEAD,
    );
    s.panel(
      shell,
      mirror(
        [
          [1.622, 91, 103, 0.01],
          [1.626, 93, 107, 0.01],
        ],
        side,
      ),
      f.lamp,
      B_HEAD,
      5,
    );
  }
  s.panel(
    shell,
    [
      [1.501, -7, 7, 0.003],
      [1.512, -15, 15, 0.008],
      [1.532, -19, 19, 0.008],
      [1.549, -13, 13, 0.007],
      [1.562, -5, 5, 0.003],
    ],
    f.seam,
    B_HEAD,
    8,
  );
}

function torso(s: Surface, female: boolean, rest: readonly number[]) {
  const w = female ? 0.83 : 1;
  const ribcage = contour(
    (
      [
        [0.971, 0.157, 0.12, -0.022],
        [1.02, 0.156, 0.121, -0.01],
        [1.07, 0.15, 0.11, 0.003],
        [1.12, 0.148, 0.108, 0.009],
        [1.18, 0.164, 0.123, 0.001],
        [1.235, 0.182, 0.14, -0.002],
        [1.285, 0.201, 0.154, -0.01],
        [1.345, 0.205, 0.154, -0.015],
        [1.39, 0.199, 0.139, -0.025],
        [1.425, 0.167, 0.115, -0.04],
        [1.452, 0.087, 0.087, -0.041],
      ] as const
    ).map(([h, rx, rz, z]) => [h, 0, z, rx * w, rz * (female ? 0.97 : 1) + (female && h > 1.18 && h < 1.37 ? 0.014 : 0)]),
    0,
    0.9,
  );
  // Tuck the lower outer pectoral into the reach envelope of the upright saddle handles.
  const thorax: Form = (h, a, offset) => {
    const p = ribcage(h, a, offset);
    const outer = Math.min(1, Math.max(0, (Math.abs(p[0]) - 0.045) / 0.057));
    const lower = Math.min(1, Math.max(0, (1.38 - h) / 0.055), Math.max(0, (h - 1.185) / 0.052));
    p[2] -= 0.03 * outer * lower * Math.max(0, Math.cos((a * Math.PI) / 180));
    return p;
  };
  // The ivory breastplate spans the sternum; the shoulders pivot behind its raised collar.
  s.panel(
    thorax,
    [
      [1.211, -14, 14, 0.004],
      [1.226, -42, 42, 0.009],
      [1.256, -60, 60, 0.015],
      [1.304, -65, 65, 0.019],
      [1.352, -60, 60, 0.019],
      [1.379, -52, 52, 0.014],
      [1.406, -33, 33, 0.01],
      [1.418, -24, 24, 0.005],
    ],
    f.ceramic,
    B_UPPER_CHEST,
    24,
  );
  s.panel(
    thorax,
    [
      [0.996, -12, 12, 0.007],
      [1.024, -27, 27, 0.009],
      [1.062, -34, 34, 0.01],
      [1.08, -25, 25, 0.009],
    ],
    f.seam,
    B_SPINE,
    12,
  );
  for (let i = 0; i < 3; i++) {
    const y = 1.065 + i * 0.053;
    s.panel(
      thorax,
      [
        [y, -21, 21, 0.009],
        [y + 0.012, -37, 37, 0.014],
        [y + 0.04, -40, 40, 0.016],
        [y + 0.053, -31, 31, 0.009],
      ],
      i === 2 ? f.ceramic : f.seam,
      i === 0 ? B_SPINE : B_CHEST,
      14,
    );
    s.panel(
      thorax,
      [
        [y + 0.014, -1.1, 1.1, 0.019],
        [y + 0.04, -1.2, 1.2, 0.02],
      ],
      f.alloy,
      i === 0 ? B_SPINE : B_CHEST,
      3,
      0,
    );
  }
  s.panel(
    thorax,
    [
      [1.022, 171, 189, 0.004],
      [1.05, 153, 207, 0.009],
      [1.14, 147, 213, 0.01],
      [1.22, 149, 211, 0.013],
      [1.29, 158, 202, 0.01],
      [1.315, 166, 194, 0.005],
    ],
    f.seam,
    B_CHEST,
    14,
  );
  for (const side of [-1, 1]) {
    // Clavicles meet at a shallow V, overlap the rib plates, and leave an open armhole.
    s.panel(
      thorax,
      mirror(
        [
          [1.229, 42, 53, 0.008],
          [1.251, 47, 64, 0.015],
          [1.29, 53, 77, 0.018],
          [1.344, 46, 80, 0.022],
          [1.379, 38, 81, 0.021],
          [1.41, 30, 79, 0.017],
          [1.436, 34, 71, 0.012],
          [1.441, 46, 62, 0.006],
        ],
        side,
      ),
      f.chest,
      B_UPPER_CHEST,
      17,
    );
    s.panel(
      thorax,
      mirror(
        [
          [1.39, 40, 46, 0.02],
          [1.399, 38, 49, 0.022],
          [1.421, 44, 54, 0.02],
          [1.43, 48, 55, 0.016],
        ],
        side,
      ),
      f.alloy,
      B_UPPER_CHEST,
      8,
    );
    s.panel(
      thorax,
      mirror(
        [
          [1.401, 41, 45, 0.026],
          [1.417, 46, 50, 0.024],
        ],
        side,
      ),
      f.glass,
      B_UPPER_CHEST,
      4,
    );
    s.panel(
      thorax,
      mirror(
        [
          [1.233, 74, 96, 0.001],
          [1.268, 69, 113, 0.007],
          [1.32, 78, 122, 0.008],
          [1.36, 83, 111, 0.002],
        ],
        side,
      ),
      f.grille,
      B_CHEST,
      7,
    );
    s.panel(
      thorax,
      mirror(
        [
          [1.228, 133, 157, 0.003],
          [1.255, 116, 177, 0.008],
          [1.324, 109, 178, 0.014],
          [1.38, 115, 175, 0.012],
          [1.423, 126, 157, 0.008],
        ],
        side,
      ),
      f.ceramic,
      B_UPPER_CHEST,
      13,
    );
    for (let i = 0; i < 3; i++) {
      const y = 1.101 + 0.041 * i;
      s.panel(
        thorax,
        mirror(
          [
            [y, 24, 48, 0.004],
            [y + 0.012, 13, 75, 0.009],
            [y + 0.033, 12, 88, 0.009],
            [y + 0.045, 27, 75, 0.002],
          ],
          side,
        ),
        i === 2 ? f.seam : f.ceramic,
        i === 0 ? B_SPINE : B_CHEST,
        10,
      );
    }
  }
  band(s, thorax, 1.42, 1.44, f.rubber, B_UPPER_CHEST, 0.001);
  band(s, thorax, 1.439, 1.448, f.silver, B_UPPER_CHEST, 0.002);
  s.panel(
    thorax,
    [
      [1.042, -10, 10, 0.002],
      [1.066, -25, 25, 0.007],
      [1.108, -29, 29, 0.008],
      [1.133, -21, 21, 0.004],
    ],
    f.seam,
    B_SPINE,
    10,
  );
  // Slightly left of the sternum, a concentric motor with a dark glass centre and a cyan annulus.
  s.dial(
    [0.068 * w, 1.338, female ? 0.177 : 0.165],
    [0.29, 0.14, 0.948],
    [
      [0.043, 0, f.alloy],
      [0.041, 0.005, f.silver],
      [0.036, 0.007, f.alloy],
      [0.03, 0.008, f.seam],
      [0.025, 0.009, f.lamp],
      [0.022, 0.009, f.glass],
      [0.016, 0.011, f.glass],
      [0.0002, 0.013, f.glass],
    ],
    B_UPPER_CHEST,
    36,
  );
  for (const side of [-1, 1]) {
    const upper = side > 0 ? 7 : 11,
      fore = upper + 1;
    const root = rest[upper * 3]! * side,
      elbow = rest[fore * 3]! * side,
      wrist = rest[(fore + 1) * 3]! * side;
    const y = female ? 1.385 : 1.378,
      z = female ? -0.052 : -0.071,
      r = female ? 0.78 : 1;
    const sleeve = contour(
      [
        [root - 0.038, y, z, 0.077 * r, 0.08 * r],
        [root + 0.007, y, z, 0.095 * r, 0.092 * r],
        [root + 0.065, y, z, 0.084 * r, 0.08 * r],
        [root + 0.125, y, z, 0.069 * r, 0.071 * r],
        [elbow - 0.025, y, z, 0.061 * r, 0.065 * r],
        [elbow + 0.032, y, z, 0.072 * r, 0.072 * r],
        [elbow + 0.09, y, z, 0.067 * r, 0.064 * r],
        [wrist - 0.024, y, z, 0.042 * r, 0.047 * r],
        [wrist + 0.006, y, z, 0.039 * r, 0.044 * r],
      ],
      side,
    );
    s.panel(
      sleeve,
      [
        [root - 0.034, -1, 174, 0.001],
        [root - 0.021, -51, 223, 0.008],
        [root + 0.016, -64, 244, 0.017],
        [root + 0.056, -61, 237, 0.017],
        [root + 0.098, -37, 218, 0.012],
        [root + 0.126, 26, 165, 0.004],
      ],
      f.ceramic,
      upper,
      21,
    );
    // A separate crown overlaps the shoulder guard. The dark recessed strip runs along its leading edge.
    s.panel(
      sleeve,
      [
        [root - 0.011, 34, 140, 0.02],
        [root + 0.006, 17, 166, 0.023],
        [root + 0.049, 16, 172, 0.023],
        [root + 0.085, 44, 153, 0.018],
        [root + 0.107, 77, 107, 0.009],
      ],
      f.seam,
      upper,
      16,
    );
    s.panel(
      sleeve,
      [
        [root + 0.007, 49, 60, 0.028],
        [root + 0.043, 44, 55, 0.029],
        [root + 0.076, 56, 67, 0.024],
      ],
      f.alloy,
      upper,
      4,
      0,
    );
    s.panel(
      sleeve,
      [
        [root + 0.014, 51, 54, 0.029],
        [root + 0.047, 49, 52, 0.03],
        [root + 0.067, 55, 58, 0.026],
      ],
      f.brass,
      upper,
      3,
      0,
    );
    s.panel(
      sleeve,
      [
        [root + 0.12, -24, 191],
        [root + 0.137, -43, 211, 0.005],
        [elbow - 0.041, -42, 191, 0.006],
        [elbow - 0.027, 13, 152, 0.001],
      ],
      f.seam,
      upper,
      12,
    );
    s.panel(
      sleeve,
      [
        [elbow + 0.014, 36, 160, 0.003],
        [elbow + 0.04, -52, 214, 0.01],
        [elbow + 0.081, -61, 229, 0.012],
        [wrist - 0.037, -34, 212, 0.008],
        [wrist - 0.011, 10, 164, 0.002],
      ],
      f.limb,
      fore,
      16,
    );
    s.panel(
      sleeve,
      [
        [elbow + 0.07, 72, 85, 0.016],
        [elbow + 0.093, 69, 87, 0.017],
        [wrist - 0.051, 75, 86, 0.013],
      ],
      f.glass,
      fore,
      4,
    );
    s.panel(
      sleeve,
      [
        [elbow + 0.082, 76, 81, 0.02],
        [wrist - 0.064, 77, 82, 0.016],
      ],
      f.lamp,
      fore,
      3,
    );
    band(s, sleeve, wrist - 0.012, wrist - 0.002, f.alloy, fore, 0.003);
    jet(s, side, w);
  }
}

function jet(s: Surface, side: number, w: number) {
  // Vanes taper into the shoulder blade and clear the back of the head during a mounted lean.
  const podShape = contour(
    (
      [
        [1.218, 0.089, -0.147, 0.032, 0.027],
        [1.242, 0.091, -0.164, 0.047, 0.04],
        [1.28, 0.096, -0.169, 0.054, 0.048],
        [1.355, 0.1, -0.166, 0.055, 0.057],
        [1.407, 0.107, -0.145, 0.049, 0.053],
        [1.431, 0.105, -0.127, 0.039, 0.033],
        [1.445, 0.103, -0.116, 0.011, 0.012],
      ] as const
    ).map(([y, x, z, rx, rz]) => [y, side * x * w, z, rx, rz]),
    0,
    0.68,
  );
  // Keep the engine block horizontal and high on the scapula when the rider leans forward.
  const pod: Form = (h, a, off) => {
    const p = podShape(h, a, off);
    p[1] = 1.322 + (h - 1.22) * 0.5;
    p[0] += 0.014 * side;
    return p;
  };
  s.panel(
    pod,
    [
      [1.221, -180, 180],
      [1.245, -180, 180],
      [1.28, -180, 180],
      [1.355, -180, 180],
      [1.407, -180, 180],
      [1.43, -180, 180],
      [1.445, -180, 180],
    ],
    f.alloy,
    B_UPPER_CHEST,
    18,
    0,
  );
  for (const dir of [-1, 1])
    s.panel(
      pod,
      mirror(
        [
          [1.242, 38, 111, 0.001],
          [1.264, 16, 143, 0.006],
          [1.345, 9, 158, 0.008],
          [1.407, 12, 166, 0.008],
          [1.43, 32, 148, 0.004],
        ],
        dir,
      ),
      f.jet,
      B_UPPER_CHEST,
      10,
    );
  s.panel(
    pod,
    [
      [1.275, 146, 214, 0.006],
      [1.291, 143, 217, 0.008],
      [1.369, 148, 212, 0.01],
      [1.396, 163, 197, 0.006],
    ],
    f.sink,
    B_UPPER_CHEST,
    8,
  );
  for (let j = 0; j < 3; j++)
    s.panel(
      pod,
      [
        [1.3 + j * 0.023, 149, 211, 0.012],
        [1.306 + j * 0.023, 152, 208, 0.014],
      ],
      j === 2 ? f.lamp : f.silver,
      B_UPPER_CHEST,
      6,
    );
  s.dial(
    [side * (0.092 * w + 0.014), 1.33, -0.172],
    [0, -0.92, -0.39],
    [
      [0.036, 0, f.alloy],
      [0.032, 0.003, f.silver],
      [0.027, 0.002, f.alloy],
      [0.021, 0.003, f.lamp],
      [0.015, 0.001, f.grille],
      [0.0002, 0.001, f.grille],
    ],
    B_UPPER_CHEST,
    22,
  );
}

function lower(s: Surface, female: boolean) {
  const hips = contour(
    [
      [0.865, 0, -0.036, 0.168, 0.123],
      [0.921, 0, -0.035, 0.184, 0.132],
      [0.975, 0, -0.027, 0.178, 0.137],
      [1.031, 0, -0.014, 0.157, 0.119],
      [1.061, 0, -0.004, 0.145, 0.102],
    ],
    0,
    0.92,
  );
  band(s, hips, 0.979, 1.012, f.rubber, B_HIPS, 0.004);
  for (const side of [-1, 1]) {
    s.panel(
      hips,
      mirror(
        [
          [0.928, 59, 91, 0.002],
          [0.947, 27, 110, 0.006],
          [0.985, 13, 128, 0.009],
          [1.015, 21, 122, 0.008],
          [1.028, 44, 95, 0.004],
        ],
        side,
      ),
      f.seam,
      B_HIPS,
      14,
    );
    const thigh = side > 0 ? 14 : 17,
      shin = thigh + 1,
      cx = side * 0.108;
    const shape: Profile = [
      [0.099, cx, -0.077, 0.044, 0.053],
      [0.16, cx, -0.077, 0.046, 0.057],
      [0.23, cx, -0.082, 0.058, 0.065],
      [0.33, cx, -0.079, 0.07, 0.081],
      [0.393, cx, -0.073, 0.072, 0.088],
      [0.458, cx, -0.048, 0.064, 0.08],
      [0.517, cx, -0.04, 0.061, 0.079],
      [0.577, cx, -0.036, 0.069, 0.077],
      [0.65, cx, -0.032, 0.083, 0.095],
      [0.724, cx, -0.029, 0.094, 0.107],
      [0.807, cx, -0.029, 0.101, 0.113],
      [0.876, cx, -0.035, 0.108, 0.119],
      [0.929, cx, -0.047, 0.107, 0.119],
    ];
    const leg = contour(shape, 0, 0.93);
    s.panel(
      leg,
      mirror(
        [
          [0.567, 2, 33, 0.002],
          [0.595, -24, 75, 0.006],
          [0.659, -41, 102, 0.012],
          [0.756, -42, 122, 0.014],
          [0.823, -31, 131, 0.012],
          [0.868, -5, 122, 0.01],
          [0.903, 42, 100, 0.003],
        ],
        side,
      ),
      f.limb,
      thigh,
      16,
    );
    s.panel(
      leg,
      mirror(
        [
          [0.623, 107, 129, 0.002],
          [0.65, 104, 157, 0.006],
          [0.783, 134, 171, 0.006],
          [0.83, 143, 163, 0.003],
        ],
        side,
      ),
      f.seam,
      thigh,
      8,
    );
    s.panel(
      leg,
      mirror(
        [
          [0.602, 11, 20, 0.009],
          [0.642, 20, 28, 0.017],
          [0.765, 45, 55, 0.019],
          [0.82, 66, 76, 0.015],
        ],
        side,
      ),
      f.seam,
      thigh,
      5,
    );
    s.panel(
      leg,
      mirror(
        [
          [0.718, 52, 57, 0.02],
          [0.741, 56, 62, 0.021],
          [0.765, 63, 67, 0.021],
        ],
        side,
      ),
      f.brass,
      thigh,
      3,
      0,
    );
    // Wrap the hamstring with its own shell. The channel on either side remains visible from the saddle.
    s.panel(
      leg,
      mirror(
        [
          [0.609, 147, 174, 0.005],
          [0.642, 116, 199, 0.008],
          [0.728, 113, 210, 0.012],
          [0.805, 124, 207, 0.011],
          [0.858, 141, 190, 0.005],
        ],
        side,
      ),
      f.seam,
      thigh,
      13,
    );
    const knee = female ? 0.52 : 0.515;
    s.panel(
      leg,
      [
        [knee - 0.065, -12, 12, 0.003],
        [knee - 0.041, -43, 43, 0.008],
        [knee - 0.002, -63, 63, 0.016],
        [knee + 0.037, -53, 53, 0.011],
        [knee + 0.06, -21, 21, 0.003],
      ],
      f.ceramic,
      shin,
      14,
    );
    s.panel(
      leg,
      mirror(
        [
          [0.115, 15, 62, 0.002],
          [0.143, -21, 83, 0.007],
          [0.259, -40, 93, 0.012],
          [0.361, -50, 108, 0.011],
          [0.422, -38, 98, 0.009],
          [0.457, -13, 64, 0.004],
        ],
        side,
      ),
      f.limb,
      shin,
      14,
    );
    s.panel(
      leg,
      mirror(
        [
          [0.256, 88, 105, 0.01],
          [0.281, 85, 109, 0.014],
          [0.395, 93, 112, 0.012],
        ],
        side,
      ),
      f.glass,
      shin,
      5,
    );
    s.panel(
      leg,
      mirror(
        [
          [0.283, 93, 98, 0.017],
          [0.365, 97, 101, 0.016],
        ],
        side,
      ),
      f.lamp,
      shin,
      3,
    );
    s.dial(
      [side * 0.169, knee - 0.002, -0.041],
      [side, 0, 0],
      [
        [0.027, 0, f.rubber],
        [0.023, 0.003, f.silver],
        [0.018, 0.006, f.alloy],
        [0.01, 0.007, f.seam],
        [0.0002, 0.007, f.silver],
      ],
      shin,
      18,
    );
    s.panel(
      leg,
      mirror(
        [
          [0.141, 137, 177, 0.003],
          [0.185, 100, 205, 0.008],
          [0.316, 97, 218, 0.011],
          [0.383, 105, 212, 0.012],
          [0.435, 125, 194, 0.007],
          [0.455, 143, 177, 0.003],
        ],
        side,
      ),
      f.seam,
      shin,
      14,
    );
    s.panel(
      leg,
      mirror(
        [
          [0.178, -66, -32, 0.005],
          [0.223, -76, -27, 0.009],
          [0.34, -82, -34, 0.011],
          [0.395, -71, -37, 0.007],
        ],
        side,
      ),
      f.ceramic,
      shin,
      8,
    );
    band(s, leg, 0.108, 0.13, f.rubber, shin, 0.003);
  }
  s.panel(
    hips,
    [
      [0.88, 166, 194, 0.006],
      [0.903, 146, 214, 0.012],
      [0.956, 136, 224, 0.015],
      [0.991, 143, 217, 0.012],
      [1.012, 155, 205, 0.006],
    ],
    f.seam,
    B_HIPS,
    14,
  );
  s.panel(
    hips,
    [
      [0.902, -7, 7, 0.005],
      [0.932, -14, 14, 0.009],
      [0.969, -19, 19, 0.015],
      [0.991, -12, 12, 0.008],
    ],
    f.seam,
    B_HIPS,
    8,
  );
  s.panel(
    hips,
    [
      [0.968, -13, 13, 0.007],
      [0.98, -18, 18, 0.015],
      [1.013, -15, 15, 0.014],
      [1.022, -8, 8, 0.007],
    ],
    f.alloy,
    B_HIPS,
    7,
  );
}

function boots(s: Surface, female: boolean) {
  for (const side of [-1, 1]) {
    const foot = side > 0 ? 16 : 19,
      toe = side > 0 ? 20 : 21,
      cx = side * 0.112;
    const boot = contour(
      [
        [0.003, cx, 0.002, 0.066, 0.153],
        [0.011, cx, 0.004, 0.071, 0.156],
        [0.022, cx, 0.003, 0.073, 0.154],
        [0.039, cx, -0.007, 0.073, 0.148],
        [0.06, cx, -0.029, 0.068, 0.125],
        [0.083, cx, -0.055, 0.061, 0.092],
        [0.104, cx, -0.07, 0.054, 0.066],
        [0.141, cx, -0.077, 0.049, 0.055],
        [0.154, cx, -0.078, 0.047, 0.052],
      ],
      0,
      0.76,
    );
    s.panel(
      boot,
      [
        [0.002, -180, 180],
        [0.012, -180, 180, 0.002],
        [0.024, -180, 180],
      ],
      f.rubber,
      foot,
      24,
      0,
    );
    s.panel(
      boot,
      [
        [0.022, -135, 135],
        [0.032, -132, 132, 0.003],
        [0.051, -120, 120, 0.004],
        [0.078, -95, 95, 0.004],
        [0.102, -65, 65, 0.003],
        [0.12, -38, 38],
      ],
      f.shoe,
      foot,
      20,
    );
    s.panel(
      boot,
      [
        [0.02, -57, 57, 0.003],
        [0.03, -54, 54, 0.005],
        [0.046, -36, 36, 0.005],
        [0.055, -15, 15, 0.002],
      ],
      f.seam,
      toe,
      11,
    );
    // Toe bumper and instep strap cross the long shoe rather than painting a stripe on it.
    s.panel(
      boot,
      [
        [0.037, -60, 60, 0.006],
        [0.043, -69, 69, 0.007],
        [0.055, -63, 63, 0.006],
        [0.06, -45, 45, 0.004],
      ],
      f.alloy,
      foot,
      16,
    );
    s.panel(
      boot,
      [
        [0.045, -60, 60, 0.01],
        [0.049, -63, 63, 0.011],
        [0.054, -51, 51, 0.01],
      ],
      f.seam,
      foot,
      16,
    );
    s.panel(
      boot,
      [
        [0.069, -43, 43, 0.006],
        [0.081, -50, 50, 0.008],
        [0.095, -37, 37, 0.006],
      ],
      f.seam,
      foot,
      12,
    );
    s.dial(
      [side * 0.167, 0.091, -0.066],
      [side, 0, 0.06],
      [
        [0.024, 0, f.rubber],
        [0.02, 0.004, f.silver],
        [0.017, 0.006, f.alloy],
        [0.011, 0.007, f.seam],
        [0.0002, 0.007, f.alloy],
      ],
      foot,
      18,
    );
    s.panel(
      boot,
      [
        [0.023, 125, 235],
        [0.033, 116, 244, 0.003],
        [0.078, 119, 241, 0.007],
        [0.108, 137, 223, 0.005],
        [0.124, 154, 206],
      ],
      f.alloy,
      foot,
      11,
    );
    band(s, boot, 0.116, female ? 0.14 : 0.148, f.seam, foot, 0.003);
  }
}

function gloves(s: Surface, female: boolean, rest: readonly number[]) {
  for (const side of [-1, 1]) {
    const hand = side > 0 ? 9 : 13,
      wrist = rest[hand * 3]! * side,
      y = female ? 1.387 : 1.379,
      z = female ? -0.051 : -0.064;
    // Four separate knuckle caps leave the palm and the gaps between fingers available to the grip solver.
    const finger = side > 0 ? 22 : 24;
    for (let k = 0; k < 4; k++) {
      const zz = (female ? -0.083 : -0.096) + k * 0.022;
      const xx = (female ? 0.708 : 0.779) + Math.sin(((k + 0.25) * Math.PI) / 4) * 0.009;
      const yy = 1.394 - Math.abs(1.4 - k) * 0.002;
      const cap = contour(
        [
          [xx - 0.006, yy, zz, 0.004, 0.007],
          [xx, yy, zz, 0.008, 0.009],
          [xx + 0.012, yy - 0.001, zz, 0.007, 0.009],
          [xx + 0.017, yy - 0.002, zz, 0.003, 0.006],
        ],
        side,
      );
      s.panel(
        cap,
        [
          [xx - 0.006, 48, 134],
          [xx, 20, 158, 0.001],
          [xx + 0.012, 25, 153, 0.001],
          [xx + 0.017, 53, 126],
        ],
        f.silver,
        finger,
        6,
      );
    }
    const glove = contour(
      [
        [wrist - 0.004, y, z, 0.028, 0.039],
        [wrist + 0.025, y, z, 0.029, 0.044],
        [wrist + 0.071, y - 0.006, z, 0.028, 0.048],
        [wrist + 0.097, y - 0.012, z, 0.022, 0.046],
        [wrist + 0.115, y - 0.016, z, 0.018, 0.041],
      ],
      side,
    );
    s.panel(
      glove,
      [
        [wrist + 0.004, 34, 143],
        [wrist + 0.023, 20, 162, 0.003],
        [wrist + 0.067, 19, 164, 0.004],
        [wrist + 0.092, 32, 152, 0.003],
        [wrist + 0.103, 56, 130],
      ],
      f.rubber,
      hand,
      11,
    );
    s.panel(
      glove,
      [
        [wrist + 0.029, 83, 92, 0.007],
        [wrist + 0.06, 81, 94, 0.008],
      ],
      f.lamp,
      hand,
      4,
    );
  }
}

/** The paired ceramic vanes extend from the stowed engine blocks in air. Only the two small exhaust cores emit. */
function openVents(female: boolean, level: number) {
  const s = new Surface(level);
  for (const side of [-1, 1]) {
    const x = side * ((female ? 0.83 : 1) * 0.096 + 0.014);
    const vane = contour(
      [
        [1.306, x + side * 0.065, -0.271, 0.009, 0.009],
        [1.318, x + side * 0.057, -0.263, 0.02, 0.013],
        [1.354, x + side * 0.03, -0.237, 0.032, 0.014],
        [1.377, x + side * 0.012, -0.21, 0.034, 0.014],
        [1.387, x, -0.194, 0.022, 0.012],
      ],
      0,
      0.68,
    );
    s.panel(
      vane,
      [
        [1.306, -180, 180],
        [1.318, -180, 180],
        [1.354, -180, 180],
        [1.377, -180, 180],
        [1.387, -180, 180],
      ],
      f.seam,
      B_UPPER_CHEST,
      14,
      0,
    );
    s.panel(
      vane,
      [
        [1.312, 149, 210, 0.003],
        [1.332, 127, 229, 0.004],
        [1.368, 132, 226, 0.005],
        [1.38, 147, 209, 0.003],
      ],
      f.jet,
      B_UPPER_CHEST,
      9,
    );
    const core = contour([
      [1.212, x, -0.215, 0.002, 0.002],
      [1.246, x, -0.204, 0.008, 0.008],
      [1.289, x, -0.184, 0.014, 0.014],
      [1.329, x, -0.172, 0.019, 0.018],
    ]);
    s.panel(
      core,
      [
        [1.212, -180, 180],
        [1.246, -180, 180],
        [1.289, -180, 180],
        [1.329, -180, 180],
      ],
      f.lamp,
      B_UPPER_CHEST,
      12,
      0,
    );
  }
  return s.done();
}

export function meridian(body: readonly SourceMesh[], rig: PackRig): SourceMesh[] {
  const female = rig.id === "human_f";
  return body.flatMap((base) => {
    const slot = base.id.split("/").at(-1)!;
    const lods = base.lods.map((lod, level) => {
      const s = new Surface(level);
      s.liner(lod, slot === "hands");
      switch (slot) {
        case "head":
          helmet(s);
          break;
        case "torso":
          torso(s, female, rig.rest);
          break;
        case "hands":
          gloves(s, female, rig.rest);
          break;
        case "legs":
          lower(s, female);
          break;
        case "feet":
          boots(s, female);
          break;
      }
      return s.done();
    });
    const worn = { id: `core:${rig.id}/armor/meridian/${slot}`, rig: rig.id, skeleton: rig.skeleton, lods, flat: 2 };
    const parts = female ? ([worn] as SourceMesh[]) : [worn, loosePiece(worn, slot)];
    if (slot === "torso")
      parts.push({ ...worn, id: `core:${rig.id}/armor/meridian/vents`, lods: lods.map((_, level) => openVents(female, level)) });
    return parts;
  });
}

/** Pack loose gear at ground level. Boots and gloves show one piece in the item atlas;
 * the cuirass is stored with its sleeves tucked inside the armholes. */
function loosePiece(worn: SourceMesh, slot: string): SourceMesh {
  const names: Record<string, string> = { head: "hat", torso: "shirt", hands: "gloves", legs: "pants", feet: "boots" };
  // A piece lying on the ground is seen from standing height at the nearest: it starts at the worn piece's second
  // level, where it was the whole of the worn piece again (the helmet's 5,809 triangles twice in the pack).
  const lods = worn.lods.slice(1).map((src) => {
    const pos: number[] = [],
      uv: number[] = [],
      normals: number[] = [],
      colors: number[] = [],
      indices: number[] = [],
      sections: number[] = [];
    const used = new Map<number, number>();
    for (let t = 0; t < src.indices.length; t += 3) {
      const a = src.indices[t]!,
        b = src.indices[t + 1]!,
        c = src.indices[t + 2]!;
      const x = (src.positions[a * 3]! + src.positions[b * 3]! + src.positions[c * 3]!) / 3;
      if (((slot === "hands" || slot === "feet") && x < 0) || (slot === "torso" && Math.abs(x) > 0.246)) continue;
      for (const v of [a, b, c]) {
        let local = used.get(v);
        if (local === undefined) {
          local = colors.length;
          used.set(v, local);
          pos.push(...src.positions.subarray(v * 3, v * 3 + 3));
          colors.push(src.colors[v]!);
          if (src.uvs) uv.push(...src.uvs.subarray(v * 2, v * 2 + 2));
          if (src.normals) normals.push(...src.normals.subarray(v * 3, v * 3 + 3));
        }
        indices.push(local);
      }
      if (src.sections) sections.push(src.sections[t / 3]!);
    }
    const lo = [Infinity, Infinity, Infinity],
      hi = [-Infinity, -Infinity, -Infinity];
    pos.forEach((v, i) => {
      const k = i % 3;
      lo[k] = Math.min(lo[k]!, v);
      hi[k] = Math.max(hi[k]!, v);
    });
    const offset = [(lo[0]! + hi[0]!) * 0.5, lo[1]!, (lo[2]! + hi[2]!) * 0.5];
    return {
      positions: Float32Array.from(pos, (v, i) => v - offset[i % 3]!),
      indices: Uint32Array.from(indices),
      colors: Uint8Array.from(colors),
      ...(src.uvs ? { uvs: Float32Array.from(uv), normals: Float32Array.from(normals), sections: Uint8Array.from(sections) } : {}),
    };
  });
  return { id: `core:meridian_${names[slot]}/dropped`, lods, flat: 1 };
}

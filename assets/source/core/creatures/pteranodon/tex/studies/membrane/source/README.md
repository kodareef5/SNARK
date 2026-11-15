The immutable generated original is `skin_original.png` (1254 × 1254 RGB), made
with the built-in imagegen tool using the exact text in `skin_prompt.txt`.
No other images were downloaded or generated. The supplied creature concepts
were inspected as art direction; their pixels are only used in check sheets.

`build.py` recomputes every other source file from that original and seeded paths:

| Source | Encoding and purpose |
| --- | --- |
| `skin_detail.png` | 2048² uint16; decode as `(v/65535 - 0.5) * 10`; neutral, illumination-removed skin drawing |
| `paths.json` | Reusable centreline points in metres; `width` and `end` are Gaussian FWHM in millimetres, `strength` is dimensionless; coordinates outside 0–1 wrap |
| `veins_upper.png` | 2048² uint16, 0–1 vessel strength; shared by upper and creased sets |
| `veins_under.png` | Exact horizontal mirror of `veins_upper.png` |
| `creases_quiet.png` | 2048² uint16, fine crease strength of taut skin |
| `creases_gathered.png` | 2048² uint16, quiet plus additional gathered creases |
| `pleats.png` | 2048² uint16, six longer, soft pleat grooves |

All masks are aligned and periodic. Vein pigment, relief and roughness use the
same vessel mask; crease pigment and relief use the same crease masks. The
delivered underside also mirrors the skin detail, quiet creases, height,
roughness and occlusion. Its normal is recomputed after mirroring.

Defaults: `--feature-scale 1 --direction-deg 0`. These change the physical size
and direction of the vector vessels and folds before wrapped rasterisation;
they do not rotate the generated skin microstructure. For the animal painter,
deform the complete aligned field through the UV direction field. When using
separate vector paths, retain their parent tangent at each branch junction.
Do not independently rotate or offset the two membrane faces.

Layer recipe (linear values; H in mm above the encoding minimum):

```
upper/creased base = 0.40 + 0.010*skin - 0.045*veins - 0.007*creases - 0.006*pleats
under base         = 0.60 + 0.010*skin - 0.085*veins - 0.007*creases
H = 0.40 + 0.009*skin + 0.063*blur(veins,0.6px) - 0.022*creases - 0.115*pleats
roughness = 0.75 + 0.009*skin - 0.043*veins + 0.009*creases
```

Base means are solved after sRGB quantisation. Quiet sets use no pleats.
Normal slopes use physical pixel spacing 1/2048 m and the *delivered* uint16
height. Height full range is 0.8 mm, centred at midgrey; it is not independently
normalised for each set. AO is a restrained, isotropic local concavity measure.
All region pixels are magenta; metalness is zero.

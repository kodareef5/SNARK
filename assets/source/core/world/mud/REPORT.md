# Mud · tidal silt after rain

## Round four

I drained half the hollows back to their pressed silt beds. The 31 remaining puddles cover 2.8% of the tile. Each has a level surface, a thin dark meniscus and a broken lip of crust that lifts just outside the waterline. The original silt grain shows through the film. I placed 23 short reed fibres from the existing source images on the water.

Puddle interiors average sRGB (81, 64, 52), close to the adjacent mud at (86, 68, 55). Their median roughness is 0.18. The 3× field reads as earth, while the grazing view picks out the water by reflection. I checked the offset, distance fields, layer registration and relights, and verified the normals against the exported height. The tile mean remains (92, 73, 59). `checks/waterline.png` shows the same puddle under side light and low-sun reflection.

## Round three

I exposed the existing pressed silt in the small hollows and kept standing water in 62 broader basins. Counting connected glossy patches of at least 100 texels at roughness 0.30 or below, the count fell from 931 to 62 and the median patch grew from 2.7 to 55 cm². Damp margins extend about 2–4 cm beyond the waterline. Colour darkens gradually into the deepest water, which averages sRGB (45, 35, 28) with roughness 0.18. The tile mean is (92, 73, 59).

The 3× sheet shows broad stretches of crust between pools. At low sun their level surfaces carry the sheen. I checked the half-offset, 12× and 40× fields, layer alignment and all three relights. The normal map matches the exported height at every texel. `checks/street-distance.png` compares both rounds at 3× and from eye height with the centre of the view 10 m away.

## Round two

I quilted three 1254² images from the built-in image generator sampled at 80–84% of their source size. The three originals in `sources/` include their generation prompts. They cover pressed estuarine silt, chalky grey-brown drying skin with short fissures, and black organic silt after the tide. Local exposure and distance to standing water place their pigment on the existing bed. The darkest tenth of the glossy surface averages sRGB (32, 24, 21), drying ridges average (115, 95, 80), and the whole tile averages (92, 73, 59).

The shallow pools retain their horizontal levels. Their median roughness is 0.19, compared with 0.55 for damp silt and 0.81 for drying crust. I modelled the edges of clay skins, cuts along short fissures, and caps fitted to reed and shell outlines. The tint mask follows exposed inclusions. The RMS height change from round one is 0.10 mm. I regenerated the OpenGL normal and cavity maps from the saved 16-bit height and verified every encoded normal.

At 1:1 the crust breaks into fine plates, and the dark water has a thin margin of visible silt. I reduced the initial contrast after the wet patches looked spotted in the repeat. I inspected the new offset, 3×, 12× and 40× fields and the opposing 15° and high 70° relights. The shell grit is still hard to distinguish from pale sediment at this scale. The close-up sheet compares the two passes with generated flat-light and low-sun references. Its PNG text metadata contains the source prompts.

## Round one

One 2 m tile, with 15 mm from the lowest exposed point to the highest crumb. Standing water covers 11.0% of the surface at roughness 0.30 or below. The largest connected glossy patch covers 22.3 cm². The wet areas average sRGB (83, 65, 52), and the drying ridges above roughness 0.75 average (101, 81, 67).

### Material files

| File | Construction and checks |
| --- | --- |
| `base.png` | Native 2048² silt pigment with fine organic matter, variations in sediment colour and darkening from moisture. Water depth determines how much pigment shows through the turbid surface. The colour calculation uses neither slope nor illumination. The tagged 8-bit sRGB export averages (92, 73, 59). |
| `height.png` | Rounded deposits, compressed beds, small silt crumbs and pinholes form a periodic bed. I filled enclosed depressions to individual horizontal water levels, up to 4.5 mm above their beds, then embedded the debris. Every stage wraps at the tile edges. The 16-bit grayscale export reaches both 0 and 65535. |
| `normal.png` | Wrapped central differences of the exported height, with a texel pitch of 0.9765625 mm. The normal points along `(-dz/dx, +dz/drow, 1)` after normalization, with image rows increasing downward. Recomputing and encoding it reproduced all 4,194,304 RGB texels exactly. |
| `roughness.png` | Basin depth, capillary wetting at the banks and exposure on the ridges control the linear grayscale map. The median glossy texel is 0.21. Damp silt occupies the middle range and the driest silt reaches 0.84. In 99.94% of glossy interior samples, all nine heights in a 3 × 3 neighbourhood are identical. |
| `occlusion.png` | Each texel samples the relief horizon in 16 directions, out to 19 texels. Cosine-weighted sky visibility leaves the open mud bright. Median visibility is 248/255, with the strongest darkening in pinholes and at the bases of crumbs. |
| `tint.png` | Mud and turbid water accept the lot tint. Reed splinters, leaf fragments and 15 small shell chips keep their own pigment. Fourfold subpixel sampling in each axis and partial burial give their outlines fractional coverage. 99.33% of texels take the full tint. |
| `material.json` | Records the physical scale and the rounded mean of the saved base. The natural deposit has a null module. All constituents are dielectric, so the set omits a metal map. |

### Visual checks

| Proof | What I inspected |
| --- | --- |
| `checks/offset.png` | Base, height and roughness, left to right. Shifting each by 1024 texels brings both original joins through its centre. Grain density, shoreline detail and tone continue through the joins. |
| `checks/tiled3.png` | Two full-resolution 6144² fields, colour on the left and grayscale height on the right. The first relief pass had long ribbon-like folds and a later pass had a conspicuous low basin. I softened the folds, broke them up with embedded crumbs and reduced the broadest height outliers. The remaining low pockets are small and distributed. |
| `checks/tiled12.png` | Twelve repeats per side cover 24 m. Each output pixel integrates a 12 × 12 footprint in linear light. The colour resolves into quiet brown grain without a visible grid or diagonal. Across 25 cm squares, the greatest departure from the target mean is 0.9 sRGB code values in any channel. |
| `checks/relit.png` | The top row uses base colour and diffuse light from the height normals. The 15° suns reverse the lit sides of crumbs and banks. The 70° sun brings the pigment forward. The lower row uses the same three suns with a grazing camera, sky reflection and dielectric roughness. The low sun catches isolated level pools between matte ridges. |
| `checks/layers.png` | All six maps show the same 384² crop beginning at (480, 1056). Dark, low-roughness pools have level interiors in height. Splinters and shell material line up with the exclusions in tint. |

### Remaining limitation

The smallest shell chips can read as pale silt grains even at native resolution. I kept them small and low in contrast so a chip would disappear into the ground at street distance. The reflection check is a still render. The brightness of a moving glint will depend on the game's sky and texture filtering.

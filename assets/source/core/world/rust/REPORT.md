# Salt-air rust on steel plate

One 2 m repeat at 2048 × 2048, with 0.977 mm per texel and 5 mm of relief. The measured mean base colour rounds to **sRGB (122, 78, 58)**. Rust covers 99.42% of the plate.

## Material files

| File | Construction and verification |
| --- | --- |
| [base.png](base.png) | I quilted 49 native-resolution photographic crops from three generated fields of oxide. I matched pigment and contrast at several detail scales, attenuated a fine sampling grid in the sources, reduced optical shading along flake lips and routed each join through similar colour and form. Fine grain has a narrow join and larger features have a wider blend. Steel windows and paint chips came from two further generations, including the collar of rust around each piece. The finished 8-bit RGB PNG is tagged sRGB. Quarter-metre square averages stay within 0.8 sRGB levels of the target in every channel. |
| [height.png](height.png) | I traced connected flake contours from their paired lip and recess edges. Each curve carries a modelled cross-section with a narrow groove, raised lip and shoulder tapering into the face. Small closed pore outlines have dished floors. Blisters and granular relief have independent shapes. The same photographic cut and placement carry the form into the quilt. Each steel opening cuts into the oxide bed and each paint fragment sits on its surface. The saved 16-bit greyscale spans 0–65535. The middle 90% of the surface lies between 1.37 and 3.30 mm. |
| [normal.png](normal.png) | Centred differences of the stored height use the physical texel spacing and wrap at the borders. The normal has minus the rightward slope in red and plus the downward image-row slope in green. A separate gradient calculation on the padded PNG reproduced every 8-bit RGB value. |
| [roughness.png](roughness.png) | Rust mineral colour ratios distinguish powder from compact crust. Powder centres near 0.95 and hard scale near 0.75, with local grain in both. The 8-bit linear map measures 0.42 at the median exposed steel texel and 0.60 at the median paint texel. |
| [occlusion.png](occlusion.png) | I sampled the height horizon in eight directions at six distances, to about 17 mm on the diagonal. The darkest marks sit at recessed steel floors, pits and the undersides of modelled lips. The median is 252/255 and 90% of the surface is at least 241/255. |
| [tint.png](tint.png) | This binary mask follows surviving grey-green paint from the paint source, including gaps between adjacent fragments. Coverage is 0.43%. The paint body averages sRGB (108, 114, 105). |
| [metal.png](metal.png) | Neutral steel floors were isolated inside photographed spall outlines. They average sRGB (150, 150, 148) and cover 0.15%. I checked both masks for binary values and zero overlap. |
| [material.json](material.json) | Records the 2 m repeat, 5 mm relief, rounded mean of the finished base PNG and a null module for the unlaid surface. |

## Visual checks

| Sheet | How it was made and what I saw |
| --- | --- |
| [Half-tile offset](checks/offset.png) | Base colour, height and roughness each wrap by 1024 pixels in both axes. The old corners meet within continuous oxide grain. Base colour steps across the horizontal and vertical wraps measure 1.00× and 1.01× their respective interior RMS steps. |
| [Three repeats at native resolution](checks/tiled3.png) | The left 6144-square panel contains nine copies of base colour. The right contains nine copies of height, converted to 8-bit for viewing. Flake size varies locally. The bright steel windows are small enough that the first impression is rust across the field. |
| [Twelve repeats](checks/tiled12.png) and [forty repeats](checks/tiled40.png) | Each 2048-square sheet integrates its full texel footprints in linear light. The 12× field retains fine rusty grain. The 40× field settles into an even ochre-brown without a visible grid or broad stain. |
| [Relit at native resolution](checks/relit.png) | Four views of the same 576 × 438 texels show diffuse colour, a 70° sun and opposing 15° suns. The renders use linear base colour, fill light, physical normals and short shadow rays through the height. Narrow flake lips exchange their lit and shadowed sides between the lower panels. Diffuse colour still shows the feathering of powder over compact rust. |
| [Aligned layer crop](checks/layers.png) | All seven maps use the same native 340-square crop starting at (1157, 193). Exposed steel sits in a recess and has low roughness. Paint sits on the surface and appears in tint. |

## Round two

I replaced the first round's procedural colour patches with photographic oxide and made the exposed steel rarer. The built-in image generator supplied five straight-on, flat-overcast source studies. The three rust prompts requested powder-feathered umber scales, compact marine lamellae, and pitted shipyard plate. The two detail prompts requested freshly spalled neutral steel and surviving grey-sage industrial paint. The [source photographs and generation prompts](sources/PROMPTS.md) are included.

The remaining approximation is at the lip of a curled flake. A single-valued height field can give it an edge and a short cast shadow. It cannot show a separately visible underside. I judged these static crops and repeat fields outside the game.

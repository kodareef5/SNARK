# Roadside stills

Each billboard has its own 3:1 ImageGen plate. The original illustration, headline and brand lettering share a composition. A 32-pixel typeset rider carries the small-print joke on the final 1280 × 420 face. All twenty brand names and headlines were read on the final JPEGs.

| Campaign | Treatment |
| --- | --- |
| Curb Canary | Six golden feathered raptors follow a diagonal crossing. The brass canary horn doubles as the maker's emblem. A yellow service strip picks up the birds' plumage. |
| Seamsure Mutual | A geological cross-section puts an intact bungalow beneath a second neighborhood. A foundation policy in old-style serif type runs beneath the bedrock. |
| Peck & Portion | A waiter lifts the silver cloche on a tray of kibble. Red velvet, gilded menu lettering and a wine-colored footnote frame the compys' banquet. |
| Second Mile Tires | Repeated exposures trail a turquoise sedan on a Miami boulevard. The chrome signature sits over the undisturbed foreground car. |
| Stake & Satin | Dinosaur auctioneers sell a lamp behind a sleeping customer. The bedding, room and label share a rose-satin palette. |
| Ohm Orchard | Vermilion patch cords wind through a two-color halftone switchboard. A typewritten traffic report counts the calls. |
| Fen & Frill | A dilophosaur appears in a single wiped lens of the model's cat-eye glasses. The fashion headline sits in the clear blue sky. |
| Forkhorn Recovery | A trike lifts a red coupe on its brow horns in a tiled service bay. Two enamel workshop signs frame the illustration. |
| Penthouse Plumb | Guests wait at a brass elevator while the manager rises past them in a velvet chair. Gilt lettering follows the atrium's geometry. |
| Parallax Pearl | A second exposure separates the necklace and glove from the sitter. A thin silver wordmark sits in the open lavender field. |
| Orbside Rooms | A nighttime bedroom window frames the illuminated Las Vegas ball. A neon motel signature and a guest-service rider sell the view. |
| Rim Fare Coaches | A yellow tour bus stops where the painted desert ends. A red ticket-shaped logo fills the lavender void. |
| Gravelark Saddlery | A jockey leads a dodo in fine leather tack past a distant grandstand. Oil-painted feathers and a saddler's dodo crest sell the pedigree. |
| Cinder Cradle | A hatchling under a domed incubator sits between two proud rexes. Enamel appliance lettering and a hatchery guarantee finish the product photograph. |
| Proofpocket Color | A slide mount frames a hot-pink rex on the Strip. Distinct blue, red and magenta color fields sell the incident film. |
| Plumbfall Parcel | A parachute and crate descend into a modernist bungalow's roof. A wing emblem and a delivery receipt carry the courier's pitch. |
| Molt & Marrow | A woolly mammoth fills a warmly lit living room beside a thermostat. Furniture-store lettering and an italic operating instruction finish the scene. |
| Palisade Picnic | A raptor passes through a solid wall to steal a sandwich. The check on the picnic hamper repeats behind the brand lettering. |
| Morrowmoth Storage | A brass moth key casts a long shadow across velvet. The vault fades into a high-key studio background behind it. |
| Apronwing Freight | The taut sling connects a small airborne pteranodon to a grounded mammoth. Streamlined aviation lettering runs beside the wing. |

## Rebuild

Run these commands at the repository root with Python 3, Pillow and the URW Base 35 OpenType fonts installed.

```sh
python3 tools/screens/ads2/billboards/prompt.py peck-and-portion
python3 tools/screens/ads2/billboards/render.py
```

The first command expands the production brief and the campaign-specific direction into the exact prompt. Submit it to the built-in image generator as an opaque new image. Preserve the original selected PNGs at `var/ads2/work/billboards/<name>.png` to repeat the original press run.

The second command renders all twenty JPEGs and writes the importer rows under `var/ads2/work/billboards/`. One or more campaign names limit the render to those stills. The renderer uses full-resolution chroma and selects the highest of its preset JPEG qualities that fits the 400,000-byte limit.

The [campaign copy and art direction](campaigns.json), [base prompt](prompt.txt) and [finishing specifications](finish.json) define the plates. Each finishing entry gives the rider design, paper color, ink, accent, font and optional service label in that order.

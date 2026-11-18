# Carbonemys

[Matched previous and revised native renders](form-comparison.png) · [Native model, saddle and motion sheet](native-review.png) · [Six shell levels](shell-levels.png)

The body measures 2.88 × 1.98 × 4.72 m. A single skinned surface runs from the tail, through the trunk and neck, to the hooked upper beak. Each forelimb and hindlimb shares its shoulder or hip boundary with the trunk. The digital webs and short claw tips grow directly from the same wrist surface. The lower jaw has its own articulation, broad rear angle and oral surface. Recessed eyes sit below the postorbital arches.

The carapace has five vertebral, eight costal and 24 marginal scutes. A low, broad ridge extends beneath the vertebral series and fades toward the saddle. The lateral ridges cant toward the rear margin. The nuchal recess, raised anterior lip and lower gular lobe frame the neck. Pigment, directional abrasion and broken growth marks vary independently of the scute boundaries.

## Reference and reconstruction

- Cadena et al. describe the Carbonemys cofrinii skull UF/IGM 41 and illustrate its dorsal, ventral and lateral views. Condylobasal length is 16 cm, with maximum indicated length 21 cm and width 13 cm. The broad rear skull and masticatory surface informed the new head. The authors describe the 173 cm carapace UF/IGM 71 from the same horizon as Pelomedusoides shell taxon A. Its association with the skull remains uncertain. [Primary specimen paper, figures 2–4 and table 1](https://stri-apps.si.edu/docs/publications/pdfs/STRI-W_Jaramillo_2012_Cadena_carbonemys_cerrejon.pdf)
- The Natural History Museum Vienna’s Arrau turtle skeleton NHMW-ZOO-HS-1904 documents the joint arrangement, splayed digital rays and shell architecture of a comparative living pleurodire. The museum lists its scan as CC BY-NC. The public museum image was consulted for anatomy. Original mesh and material construction are in this species folder. [Museum specimen](https://sketchfab.com/3d-models/arrau-turtle-skeleton-nhmw-zoo-hs-1904-eb70e34f13f94ce1a7aecec255af5828)
- The official Wildcard dossier informed the substantial limbs, large riding scale and serrated posterior shell. The exact shell vault, lip, longitudinal keels, cheek musculature, folds, pigments and saddle are original game reconstructions. [Studio Wildcard Carbonemys dossier](https://survivetheark.com/index.php?/gallery/image/125-carbonemys/)
- Innerscene labels its Hermann’s tortoise study CC0. Its public preview was consulted for the marginal band and recessed limbs as a terrestrial comparison. [Creator’s model and license](https://www.innerscene.com/tools/library/3d-parts/hermann-s-tortoise-88ac8979)

## Native checks

The body and rig use `core:carbonemys`. The worn mesh `core:saddle_carbonemys/worn` shares the shell bone. Carapace and plastron use torso zone 2, exposed neck and head use head zone 1, the limbs use their respective side zones and the tail uses zone 11. The front three body LODs have materials. The three distant levels retain palette and dye colours.

The walk travels 1.26 m in 36 ticks, the run 1.26 m in 18 ticks and swimming covers 3.2 m in 30 ticks. At tick 12 of the 25-sample bite, the mouth socket is 2.577 m forward and 0.659 m above the animal’s origin. The seat stays 2.036 m high and 0.730 m forward. At default scale the packaged female and male bodies' feet and palms clear the carapace in the shared riding pose. Nearest human hand and foot vertices lie 12–18 mm from their grip and tread sockets.

The native shell check projects 6,384 interior points from 40 directions per LOD and checks the pixel’s drawn depth against each sample. All 1,532,160 projections hit the shell before the sample. The near body has 21,312 triangles and the terminal body has 400. The gait suite passed at adult and half scale. The comparison sheet holds the pose, camera and light fixed. The two game-distance rows retain a roughly 300-pixel-wide body. The crops show source RGBA textures on the native CPU renderer. The native game client handles platform texture compression and scene lighting.

To reproduce from the repository root:

```sh
species=assets/source/core/creatures/carbonemys
mkdir -p var/carbonemys/previous
git archive f33d1a13 -- "$species" | tar -x -C var/carbonemys/previous
bun tools/art.ts core:carbonemys --no-sheet
bun "$species/form-review.ts" "var/carbonemys/previous/$species" var/carbonemys/before
bun "$species/form-review.ts" "$species" var/carbonemys/after
python3 "$species/ref/compare.py" var/carbonemys/before var/carbonemys/after var/carbonemys/form-comparison.png
bun "$species/review.ts" var/carbonemys/views-delivery
bun "$species/shell-review.ts" var/carbonemys/shell-review
bun test tests/unit/gait.test.ts
```

[Pack, view, comparison and reference digests](native.json)

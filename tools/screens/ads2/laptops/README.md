# Laptop screens

Eight fictional programs show how the city accounts for server failures. Each has its own original image plate. The built-in image generation tool made the plates. Pillow sets the interface type using the local URW Base 35 fonts.

## Rebuild

The original plates are in `var/ads2/work/laptops/art/<name>.png`. To generate replacements, submit the corresponding entry in [prompts.json](prompts.json) as one built-in imagegen request with an opaque background. Generation produces variations. Keep the original plates to reproduce these exact compositions.

Run the following command from the worktree root with Python 3, Pillow and the URW OpenType fonts installed.

```sh
python3 tools/screens/ads2/laptops/render.py
```

[render.py](render.py) writes the eight JPEGs to `var/ads2/out/` and the ingest rows to `var/ads2/work/laptops/rows.csv`. It uses full chroma resolution for small colored type. It opens each final JPEG, confirms the 1280 × 800 dimensions and enforces the 400,000-byte ceiling.

## Plates and layouts

| Name | Plate and composition | In-world joke |
| --- | --- | --- |
| parcel-weather | A sunlit Miami survey photo of a single rain cloud sits beside the municipal weather controls. | The admin assigns four inches of rain per hour to the rival tribe’s roof. |
| brinewire-exchange | A sea-green wood engraving sits behind the circular dial of a marine telephone exchange. | Both ends of the severed server cable are circling the repair boat. |
| dodo-standby | A lounge portrait fills the stub of a perforated railway ticket. | The server kicks a player to make room for the owner’s favorite dodo. |
| lastplank-ledger | A silver-gelatin news photo accompanies four entries in a typeset night ledger. | A rex carries off the gate. The lock still reports secure. |
| collar-ferry | An engraved coastal chart carries the ferry track and two position fixes beside the radio log. | The raptor’s collar bought a ferry ticket. The raptor remains unaccounted for. |
| keepsake-queue | A glass jar holds a miniature base beside the town archive’s wipe timer. | The backup preserved all 42 foundations in a single photograph. |
| mammoth-appeal | A forensic typewriter photograph accompanies a mammoth’s court petition. | The mammoth flooded tribe chat by stepping on the keyboard. The witness is unavailable. |
| rex-key-finder | A cyan fluoroscope plate occupies the diagnostic viewer beside two location reports. | The client puts the spare key in your pocket. The server puts it inside a rex. |

The final stills were opened at native size to review all text, crop boundaries and evidence. That review moved the tracking map’s first fix onto the drawn pier.

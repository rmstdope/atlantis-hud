# The Painted texture set: how each picture was made

The 17 pictures of the **Painted** texture set (`config/public/biomes/painted/`, ah-d9jb.3) were
painted by an image model on 2026-10-02, in the biome spike for ah-d9jb, and chosen one per biome by
the navigator. Nothing is generated at runtime; the pictures are ordinary committed files. This
record is kept with the project and deliberately not shown in the app.

## Model and licence

- **Model:** black-forest-labs/FLUX.2-klein-9B, run locally through mflux
  (`mflux-generate-flux2 --model flux2-klein-9b`) on Apple Silicon.
- **Licence:** FLUX Non-Commercial License v2.1. Of outputs it says: "You may use Output for any
  purpose (including for commercial purposes), except as expressly prohibited herein". The
  prohibition that applies to outputs is using them to train a model that competes with FLUX.

## How

Image-to-image from each biome's procedural noise base, which is committed beside this file as
`noise/<biome>.png` (the spike's option B noise, exported from its mockup). `run_nr.sh` is the script
that ran, with one edit: the absolute path to `mflux-generate-flux2` on the machine it ran on is now a
bare command name. Run from here, it writes its `nr_*.png` and `*.log` files into this directory and
skips any that already exist. In it the prompt is the biome's subject line followed by the shared
style line, and every run used

- `--image noise/<biome>.png 0.3` (strength 0.3)
- `--steps 4 -q 8 --width 512 --height 512`
- `--seed` 21, 22 and 23, of which one per biome was chosen (below).

The pictures are 512 px squares, copied byte for byte from the spike's output. They do not tile:
the map stretches each one once over its hex, turns it in sixths of a turn, and mirrors the sea
where it wraps.

## The chosen picture for each biome

| Biome | Shipped as | Spike output | Seed | Init image |
|---|---|---|---|---|
| ocean | `config/public/biomes/painted/ocean_512.png` | `nr_ocean_s23.png` | 23 | `noise/ocean.png` |
| plain | `config/public/biomes/painted/plain_512.png` | `nr_plain_s21.png` | 21 | `noise/plain.png` |
| forest | `config/public/biomes/painted/forest_512.png` | `nr_forest_s23.png` | 23 | `noise/forest.png` |
| mountain | `config/public/biomes/painted/mountain_512.png` | `nr_mountain_s22.png` | 22 | `noise/mountain.png` |
| swamp | `config/public/biomes/painted/swamp_512.png` | `nr_swamp_s22.png` | 22 | `noise/swamp.png` |
| desert | `config/public/biomes/painted/desert_512.png` | `nr_desert_s21.png` | 21 | `noise/desert.png` |
| jungle | `config/public/biomes/painted/jungle_512.png` | `nr_jungle_s22.png` | 22 | `noise/jungle.png` |
| tundra | `config/public/biomes/painted/tundra_512.png` | `nr_tundra_s22.png` | 22 | `noise/tundra.png` |
| volcano | `config/public/biomes/painted/volcano_512.png` | `nr_volcano_s21.png` | 21 | `noise/volcano.png` |
| wasteland | `config/public/biomes/painted/wasteland_512.png` | `nr_wasteland_s23.png` | 23 | `noise/wasteland.png` |
| hill | `config/public/biomes/painted/hill_512.png` | `nr_hill_s22.png` | 22 | `noise/hill.png` |
| cavern | `config/public/biomes/painted/cavern_512.png` | `nr_cavern_s23.png` | 23 | `noise/cavern.png` |
| underforest | `config/public/biomes/painted/underforest_512.png` | `nr_underforest_s22.png` | 22 | `noise/underforest.png` |
| tunnels | `config/public/biomes/painted/tunnels_512.png` | `nr_tunnels_s21.png` | 21 | `noise/tunnels.png` |
| grotto | `config/public/biomes/painted/grotto_512.png` | `nr_grotto_s23.png` | 23 | `noise/grotto.png` |
| deepforest | `config/public/biomes/painted/deepforest_512.png` | `nr_deepforest_s21.png` | 21 | `noise/deepforest.png` |
| chasm | `config/public/biomes/painted/chasm_512.png` | `nr_chasm_s22.png` | 22 | `noise/chasm.png` |

#!/bin/zsh
S=${0:A:h}
STYLE="seen from directly above, hand-painted fantasy map texture, large readable shapes, uniform coverage edge to edge, no horizon, no text"
typeset -A SUBJ
SUBJ[ocean]="Top-down view of open deep ocean, deep blue water with long curved white wave crests"
SUBJ[plain]="Top-down view of open grassland plains, light yellow-green meadow with scattered grass tufts and small flower patches"
SUBJ[mountain]="Top-down view of a rugged mountain range, grey rocky peaks and ridges with white snow caps and strong shadows"
SUBJ[desert]="Top-down view of a sand desert, warm golden sand dunes with curved crests and soft shadows"
SUBJ[tundra]="Top-down view of frozen tundra, pale blue-white snow with patches of grey-green moss, small rocks and ice cracks"
SUBJ[volcano]="Top-down view of volcanic land, black basalt rock with glowing orange lava cracks and small craters"
SUBJ[wasteland]="Top-down view of a barren wasteland, rusty red-brown cracked dry earth with scattered dead stones"
SUBJ[hill]="Top-down view of rolling hills, ochre-brown rounded mounds with grassy tops and soft shading"
SUBJ[cavern]="Top-down view of an underground cavern floor, dark slate-grey stone with boulders and stalagmites lit by dim purple light"
SUBJ[tunnels]="Top-down view of underground tunnels, dark rock with winding narrow lit passages in cool grey-blue"
SUBJ[grotto]="Top-down view of an underground grotto, glowing teal water pools among dark stone and pale crystals"
SUBJ[underforest]="Top-down view of an underground fungal forest, giant mushroom caps in muted olive and violet tones on dark ground"
SUBJ[deepforest]="Top-down view of a deep subterranean forest, dense very dark green fungal canopy with tiny bioluminescent cyan dots"
SUBJ[chasm]="Top-down view of a deep chasm, jagged black cracks and fissures splitting dark maroon-purple rock"
SUBJ[forest]="Top-down view of a dense temperate forest, round dark cool blue-green tree crowns with soft cast shadows"
SUBJ[swamp]="Top-down view of a murky swamp, muddy brown-olive ground with open teal-grey water pools, reed tufts and ripples"
SUBJ[jungle]="Top-down view of a tropical jungle canopy, rich natural green palm fronds and large star-shaped leaves with some lime highlights, natural colours"
for k in ${(k)SUBJ}; do for s in 21 22 23; do
  [ -f "$S/nr_${k}_s$s.png" ] && continue
  mflux-generate-flux2 --model flux2-klein-9b --prompt "$SUBJ[$k], $STYLE" --image "$S/noise/$k.png" 0.3 \
    --steps 4 --seed $s --width 512 --height 512 -q 8 --output "$S/nr_${k}_s$s.png" > "$S/nr_${k}_s$s.log" 2>&1 || echo "FAIL $k $s"
done; done
echo done

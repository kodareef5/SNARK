// The guide a model reads as the resource snark://guide: how the tools fit together for the longer things a player does.

export const GUIDE = `# Playing SNARK through these tools

You are one survivor. You can do what a player can and no more.

## Places and ids
- Places are x and z in metres, north +z and east -x, or lat and lon as the map screen gives them (lat grows south and lon east from 0 at the map's top left, a unit 102.4 m and ten a sector). A storey of a building is chosen with y, metres up.
- Ids come from observe: n12.3 a tree, rock or bush; s65539 something built; e7 a creature, a player, a car, a dead body, an egg or a bag.
- Every answer has a state: done, running (status with wait_s waits for it), blocked (reason says why), danger (it stopped for a danger) or refused (nothing was done).

## Long actions
go_to, harvest, attack, open, craft at a station, place, mount, carry, structure and use_item on a creature walk first and take time, one at a time. Each answers when it ends or after wait_s with running; cancel stops it.

## Survival
- Food and water fall by themselves: a survivor's 100 water lasts about 26 minutes, 100 food about 39. status shows them as [now, most].
- Eat with use_item: berries, cooked meat. Raw meat and spoiled meat hurt.
- Drink with use_item item water standing or swimming in a lake or the sea, a tenth a drink; or fill a water skin by using it standing in shallow water, and drink it later.
- Swimming at the surface costs no breath. go_to swims where that is the way.

## Gathering and crafting
- harvest a tree with a hatchet for wood and thatch, a rock with a pick for stone and flint, a bush by hand for berries and fibre, a dead body for meat and hide.
- snark://recipes lists what each thing takes, where it is made and whether you know it. craft with learn true spends engram points; they come with levels.

## Stations
- place a campfire, mortar, smithy, forge, fabricator or preserving bin, then open it and move_item fuel and ingredients into it (to box).
- structure do light lights a fire, a forge, a fabricator or a bin; it needs its fuel in it. put_out puts it out, and loses what was cooking.
- A fire makes some things by itself while it burns and their ingredients lie in it: cooked meat at a campfire, ingots and gasoline at a forge, jerky at a preserving bin. craft says so.
- Other things are crafted at the station with craft at: sparkpowder, gunpowder and narcotics at a mortar; guns, rounds and metal pieces at a smithy; polymer and electronics at a lit fabricator. They are made from what lies in it and land in it: move_item from box takes them out.

## Building
- place a foundation on open ground at x and z; then another on its side north, east, south or west.
- place a wall on a foundation's side; as doorframe for a doorframe; a door with on the doorframe.
- place a ceiling with on a wall and side top: it goes over the room the wall stands on. Stairs go on a foundation or ceiling.
- A bed, box or fire goes on a floor with on, or on the ground at x and z. structure name names a bed; you may rise at it after a death.

## Taming, saddling and riding
1. attack with until out knocks a creature out: a club, fists, a slingshot, or tranquilizer arrows from a bow or crossbow (with ammo). A flyer flies off when hit, so shoot it.
2. use_item meat (or what it eats: snark://creatures) on it puts the food in its inventory; it eats by itself as it gets hungry. open on it shows how its taming goes. A narcotic used on it keeps it under longer.
3. Once tamed, status news says so and it is yours. order name names it; order follow, stay and the stances command it.
4. use_item its saddle on it, then mount it. go_to then rides; attack bites with it. mount with off true gets off.

## Flying
On a saddled pteranodon, go_to flies there over the skyline and sets down on dry level ground; with land false it hovers. It spends stamina in the air and gets none back until it stands.

## Cars
observe lists cars and who drives them. mount a car gets in the driver's seat; go_to drives on ground a car can climb; mount off gets out.

## Fighting
attack with a bow, crossbow, slingshot or gun takes it in hand, loads the ammunition you name or carry, shoots from range and leads a moving target. use_item armour wears it; status shows what is worn.

## Travel
travel with no to lists the cluster's servers; with to it walks to an obelisk's terminal and goes, with all you carry.
`;

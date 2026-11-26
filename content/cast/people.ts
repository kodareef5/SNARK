// Cast's people: looks, archetypes, name pools and the lines they say. A few of each, enough to run every scene; more
// come from the teams filling the catalogue (planning/workstreams/cast.md). Looks are the human body in the game's own
// clothes until people have models and skins of their own: each look that waits for art is a placeholder with a note.
// The body under the clothes is drawn from the look's population (content/people/defaults.ts).

import type { Archetype, Look } from "../../shared/cast/catalogue.ts";

const HUMAN = "core:human";
const wear = (tier: string, ...pieces: string[]) => pieces.map((p) => `core:${tier}_${p}`);

export const LOOKS: Look[] = [
  { id: "cast:street_plain", mesh: HUMAN, wear: wear("cloth", "shirt", "pants", "boots"), colors: [15, 1, 225], population: "core:people_city", placeholder: true, note: "t-shirt, jeans, trainers" },
  { id: "cast:street_bright", mesh: HUMAN, wear: wear("cloth", "shirt", "pants", "boots"), colors: [93, 46, 1], population: "core:people_city", placeholder: true, note: "loud shirt, shorts, sandals" },
  { id: "cast:office", mesh: HUMAN, wear: wear("cloth", "shirt", "pants", "boots"), colors: [1, 65, 2], population: "core:people_workers", placeholder: true, note: "shirt and slacks, a lanyard" },
  { id: "cast:tourist", mesh: HUMAN, wear: wear("cloth", "hat", "shirt", "pants", "boots"), colors: [50, 93, 15], population: "core:people_tourists", placeholder: true, note: "sun hat, camera, sunburn" },
  { id: "cast:runner", mesh: HUMAN, wear: wear("cloth", "shirt", "pants"), colors: [46, 2, 1], population: "core:people_beach", placeholder: true, note: "running vest and shorts, earbuds" },
  { id: "cast:swimwear", mesh: HUMAN, wear: [], colors: [65, 50, 93], population: "core:people_beach", placeholder: true, note: "swimwear, towel over a shoulder" },
  { id: "cast:vendor_apron", mesh: HUMAN, wear: wear("cloth", "hat", "shirt", "pants", "boots"), colors: [1, 46, 15], population: "core:people_workers", placeholder: true, note: "apron and cap" },
  { id: "cast:police", mesh: HUMAN, wear: wear("flak", "hat", "shirt", "pants", "boots"), colors: [65, 2, 2], population: "core:people_city", placeholder: true, note: "Miami police uniform, badge, duty belt" },
  { id: "cast:gang_red", mesh: HUMAN, wear: wear("hide", "shirt", "pants", "boots"), colors: [46, 2, 2], population: "core:people_city", placeholder: true, note: "red bandana and colours, Southside" },
  { id: "cast:gang_teal", mesh: HUMAN, wear: wear("hide", "shirt", "pants", "boots"), colors: [50, 2, 1], population: "core:people_city", placeholder: true, note: "teal colours, Bayfront" },
];

/** Lines every everyday person can say, merged into each such archetype's own. */
const FOLK = {
  greet: ["Hey!", "Morning.", "Oh, hi.", "There you are!"],
  near: ["Excuse me.", "Sorry, coming through.", "Oh! Didn't see you there."],
  stare: ["Can I help you?", "What are you looking at?", "Do I know you?"],
  wave: ["Hey there!", "Hi!", "Hello, stranger."],
  talk: ["Can't stop, sorry.", "Ask somebody else, I'm not from here.", "Stay safe out there, the dinos are bad today."],
  flee: ["Run!", "Oh no, no, no!", "Get away from me!"],
  attacked: ["Help! Somebody help!", "Are you crazy?!", "Police!"],
  angry: ["Watch it!", "Hey! You hit me!", "Are you blind?"],
  apology: ["My bad, my bad.", "Sorry! Totally my fault.", "Are you okay?"],
  search: ["Where did I put it...", "It was right here.", "Come on, come on..."],
  found: ["Found it!", "Yes! There you are.", "Finally."],
  lost: ["Which way is the beach?", "I think we're lost.", "This doesn't look like the map."],
  witness: ["Oh my god!", "Somebody call the police!", "Are you seeing this?", "Hey! Stop!", "I'm calling 911!"],
  buy: ["One, please.", "Smells amazing.", "Keep the change."],
};

export const ARCHETYPES: Archetype[] = [
  {
    id: "cast:pedestrian", name: "Pedestrian", tier: "extra", species: "core:civilian", looks: ["cast:street_plain", "cast:street_bright"],
    names: "miami", lines: FOLK, reactions: "cast:folk",
    wants: ["a quiet life", "a better job", "to see family"], struggles: ["rent", "the dinosaurs", "a long commute"], hopes: ["a place by the water", "to start a business"],
  },
  {
    id: "cast:worker", name: "Worker", tier: "extra", species: "core:civilian", looks: ["cast:office", "cast:street_plain"],
    traits: { calm: [0.4, 0.9] }, names: "miami", lines: { ...FOLK, talk: ["On my lunch break, sorry.", "Late for a shift.", "Ask at the front desk."] }, reactions: "cast:folk",
    wants: ["a raise", "a weekend off"], struggles: ["a bad boss", "the bus never comes"], hopes: ["to retire early"],
  },
  {
    id: "cast:tourist", name: "Tourist", tier: "extra", species: "core:civilian", looks: ["cast:tourist"],
    traits: { calm: [0.1, 0.6], social: [0.5, 1] }, names: "visitors", lines: { ...FOLK, talk: ["Is this South Beach?", "Could you take our picture?", "Are the raptors always this close?"] }, reactions: "cast:folk",
    wants: ["a perfect photo", "the best stone crab"], struggles: ["sunburn", "getting lost"], hopes: ["to come back next year"],
  },
  {
    id: "cast:jogger", name: "Jogger", tier: "extra", species: "core:civilian", looks: ["cast:runner"],
    traits: { bold: [0.4, 0.9], playful: [0.3, 0.8] }, names: "miami", lines: { ...FOLK, talk: ["Can't stop, in the zone!", "Morning!", "Keep it up!"] }, reactions: "cast:folk",
    wants: ["a personal best"], struggles: ["the heat"], hopes: ["to run the marathon"],
  },
  {
    id: "cast:beachgoer", name: "Beachgoer", tier: "extra", species: "core:civilian", looks: ["cast:swimwear", "cast:street_bright"],
    traits: { calm: [0.5, 1], playful: [0.4, 1] }, names: "miami", lines: { ...FOLK, talk: ["Water's perfect today.", "Watch out for the jellyfish.", "Got any sunscreen?"] }, reactions: "cast:folk",
    wants: ["a tan", "a lazy day"], struggles: ["crowds", "sand everywhere"], hopes: ["to learn to surf"],
  },
  {
    id: "cast:vendor", name: "Street vendor", tier: "featured", species: "core:civilian", looks: ["cast:vendor_apron"],
    traits: { social: [0.6, 1], calm: [0.5, 1] }, names: "miami",
    lines: { ...FOLK, sell: ["Cafecito! Croquetas!", "Fresh coconut water!", "Next!", "Who's hungry?"], talk: ["You want something? Get in line.", "Best croquetas in Miami, ask anybody."] },
    reactions: "cast:vendor", wants: ["a second cart", "regulars"], struggles: ["permits", "the heat", "raptors scaring customers"], hopes: ["a little restaurant of my own"],
  },
  {
    id: "cast:cop", name: "Police officer", tier: "featured", species: "core:civilian", temper: "defends", looks: ["cast:police"],
    traits: { calm: [0.5, 0.9], bold: [0.6, 1] }, items: { "core:pistol": 1, "core:round_pistol": 12 }, names: "officers",
    lines: { ...FOLK, patrol: ["Keep it moving, folks.", "Everything all right here?", "Stay out of trouble."], talk: ["Move along.", "You see anything, you call it in.", "Stay off the causeway at night."], warn: ["Drop it! Now!", "Police! Don't move!"], clear: ["Everybody back!", "Clear the area!", "Nobody move!", "Police! Step away!"] },
    reactions: "cast:cop", wants: ["a quiet shift", "a promotion"], struggles: ["too few officers", "the gangs", "the dinosaurs"], hopes: ["to make detective"],
  },
  {
    id: "cast:gang_red", name: "Southside gang member", tier: "featured", species: "core:civilian", temper: "defends", looks: ["cast:gang_red"],
    traits: { bold: [0.6, 1], calm: [0, 0.5], social: [0.2, 0.6] }, items: { "core:pistol": 1, "core:round_pistol": 12 }, names: "street",
    lines: { ...FOLK, talk: ["Wrong block.", "You lost?", "Keep walking."], warn: ["This is our corner.", "You got a problem?", "Back up!"], taunt: ["That all you got?", "Run home!", "Southside!"], angry: ["You wanna die?", "Watch yourself!"] },
    reactions: "cast:gang", wants: ["respect", "the corner"], struggles: ["Bayfront", "the cops", "money"], hopes: ["to get out", "to run the block"],
  },
  {
    id: "cast:gang_teal", name: "Bayfront gang member", tier: "featured", species: "core:civilian", temper: "defends", looks: ["cast:gang_teal"],
    traits: { bold: [0.6, 1], calm: [0, 0.5], social: [0.2, 0.6] }, items: { "core:pistol": 1, "core:round_pistol": 12 }, names: "street",
    lines: { ...FOLK, talk: ["Not your street.", "Who sent you?", "Keep moving."], warn: ["Bayfront runs this.", "Step off!", "Last warning."], taunt: ["Missed me!", "Bayfront!", "Too slow!"], angry: ["You wanna die?", "Watch yourself!"] },
    reactions: "cast:gang", wants: ["respect", "the waterfront"], struggles: ["Southside", "the cops", "money"], hopes: ["to get out", "a boat of my own"],
  },
];

export const NAMES: Record<string, string[]> = {
  miami: ["Ana", "Luis", "Marisol", "Dante", "Keisha", "Raúl", "Yolanda", "Marcus", "Isabel", "Tomás", "Brianna", "Jorge", "Lena", "Andre", "Carmen", "Diego", "Tasha", "Hector", "Nadia", "Omar", "Rosa", "Kevin", "Gabriela", "Darnell", "Pilar", "Wes", "Celia", "Javier", "Monique", "Ernesto"],
  visitors: ["Greta", "Hank", "Priya", "Sven", "Mei", "Doug", "Ingrid", "Ravi", "Colleen", "Pierre", "Yuki", "Barb", "Lars", "Fiona"],
  officers: ["Officer Reyes", "Officer Banks", "Officer Duarte", "Officer Kim", "Officer Wallace", "Officer Ortiz", "Sergeant Pratt", "Officer Lowe"],
  street: ["Ghost", "Tiny", "Smoke", "Lefty", "Chino", "Dre", "Junebug", "Nene", "Bones", "Cuervo", "Lil Mo", "Spider"],
};

const MEN = ["Luis", "Dante", "Raúl", "Marcus", "Tomás", "Jorge", "Andre", "Diego", "Hector", "Omar", "Kevin", "Darnell", "Wes", "Javier", "Ernesto", "Hank", "Sven", "Doug", "Ravi", "Pierre", "Lars"];
const WOMEN = ["Ana", "Marisol", "Keisha", "Yolanda", "Isabel", "Brianna", "Lena", "Carmen", "Tasha", "Nadia", "Rosa", "Gabriela", "Pilar", "Celia", "Monique", "Greta", "Priya", "Mei", "Ingrid", "Colleen", "Yuki", "Barb", "Fiona"];
export const SEXES: Record<string, number> = Object.fromEntries([...MEN.map((n) => [n, 0]), ...WOMEN.map((n) => [n, 1])]);

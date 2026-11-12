/**
 * Graphics library taxonomy: the brief's 60 categories (+ a few that people search for constantly), grouped the way
 * design tools such as Canva group their elements panel. Category names and groupings are ours; Pinterest and Canva
 * were used only as a reference for how people browse, never as a source of artwork.
 *
 * `words` classify an asset by its name / keywords; `subgroups` are Unicode emoji subgroups (emojibase). `synonyms`
 * expand search terms (English, common Indian English / Hinglish words, and spelling variants).
 */

export const CATEGORY_GROUPS = [
  { id: "everyday", label: "Everyday" },
  { id: "food", label: "Food & drink" },
  { id: "transport", label: "Transport" },
  { id: "nature", label: "Animals & nature" },
  { id: "space", label: "Space" },
  { id: "body", label: "Body & people" },
  { id: "culture", label: "Culture & India" },
  { id: "signs", label: "Signs & maps" },
  { id: "hobbies", label: "Sport, games & music" },
  { id: "style", label: "Art & style" },
  { id: "world", label: "World & travel" },
  { id: "knowledge", label: "Knowledge & work" },
  { id: "celebrate", label: "Celebrations" },
  { id: "design", label: "Design elements" },
] as const;
export type CategoryGroupId = (typeof CATEGORY_GROUPS)[number]["id"];

export interface GraphicCategory {
  id: string;
  label: string;
  group: CategoryGroupId;
  /** Name / keyword tokens that put an asset in this category (singular, lower case). */
  words: string[];
  /** Unicode emoji subgroups (emojibase names). */
  subgroups?: string[];
  /** Shown with the category: cultural context, legal limits. */
  note?: string;
}

const c = (id: string, label: string, group: CategoryGroupId, words: string, subgroups?: string, note?: string): GraphicCategory => ({
  id, label, group, words: words.split(/\s+/).filter(Boolean), subgroups: subgroups?.split(/\s+/).filter(Boolean), note,
});

export const GRAPHIC_CATEGORIES: GraphicCategory[] = [
  // Everyday
  c("everyday-objects", "Everyday objects", "everyday", "cup mug key lamp umbrella bag backpack chair bed sofa couch clock watch glasses scissors pen pencil book phone camera bulb candle box gift basket bucket broom soap toothbrush towel wallet purse ring comb mirror door window ladle pot pan bowl kettle barrel urn jar vase jug bottle well tap bucket rope lantern torch candle hourglass envelope paperclip printer", "household other-object office lock tool phone light-video book-paper writing mail hotel"),
  c("home", "Home & household", "everyday", "home house sofa couch bed bath bathtub shower toilet kitchen fridge oven stove plant vase door window sink plunger broom", "household"),
  c("fashion", "Fashion & accessories", "everyday", "shirt tshirt dress jeans trousers shoe sneaker boot heel sandal hat cap crown glove scarf sock coat jacket kimono sari saree lungi bikini handbag purse ring lipstick necklace gem jewel bangle earring sunglasses tie hanger hoodie belt cloak robe gown apron boot bracers glove mitten", "clothing"),
  c("beauty", "Beauty & care", "everyday", "lipstick makeup nail polish perfume comb mirror hair salon spa lotion soap razor", ""),
  c("money", "Money & business", "everyday", "money coin cash dollar rupee euro yen pound bank card credit wallet chart briefcase receipt invoice shop store tag sale price", "money currency office"),
  c("tools", "Tools", "everyday", "hammer wrench screwdriver saw drill axe pickaxe shovel toolbox gear nut bolt magnet ladder", "tool"),
  // Food & drink
  c("food", "Food", "food", "food pizza burger hamburger sandwich taco burrito noodle ramen rice curry bread bagel croissant cheese egg meat bacon steak fries popcorn sushi dumpling samosa dosa idli biryani roti naan thali pav", "food-prepared food-asian food-sweet dishware"),
  c("fruits", "Fruits", "food", "fruit apple banana mango grape grapes orange tangerine lemon lime cherry cherries strawberry melon watermelon peach pear pineapple coconut kiwi blueberry blueberries olive avocado tomato", "food-fruit"),
  c("vegetables", "Vegetables", "food", "vegetable carrot corn broccoli potato onion garlic pepper chili chilli eggplant brinjal cucumber lettuce mushroom pea bean beans ginger peanut", "food-vegetable"),
  c("drinks", "Drinks", "food", "drink coffee tea chai juice milk beer wine cocktail soda bottle glass mate smoothie lassi boba bubble", "drink"),
  c("sweets", "Sweets & desserts", "food", "cake cupcake cookie donut doughnut candy chocolate lollipop cream icecream pie custard honey dessert sweet laddu jalebi", "food-sweet"),
  // Transport
  c("vehicles", "Vehicles", "transport", "vehicle car bus truck lorry van taxi train tram metro tractor ambulance police firetruck rickshaw autorickshaw scooter boat ship ferry tanker tank apc forklift steamroller bulldozer excavator crane caravan trailer wagon cart carriage", "transport-ground transport-water transport-air"),
  c("cars", "Cars", "transport", "car automobile racing race taxi suv sedan pickup jeep convertible", ""),
  c("motorcycles", "Motorcycles", "transport", "motorcycle motorbike bike scooter moped biker", ""),
  c("aircraft", "Aircraft", "transport", "airplane aeroplane plane aircraft jet helicopter airport airfield parachute glider drone balloon rocket", "transport-air"),
  c("bicycles", "Bicycles", "transport", "bicycle cycle cycling cyclist bmx tricycle", ""),
  c("boats", "Boats & ships", "transport", "boat ship sailboat yacht canoe kayak ferry anchor submarine", "transport-water"),
  // Animals & nature
  c("animals", "Animals", "nature", "animal dog cat lion tiger elephant horse cow monkey bear panda fox wolf deer rabbit mouse pig sheep goat camel giraffe zebra rhino hippo kangaroo koala sloth otter bat squirrel paw", "animal-mammal animal-amphibian animal-reptile animal-marine cat-face monkey-face"),
  c("pets", "Pets", "nature", "dog puppy cat kitten paw pet fish hamster rabbit parrot", ""),
  c("birds", "Birds", "nature", "bird eagle owl parrot peacock duck swan flamingo penguin chicken rooster hen dove crow pigeon feather nest egg hatching", "animal-bird"),
  c("insects", "Insects", "nature", "insect bug butterfly bee honeybee ant beetle ladybug ladybird spider web scorpion mosquito fly cricket cockroach caterpillar worm snail", "animal-bug"),
  c("ocean", "Ocean & sea life", "nature", "ocean sea fish whale dolphin shark octopus squid crab lobster shrimp shell coral wave beach surf seal", "animal-marine"),
  c("nature", "Nature", "nature", "nature mountain volcano river lake forest desert island beach wave leaf leaves rock stone fire water earth rainbow cloud sun rain snow wind", "plant-other sky-weather place-geographic"),
  c("flowers", "Flowers", "nature", "flower rose tulip lotus sunflower hibiscus blossom daisy lily jasmine bouquet petal marigold", "plant-flower"),
  c("trees", "Trees & plants", "nature", "tree palm pine evergreen deciduous cactus bonsai leaf leaves herb clover seedling plant bamboo", "plant-other"),
  c("weather", "Weather", "nature", "weather sun sunny cloud cloudy rain rainy storm thunder lightning snow snowflake wind tornado fog umbrella rainbow thermometer", "sky-weather"),
  // Space
  c("space", "Space", "space", "space rocket astronaut alien ufo satellite galaxy comet telescope orbit milky universe cosmos", ""),
  c("planets", "Planets", "space", "planet earth globe saturn mars jupiter moon ringed", ""),
  c("stars", "Stars", "space", "star stars sparkle sparkles shooting glowing twinkle", ""),
  c("moon-sun", "Sun & moon", "space", "sun moon crescent eclipse sunrise sunset", ""),
  // Body & people
  c("emojis", "Emojis & faces", "body", "face smile smiley grin laugh wink kiss emoji", "face-smiling face-affection face-tongue face-hand face-neutral-skeptical face-sleepy face-unwell face-hat face-glasses face-concerned face-negative face-costume emotion"),
  c("hearts", "Hearts & love", "body", "heart love kiss romance valentine couple cupid", "heart"),
  c("anatomy", "Human anatomy illustrations", "body", "anatomy anatomical organ brain lung lungs heart kidney liver stomach intestine skeleton spine dna", "body-parts"),
  c("body-parts", "Body-part graphics", "body", "body hand foot leg arm ear nose mouth tooth teeth tongue lip lips eye eyes biceps muscle bone skull brain finger thumb", "body-parts"),
  c("eyes", "Eyes", "body", "eye eyes eyeball eyesight vision iris", ""),
  c("hands", "Hands & gestures", "body", "hand hands fist thumb finger palm wave clap handshake pray namaste ok peace victory gesture pointing", "hand-fingers-open hand-fingers-partial hand-single-finger hand-fingers-closed hands hand-prop"),
  c("lips", "Lips & mouths", "body", "lip lips mouth kiss tongue smile", ""),
  c("skulls", "Skulls", "body", "skull skulls crossbones death", ""),
  c("bones", "Bones & skeletons", "body", "bone bones skeleton spine rib ribs femur", ""),
  c("muscles", "Muscles & fitness", "body", "muscle muscles biceps flexed strong strength gym fitness dumbbell weightlifting kettlebell", ""),
  c("people", "People", "body", "person people man woman boy girl baby child family", "person person-gesture person-role person-activity person-resting family"),
  c("occupations", "Occupations", "knowledge", "occupation job worker doctor nurse teacher farmer chef cook police firefighter pilot astronaut scientist mechanic judge artist singer technologist detective guard construction health", "person-role"),
  // Culture & India
  c("indian-symbols", "Traditional Indian symbols", "culture", "om diya lotus kalash rangoli kolam mehndi henna peacock elephant tabla sitar veena trishul bindi namaste temple mandir india indian", "", "Traditional and religious symbols are shown with their names and source. Use them respectfully; designs that mock or misuse a sacred symbol are not accepted for production."),
  c("religious", "Religious & spiritual symbols", "culture", "om khanda cross star crescent menorah dharma wheel yin yang peace temple mosque church synagogue shinto kaaba pray rosary", "religion place-religious", "Sacred symbols: use them respectfully; designs that mock or misuse them are not accepted for production."),
  c("paisley", "Paisley", "culture", "paisley mango buta boteh", ""),
  c("mandala", "Mandala", "culture", "mandala", ""),
  c("rangoli", "Rangoli & kolam", "culture", "rangoli kolam alpana", ""),
  c("textile-motifs", "Textile motifs", "culture", "textile motif block print ikat bandhani kalamkari ajrakh weave woven pattern", ""),
  c("cultural-ornaments", "Cultural ornaments", "culture", "ornament ornamental filigree scroll flourish medallion lantern kite", ""),
  c("fantasy", "Fantasy & mythology", "culture", "dragon unicorn phoenix griffin mermaid merpeople fairy genie elf wizard mage vampire zombie ghost troll goblin orc demon monster beast magic magician potion spell rune scroll castle dungeon treasure chest sword swords shield knight crown armor armour helmet axe dagger spear bow crossbow mace scepter archer warrior viking samurai ninja", "person-fantasy"),
  c("zodiac", "Zodiac & astrology", "culture", "zodiac aries taurus gemini cancer leo virgo libra scorpio sagittarius capricorn aquarius pisces ophiuchus horoscope", "zodiac"),
  // Signs & maps
  c("road-signs", "Road signs", "signs", "road sign signpost stop yield parking crossing pedestrian construction barrier detour toll milestone", "transport-sign"),
  c("traffic", "Traffic symbols", "signs", "traffic light signal stop parking crossing fuel petrol charging speed limit entry warning", "transport-sign warning"),
  c("arrows", "Direction arrows", "signs", "arrow arrows direction left right up down back forward next previous rotate refresh corner curve navigate compass", "arrow"),
  c("maps", "Maps & places", "signs", "map pin marker location place navigation compass route globe gps poi", "place-map"),
  c("warning", "Warning & safety", "signs", "warning danger caution hazard radioactive biohazard alert exclamation no prohibited forbidden", "warning"),
  // Sport, games & music
  c("sports", "Sports", "hobbies", "sport sports football soccer cricket bat ball basketball tennis badminton shuttlecock volleyball rugby baseball hockey golf boxing wrestling karate judo swim swimmer surfing skate skateboard ski snowboard running runner trophy medal kabaddi", "sport person-sport award-medal"),
  c("gaming", "Gaming", "hobbies", "game gaming controller joystick arcade dice chess pawn puzzle videogame console meeple card cards poker slot", "game"),
  c("music", "Music", "hobbies", "music musical note notes guitar piano keyboard drum drums violin trumpet saxophone microphone headphone headphones speaker radio vinyl record dj tabla sitar flute", "music musical-instrument sound"),
  c("arts-crafts", "Arts & crafts", "hobbies", "art artist palette paint brush canvas crayon thread yarn knot sewing needle scissors frame", "arts-crafts"),
  // Art & style
  c("graffiti", "Graffiti & street art", "style", "graffiti spray tag street drip urban", ""),
  c("streetwear", "Streetwear graphics", "style", "streetwear skull flame fire lightning bolt chain dice crown snake tiger dragon rose dagger wings eye money skate sneaker", ""),
  c("typography", "Typography & letters", "style", "letter alphabet number digit typography font character abc", "alphanum keycap"),
  c("abstract", "Abstract art", "style", "abstract shape blob swirl wave squiggle splash", ""),
  c("geometric", "Geometric patterns", "style", "geometric geometry circle square triangle diamond hexagon polygon shape grid dots stripes", "geometric"),
  c("retro", "Retro graphics", "style", "retro arcade pixel cassette vinyl jukebox boombox floppy tv television vhs disco", ""),
  c("vintage", "Vintage graphics", "style", "vintage antique old classic gramophone typewriter camera telephone quill", ""),
  c("symbols", "Symbols & icons", "style", "symbol icon sign check tick cross plus minus question exclamation infinity recycle peace", "av-symbol gender math punctuation other-symbol"),
  // World & travel
  c("flags", "Flags", "world", "flag flags banner pennant", "flag country-flag subdivision-flag", "The Indian national flag must not be printed on garments below the waist or on undergarments (Flag Code of India, 2002, and the Prevention of Insults to National Honour Act, 1971)."),
  c("countries", "Countries", "world", "country countries nation national", "country-flag"),
  c("cities", "Cities & landmarks", "world", "city cityscape skyline building skyscraper tower bridge landmark monument statue liberty tokyo castle palace stadium", "place-building place-other"),
  c("travel", "Travel", "world", "travel luggage suitcase passport ticket hotel camping tent beach island map compass airplane train world globe vacation holiday", "place-geographic place-other hotel"),
  c("architecture", "Architecture", "world", "architecture building house tower bridge temple mosque church castle column pillar arch dome skyscraper hut", "place-building place-religious"),
  // Knowledge & work
  c("technology", "Technology", "knowledge", "technology tech computer laptop desktop phone mobile smartphone robot chip circuit battery plug wifi cloud server keyboard mouse code ai drone satellite", "computer phone light-video"),
  c("science", "Science", "knowledge", "science lab laboratory atom molecule dna microscope telescope tube flask beaker magnet chemistry physics biology virus microbe", "science"),
  c("education", "Education", "knowledge", "education school book books notebook pencil pen graduation cap diploma backpack teacher student abacus ruler globe calculator", "book-paper writing"),
  c("health", "Health & medical", "knowledge", "health medical medicine doctor nurse hospital ambulance pill pills stethoscope bandage syringe vaccine thermometer tooth dental", "medical"),
  c("time", "Time & calendar", "knowledge", "time clock watch alarm hourglass calendar timer stopwatch", "time"),
  // Celebrations
  c("festivals", "Festival artwork", "celebrate", "festival diwali holi navratri eid christmas halloween easter pongal onam lohri baisakhi durga ganesh rakhi raksha lantern firework fireworks sparkler confetti balloon party celebration", "event"),
  c("seasonal", "Seasonal graphics", "celebrate", "season spring summer autumn fall winter monsoon snow snowman leaf leaves flower sun beach", ""),
  c("party", "Party & birthday", "celebrate", "party birthday cake balloon gift present confetti popper celebration wedding ring", "event"),
  c("awards", "Awards & trophies", "celebrate", "trophy medal award ribbon rosette crown winner champion", "award-medal"),
  // Design elements
  c("frames", "Decorative borders & frames", "design", "frame border corner divider ornament badge label banner ribbon emblem", ""),
  c("shapes", "Shapes", "design", "shape circle square triangle star heart diamond hexagon blob", "geometric"),
  c("lines", "Lines & doodles", "design", "line lines squiggle doodle scribble zigzag wave dash", ""),
  c("silhouettes", "Silhouettes", "design", "silhouette", ""),
  c("interface", "Interface & line icons", "design", "menu settings adjustment adjustments filter list layout file folder upload download share link search zoom user users message chat bell notification cursor pointer toggle checkbox", ""),
];

export const CATEGORY_BY_ID: Record<string, GraphicCategory> = Object.fromEntries(GRAPHIC_CATEGORIES.map((x) => [x.id, x]));

/** Search synonyms (bidirectional within a group). Kept short and literal; every word here is matched as a whole term. */
const SYNONYM_GROUPS: string[][] = [
  ["car", "automobile", "auto", "motorcar", "gaadi"],
  ["motorcycle", "motorbike", "bike", "biker"],
  ["bicycle", "cycle", "bike", "cycling"],
  ["airplane", "aeroplane", "plane", "aircraft", "flight", "jet"],
  ["truck", "lorry"],
  ["rickshaw", "autorickshaw", "tuktuk", "tuk-tuk"],
  ["dog", "puppy", "doggy", "pup", "kutta"],
  ["cat", "kitten", "kitty", "billi"],
  ["tiger", "sher", "bagh"],
  ["elephant", "haathi", "hathi"],
  ["peacock", "mor", "peafowl"],
  ["cow", "gaay", "cattle"],
  ["bird", "birdie", "chidiya"],
  ["flower", "phool", "blossom", "bloom"],
  ["lotus", "kamal"],
  ["mango", "aam"],
  ["tea", "chai"],
  ["coffee", "kaapi", "espresso", "latte"],
  ["sweet", "mithai", "dessert"],
  ["skull", "skeleton", "cranium"],
  ["heart", "love", "dil"],
  ["star", "tara", "sitara"],
  ["moon", "chand", "chandrama", "crescent"],
  ["sun", "suraj", "sunny"],
  ["space", "cosmos", "universe", "galaxy", "outer-space"],
  ["planet", "world", "globe", "earth"],
  ["smile", "smiley", "happy", "grin"],
  ["sad", "cry", "crying", "tears"],
  ["laugh", "lol", "laughing", "joy"],
  ["angry", "mad", "rage"],
  ["cool", "sunglasses", "shades", "swag"],
  ["music", "song", "tune", "gaana"],
  ["guitar", "rock"],
  ["football", "soccer"],
  ["cricket", "bat", "wicket"],
  ["gym", "fitness", "workout", "muscle", "exercise"],
  ["game", "gaming", "videogame", "gamer"],
  ["phone", "mobile", "smartphone", "cellphone"],
  ["computer", "laptop", "pc", "desktop"],
  ["money", "cash", "paisa", "rupee", "currency"],
  ["house", "home", "ghar"],
  ["temple", "mandir"],
  ["mosque", "masjid"],
  ["church", "chapel"],
  ["flag", "jhanda", "tiranga"],
  ["india", "indian", "bharat", "desi", "hindustan"],
  ["festival", "festive", "tyohar", "celebration"],
  ["diwali", "deepavali", "diya", "lamp"],
  ["holi", "colours", "colors", "gulal"],
  ["rangoli", "kolam", "alpana"],
  ["mehndi", "henna", "mehendi"],
  ["paisley", "buta", "mango-motif"],
  ["arrow", "direction", "pointer"],
  ["road", "street", "highway"],
  ["sign", "signage", "signboard"],
  ["fire", "flame", "aag", "blaze"],
  ["water", "paani", "aqua"],
  ["rain", "monsoon", "baarish"],
  ["snow", "winter", "snowflake"],
  ["tree", "ped", "plant"],
  ["eye", "aankh", "vision"],
  ["hand", "haath", "palm"],
  ["lips", "lip", "mouth", "kiss"],
  ["crown", "king", "queen", "royal", "raja", "rani"],
  ["ghost", "spooky", "bhoot"],
  ["dragon", "drake", "wyvern"],
  ["baby", "infant", "toddler", "bachcha"],
  ["doctor", "physician", "medic"],
  ["school", "education", "study"],
  ["birthday", "bday"],
  ["wedding", "shaadi", "marriage"],
  ["colour", "color"],
  ["grey", "gray"],
  ["jewellery", "jewelry", "jewel", "gem"],
  ["trousers", "pants"],
  ["sneaker", "trainer", "shoe"],
];

const SYN = new Map<string, Set<string>>();
for (const g of SYNONYM_GROUPS) for (const w of g) { const s = SYN.get(w) ?? new Set<string>(); for (const x of g) s.add(x); SYN.set(w, s); }

/** Very small English stemmer: plural and common suffixes, enough for search terms like "cars", "flowers", "boxes". */
export function stem(w: string): string {
  if (w.length <= 3) return w;
  if (/ies$/.test(w)) return w.slice(0, -3) + "y";
  if (/(ses|xes|zes|ches|shes)$/.test(w)) return w.slice(0, -2);
  if (/[^s]s$/.test(w)) return w.slice(0, -1);
  return w;
}

/** Each search term → the set of words it may match (itself, its stem and synonyms). */
export function expandTerm(term: string): string[] {
  const t = term.toLowerCase().trim();
  const out = new Set<string>([t, stem(t)]);
  for (const k of [t, stem(t)]) for (const s of SYN.get(k) ?? []) out.add(s);
  return [...out].filter((x) => x.length > 0).slice(0, 12);
}

/** Words that occur in asset names and keywords: tokenised, stemmed, de-duplicated. */
export function tokens(...parts: (string | string[] | undefined | null)[]): string[] {
  const out = new Set<string>();
  for (const p of parts) for (const s of Array.isArray(p) ? p : [p ?? ""]) for (const w of s.toLowerCase().split(/[^a-z0-9]+/)) if (w) { out.add(w); out.add(stem(w)); }
  return [...out];
}

/** Categories for an asset, from its name / keyword tokens and (for emoji) its Unicode subgroup. */
export function classify(words: string[], subgroup?: string | null): string[] {
  const set = new Set(words);
  const out: string[] = [];
  for (const cat of GRAPHIC_CATEGORIES) {
    if (subgroup && cat.subgroups?.includes(subgroup)) { out.push(cat.id); continue; }
    if (cat.words.some((w) => set.has(w))) out.push(cat.id);
  }
  return out;
}

/** Category suggestions for a query (for "did you mean" and the search dropdown). */
export function suggestCategories(q: string, limit = 6): GraphicCategory[] {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const scored = GRAPHIC_CATEGORIES.map((cat) => {
    let s = 0;
    for (const t of terms) {
      const ex = expandTerm(t);
      if (cat.label.toLowerCase().includes(t)) s += 3;
      if (ex.some((e) => cat.words.includes(e))) s += 2;
      else if (t.length >= 4 && cat.words.some((w) => w.startsWith(t))) s += 1;
    }
    return { cat, s };
  }).filter((x) => x.s > 0);
  return scored.sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.cat);
}

/** The `search_text` column: name, keywords and category labels as whole words, with leading / trailing spaces. */
export function searchTextFor(name: string, tags: string[], categories: string[], extra: string[] = []): string {
  const labels = categories.flatMap((id) => (CATEGORY_BY_ID[id] ? [CATEGORY_BY_ID[id].label, id] : [id]));
  return ` ${tokens(name, tags, labels, extra).join(" ")} `;
}

/** Search terms: letters and digits only (this also keeps SQL LIKE / regex patterns literal). At most five. */
export function searchTerms(input: string): string[] {
  return input.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/).filter((t) => t.length > 0).slice(0, 5);
}

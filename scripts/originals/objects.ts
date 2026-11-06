import { D, ellipsePath, n1, pol, sparkle, starPts, waveBand } from "./draw";

export interface Obj { id: string; name: string; tags: string[]; colls: string[]; draw: (d: D) => void }
const leaf = (d: D, tf: string, role: "p" | "s" | "a" = "p") => d.path("M0 0Q14-34 52-40Q46-6 0 0Z", role, { tf });

export const OBJECTS: Obj[] = [
  { id: "diya", name: "Diya Lamp", tags: ["diwali", "festival", "lamp", "light", "indian", "festive"], colls: ["Desi_Festive"], draw: (d) => {
    d.path("M30 118Q100 200 170 118Z", "p", { outline: true }); d.ellipse(100, 118, 70, 10, "s", { outline: true });
    d.path("M100 30Q134 76 100 112Q66 76 100 30Z", "a"); d.path("M100 62Q112 82 100 100Q88 82 100 62Z", "l"); d.det("M72 150Q100 166 128 150", 4, "l", 0.7);
  } },
  { id: "kite", name: "Patang Kite", tags: ["kite", "makar sankranti", "festival", "sky", "indian", "festive"], colls: ["Desi_Festive"], draw: (d) => {
    d.poly([[100, 12], [152, 68], [100, 140], [48, 68]], "p", { outline: true }); d.poly([[100, 12], [152, 68], [100, 68]], "s"); d.poly([[100, 140], [48, 68], [100, 68]], "s");
    d.det("M100 12V140M48 68H152", 4); d.det("M100 140Q74 156 100 168Q126 180 100 192", 4); d.poly([[86, 158], [100, 164], [86, 172]], "a"); d.poly([[114, 176], [100, 182], [114, 190]], "a");
  } },
  { id: "chai", name: "Kulhad Chai", tags: ["chai", "tea", "kulhad", "drink", "indian", "cafe", "steam"], colls: ["Desi_Festive", "Foodie_Favourites"], draw: (d) => {
    d.ellipse(100, 182, 58, 8, "s"); d.path("M58 70H142L128 164Q126 176 114 176H86Q74 176 72 164Z", "p", { outline: true }); d.path("M62 86H138L133 124H67Z", "a"); d.ellipse(100, 86, 38, 6, "l");
    d.det("M80 54Q70 40 82 28M100 52Q90 36 102 20M120 54Q110 40 122 28", 5, "d");
  } },
  { id: "mango", name: "Mango", tags: ["mango", "fruit", "summer", "tropical", "indian", "food"], colls: ["Desi_Festive", "Foodie_Favourites"], draw: (d) => {
    d.path("M100 40C152 32 174 94 152 140C134 178 70 180 50 140C28 94 50 40 100 40Z", "a", { outline: true }); d.path("M124 152Q154 130 156 98Q166 142 134 168Z", "s", { op: 0.8 });
    d.path("M100 40Q112 12 148 16Q142 46 100 40Z", "p", { outline: true }); d.det("M100 40Q96 26 100 14", 5); d.det("M66 72Q76 54 98 52", 5, "l", 0.8);
  } },
  { id: "chilli", name: "Red Chilli", tags: ["chilli", "spicy", "hot", "food", "indian", "pepper"], colls: ["Foodie_Favourites"], draw: (d) => {
    d.path("M58 52Q150 40 162 112Q168 152 150 184Q146 150 118 122Q88 90 58 52Z", "a", { outline: true }); d.path("M54 54Q36 44 42 24Q60 28 72 48Z", "p", { outline: true });
    d.det("M80 66Q130 70 144 112", 4, "l", 0.7);
  } },
  { id: "peacock", name: "Peacock Feather", tags: ["peacock", "feather", "mor pankh", "indian", "nature", "elegant"], colls: ["Desi_Festive", "Wellness_Mindful"], draw: (d) => {
    d.det("M100 196Q94 150 100 110", 6); for (let i = -4; i <= 4; i++) d.det(`M100 ${112 + Math.abs(i) * 4}L${100 + i * 17} ${40 + Math.abs(i) * 8}`, 3, "d", 0.5);
    d.ellipse(100, 82, 46, 68, "p"); d.ellipse(100, 82, 34, 52, "s"); d.ellipse(100, 84, 24, 38, "a"); d.ellipse(100, 86, 12, 22, "d"); d.ellipse(96, 80, 4, 8, "l", { op: 0.8 });
  } },
  { id: "cricket", name: "Bat & Ball", tags: ["cricket", "bat", "ball", "sport", "indian", "match"], colls: ["Cricket_Sports"], draw: (d) => {
    d.g("rotate(-32 100 100)", () => { d.rect(91, 6, 18, 62, "d", { rx: 7 }); d.rect(70, 64, 60, 124, "s", { rx: 10, outline: true }); d.det("M82 84V176M100 84V176M118 84V176", 3, "d", 0.35); });
    d.circle(150, 146, 28, "a", { outline: true }); d.det("M130 130Q150 146 130 164M170 130Q150 146 170 164", 4, "l");
  } },
  { id: "football", name: "Football", tags: ["football", "soccer", "ball", "sport", "goal", "match"], colls: ["Cricket_Sports"], draw: (d) => {
    d.circle(100, 100, 76, "l", { outline: true }); d.poly(pol(100, 100, 24, 5), "d");
    pol(100, 100, 24, 5).forEach(([x, y], i) => { const [ox, oy] = pol(100, 100, 58, 5)[i]; d.det(`M${n1(x)} ${n1(y)}L${n1(ox)} ${n1(oy)}`, 4); d.poly(pol(ox, oy, 15, 5, -90 + 36 + i * 72), "d"); });
  } },
  { id: "basketball", name: "Basketball", tags: ["basketball", "hoops", "ball", "sport", "court"], colls: ["Cricket_Sports"], draw: (d) => {
    d.circle(100, 100, 76, "a", { outline: true }); d.det("M24 100H176M100 24V176", 5); d.det("M48 40Q86 100 48 160M152 40Q114 100 152 160", 5);
  } },
  { id: "shuttle", name: "Shuttlecock", tags: ["badminton", "shuttle", "racquet", "sport", "feather"], colls: ["Cricket_Sports"], draw: (d) => {
    d.g("rotate(-25 100 100)", () => { d.poly([[84, 120], [116, 120], [148, 22], [52, 22]], "l", { outline: true }); d.det("M92 120L70 22M100 120V22M108 120L130 22", 3, "d", 0.5); d.path("M52 22Q100 -2 148 22", "p", { outline: true }); d.path("M72 126Q100 200 128 126Z", "a", { outline: true }); d.rect(80, 108, 40, 14, "p", { rx: 4, outline: true }); });
  } },
  { id: "dumbbell", name: "Dumbbell", tags: ["gym", "fitness", "weights", "workout", "strength", "sport"], colls: ["Cricket_Sports"], draw: (d) => {
    d.g("rotate(-22 100 100)", () => { d.rect(48, 92, 104, 16, "d", { rx: 6 }); d.rect(34, 58, 24, 84, "p", { rx: 8, outline: true }); d.rect(142, 58, 24, 84, "p", { rx: 8, outline: true }); d.rect(16, 74, 20, 52, "s", { rx: 7, outline: true }); d.rect(164, 74, 20, 52, "s", { rx: 7, outline: true }); });
  } },
  { id: "trophy", name: "Trophy", tags: ["trophy", "winner", "champion", "award", "cup", "victory"], colls: ["Cricket_Sports", "Campus_Team"], draw: (d) => {
    d.stk("M58 56Q22 52 30 84Q38 108 66 106", "a", 10); d.stk("M142 56Q178 52 170 84Q162 108 134 106", "a", 10);
    d.path("M56 24H144V84Q144 128 100 138Q56 128 56 84Z", "a", { outline: true }); d.rect(91, 136, 18, 28, "a", { outline: true }); d.rect(62, 162, 76, 20, "d", { rx: 5 });
    d.poly(starPts(100, 70, 22, 9, 5), "l"); d.det("M70 36Q66 70 74 100", 4, "l", 0.7);
  } },
  { id: "bicycle", name: "Bicycle", tags: ["bicycle", "cycling", "bike", "ride", "sport", "commute"], colls: ["Travel_Adventure", "Cricket_Sports"], draw: (d) => {
    d.stk(ellipsePath(46, 130, 36, 36), "d", 8); d.stk(ellipsePath(154, 130, 36, 36), "d", 8);
    d.stk("M46 130L88 70H132L154 130M88 70L106 130H46M132 70L120 52M110 52H130M88 70L82 54M74 54H92", "p", 9);
    d.circle(106, 130, 8, "a"); d.circle(46, 130, 5, "a"); d.circle(154, 130, 5, "a");
  } },
  { id: "headphones", name: "Headphones", tags: ["music", "headphones", "audio", "listen", "beats", "dj"], colls: ["Music_Nightlife"], draw: (d) => {
    d.stk("M38 124V100A62 62 0 0 1 162 100V124", "d", 14); d.rect(24, 104, 40, 66, "p", { rx: 16, outline: true }); d.rect(136, 104, 40, 66, "p", { rx: 16, outline: true });
    d.rect(30, 114, 18, 46, "s", { rx: 9 }); d.rect(152, 114, 18, 46, "s", { rx: 9 }); d.circle(100, 36, 7, "a");
  } },
  { id: "guitar", name: "Guitar", tags: ["guitar", "music", "band", "rock", "acoustic", "strings"], colls: ["Music_Nightlife"], draw: (d) => {
    d.g("rotate(35 100 100)", () => { d.rect(92, 22, 16, 82, "d", { rx: 4 }); d.rect(86, 0, 28, 28, "a", { rx: 7, outline: true });
      d.ellipse(100, 150, 50, 44, "p", { outline: true }); d.ellipse(100, 108, 36, 32, "p", { outline: true }); d.circle(100, 138, 16, "d"); d.circle(100, 138, 21, "s", { op: 0.0 }); d.rect(78, 168, 44, 8, "d", { rx: 3 });
      d.det("M96 24V138M104 24V138", 2, "l", 0.8); });
  } },
  { id: "vinyl", name: "Vinyl Record", tags: ["vinyl", "record", "music", "retro", "dj", "turntable"], colls: ["Music_Nightlife", "Retro_Arcade"], draw: (d) => {
    d.circle(100, 100, 84, "d"); for (const r of [72, 62, 52]) d.stk(`M${100 - r} 100a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`, "l", 2.5, { op: 0.25 });
    d.circle(100, 100, 30, "a"); d.circle(100, 100, 6, "l"); d.path("M40 70A70 70 0 0 1 82 36", "l", { op: 0 }); d.stk("M44 66A68 68 0 0 1 80 38", "l", 5, { op: 0.4 });
  } },
  { id: "mic", name: "Microphone", tags: ["mic", "microphone", "karaoke", "singer", "podcast", "stage"], colls: ["Music_Nightlife"], draw: (d) => {
    d.rect(70, 14, 60, 96, "p", { rx: 30, outline: true }); for (let y = 36; y <= 92; y += 14) d.det(`M76 ${y}H124`, 3, "d", 0.45);
    d.stk("M52 92Q52 140 100 140Q148 140 148 92", "d", 9); d.rect(95, 140, 10, 32, "d"); d.rect(64, 170, 72, 12, "a", { rx: 6 });
  } },
  { id: "notes", name: "Music Notes", tags: ["music", "notes", "melody", "song", "beat", "sound"], colls: ["Music_Nightlife"], draw: (d) => {
    d.ellipse(60, 150, 24, 17, "p", { rot: -20, outline: true }); d.ellipse(140, 134, 24, 17, "p", { rot: -20, outline: true });
    d.rect(76, 50, 9, 98, "p"); d.rect(156, 34, 9, 98, "p"); d.poly([[76, 48], [165, 28], [165, 58], [76, 78]], "a", { outline: true });
  } },
  { id: "gamepad", name: "Game Controller", tags: ["gaming", "controller", "gamepad", "console", "play", "esports"], colls: ["Gaming_Tech", "Retro_Arcade"], draw: (d) => {
    d.path("M50 62H150Q186 62 190 108Q194 152 172 160Q150 166 138 138H62Q50 166 28 160Q6 152 10 108Q14 62 50 62Z", "p", { outline: true });
    d.rect(50, 90, 12, 32, "d", { rx: 2 }); d.rect(40, 100, 32, 12, "d", { rx: 2 }); d.circle(146, 88, 9, "a"); d.circle(166, 106, 9, "s"); d.circle(146, 124, 9, "l"); d.circle(126, 106, 9, "d");
    d.circle(84, 124, 9, "d"); d.circle(116, 124, 9, "d", { op: 0 }); d.rect(88, 80, 24, 8, "s", { rx: 4 });
  } },
  { id: "pixelheart", name: "Pixel Heart", tags: ["pixel", "heart", "8-bit", "retro", "game", "love"], colls: ["Gaming_Tech", "Retro_Arcade"], draw: (d) => {
    const m = ["011000110", "111101111", "111111111", "111111111", "011111110", "001111100", "000111000", "000010000"];
    m.forEach((row, y) => [...row].forEach((c, x) => { if (c === "1") d.rect(28 + x * 16, 40 + y * 16, 16.5, 16.5, y === 1 && x < 4 && x > 0 && !(x === 4) ? "l" : "p"); }));
    d.rect(44, 56, 16.5, 16.5, "l"); d.rect(60, 56, 16.5, 16.5, "s", { op: 0 }); d.rect(140, 120, 16.5, 16.5, "a", { op: 0.9 });
  } },
  { id: "robot", name: "Friendly Robot", tags: ["robot", "ai", "tech", "future", "cute", "kids", "bot"], colls: ["Kids_Playroom", "Gaming_Tech"], draw: (d) => {
    d.det("M100 52V28", 6); d.circle(100, 22, 9, "a"); d.rect(26, 84, 16, 40, "s", { rx: 6, outline: true }); d.rect(158, 84, 16, 40, "s", { rx: 6, outline: true });
    d.rect(40, 50, 120, 96, "p", { rx: 22, outline: true }); d.rect(56, 70, 88, 44, "d", { rx: 14 }); d.circle(82, 92, 10, "a"); d.circle(118, 92, 10, "a");
    d.rect(76, 124, 48, 10, "l", { rx: 5 }); d.rect(70, 148, 60, 30, "s", { rx: 10, outline: true });
  } },
  { id: "chip", name: "Circuit Chip", tags: ["chip", "processor", "tech", "circuit", "hardware", "geek"], colls: ["Gaming_Tech"], draw: (d) => {
    for (const p of [62, 82, 106, 126]) { d.rect(p, 22, 9, 30, "a", { rx: 3 }); d.rect(p, 148, 9, 30, "a", { rx: 3 }); d.rect(22, p, 30, 9, "a", { rx: 3 }); d.rect(148, p, 30, 9, "a", { rx: 3 }); }
    d.rect(48, 48, 104, 104, "d", { rx: 14 }); d.rect(68, 68, 64, 64, "p", { rx: 8 }); d.circle(100, 100, 12, "l"); d.det("M68 84H52M132 116H148", 4, "s");
  } },
  { id: "pizza", name: "Pizza Slice", tags: ["pizza", "food", "cheese", "italian", "slice", "foodie"], colls: ["Foodie_Favourites"], draw: (d) => {
    d.path("M22 56Q100 10 178 56L168 80Q100 42 32 80Z", "p", { outline: true }); d.path("M32 80Q100 42 168 80L100 184Z", "s", { outline: true });
    d.circle(86, 94, 14, "a", { outline: true }); d.circle(122, 112, 12, "a", { outline: true }); d.circle(98, 144, 10, "a", { outline: true }); d.circle(126, 82, 5, "d"); d.circle(74, 120, 5, "d");
  } },
  { id: "burger", name: "Burger", tags: ["burger", "fast food", "foodie", "lunch", "snack", "food"], colls: ["Foodie_Favourites"], draw: (d) => {
    d.path("M28 92Q28 34 100 34Q172 34 172 92Z", "p", { outline: true }); for (const [x, y, r] of [[70, 58, -30], [100, 48, 10], [130, 60, 35], [88, 76, 60], [116, 78, -20]] as const) d.ellipse(x, y, 6, 3, "l", { rot: r });
    d.path("M22 98q14-12 28 0t28 0t28 0t28 0t28 0V110H22Z", "s", { outline: true }); d.rect(26, 108, 148, 24, "d", { rx: 12 }); d.poly([[30, 130], [170, 130], [152, 154], [124, 134], [96, 156], [70, 134], [48, 154]], "a", { outline: true });
    d.rect(30, 142, 140, 32, "p", { rx: 15, outline: true });
  } },
  { id: "coffee", name: "Coffee Cup", tags: ["coffee", "cafe", "espresso", "morning", "drink", "latte"], colls: ["Foodie_Favourites"], draw: (d) => {
    d.ellipse(92, 176, 72, 9, "s"); d.stk("M138 92H152Q174 92 174 114Q174 136 150 136H136", "p", 12); d.path("M44 74H138V128Q138 170 92 170Q44 170 44 128Z", "p", { outline: true }); d.rect(44, 100, 94, 30, "a");
    d.det("M72 58Q62 44 74 30M96 56Q86 40 98 24M120 58Q110 44 122 30", 5);
  } },
  { id: "icecream", name: "Ice Cream", tags: ["ice cream", "dessert", "summer", "sweet", "cone", "kids", "foodie"], colls: ["Kids_Playroom", "Foodie_Favourites"], draw: (d) => {
    d.poly([[62, 104], [138, 104], [100, 192]], "p", { outline: true }); d.det("M76 118L112 168M96 112L128 150M124 112L92 168M104 112L70 150", 3, "d", 0.45);
    d.path("M58 96H142Q152 110 142 118Q132 104 122 116Q112 128 100 114Q88 126 78 116Q68 106 58 118Z", "a", { outline: true });
    d.circle(100, 82, 40, "a", { outline: true }); d.circle(100, 46, 30, "s", { outline: true }); d.circle(100, 14, 8, "p", { outline: true });
  } },
  { id: "donut", name: "Donut", tags: ["donut", "doughnut", "sweet", "dessert", "snack", "foodie", "kids"], colls: ["Foodie_Favourites", "Kids_Playroom"], draw: (d) => {
    d.path(`${ellipsePath(100, 100, 76, 76)}${ellipsePath(100, 100, 24, 24)}`, "p", { rule: true, outline: true });
    d.path("M34 96Q36 44 100 40Q164 44 166 100Q168 150 134 158Q124 150 120 160Q100 170 80 160Q70 150 62 158Q32 150 34 96ZM76 100a24 24 0 1 0 48 0a24 24 0 1 0 -48 0Z", "a", { rule: true });
    for (const [x, y, r, c] of [[60, 80, 20, "l"], [86, 56, -40, "s"], [128, 62, 60, "l"], [146, 98, 10, "s"], [140, 130, -30, "l"], [66, 128, 40, "s"], [100, 148, 80, "l"]] as const) d.rect(x - 8, y - 2.5, 16, 5, c, { rx: 2.5, rot: r });
  } },
  { id: "compass", name: "Compass", tags: ["compass", "navigate", "explore", "adventure", "travel", "direction"], colls: ["Travel_Adventure"], draw: (d) => {
    d.circle(100, 100, 82, "d"); d.circle(100, 100, 68, "l"); for (let i = 0; i < 12; i++) { const [x1, y1] = pol(100, 100, 68, 12)[i]; const [x2, y2] = pol(100, 100, i % 3 ? 60 : 54, 12)[i]; d.det(`M${n1(x1)} ${n1(y1)}L${n1(x2)} ${n1(y2)}`, 3); }
    d.poly([[100, 34], [116, 100], [84, 100]], "a", { outline: true }); d.poly([[100, 166], [116, 100], [84, 100]], "p", { outline: true }); d.circle(100, 100, 7, "d");
  } },
  { id: "mountain", name: "Mountains", tags: ["mountain", "hike", "trek", "adventure", "peak", "outdoors", "himalaya"], colls: ["Travel_Adventure"], draw: (d) => {
    d.circle(150, 40, 16, "a"); d.poly([[8, 170], [96, 30], [192, 170]], "p", { outline: true }); d.poly([[96, 30], [124, 76], [108, 70], [96, 86], [82, 70], [68, 76]], "l"); d.poly([[112, 170], [160, 86], [200, 170]], "s", { outline: true }); d.poly([[160, 86], [172, 106], [160, 100], [148, 108]], "l");
  } },
  { id: "globe", name: "Globe", tags: ["globe", "world", "earth", "travel", "map", "global"], colls: ["Travel_Adventure", "Eco_Earth"], draw: (d) => {
    d.circle(100, 100, 76, "p", { outline: true }); d.path("M56 66Q78 46 100 62Q92 90 70 98Q48 92 56 66Z", "a"); d.path("M112 106Q144 94 156 118Q150 150 124 152Q106 132 112 106Z", "a");
    d.det(ellipsePath(100, 100, 34, 76), 3.5, "l", 0.7); d.det("M24 100H176M34 64H166M34 136H166", 3.5, "l", 0.7);
  } },
  { id: "tent", name: "Camping Tent", tags: ["tent", "camping", "outdoors", "adventure", "campfire", "travel"], colls: ["Travel_Adventure"], draw: (d) => {
    d.rect(8, 168, 184, 10, "s", { rx: 5 }); d.poly([[100, 36], [180, 170], [20, 170]], "p", { outline: true }); d.poly([[100, 100], [136, 170], [64, 170]], "d"); d.det("M100 36V14", 5); d.poly([[100, 14], [128, 22], [100, 30]], "a");
    d.det("M100 36L136 170", 3, "l", 0.6);
  } },
  { id: "camera", name: "Camera", tags: ["camera", "photo", "photography", "travel", "memories", "lens"], colls: ["Travel_Adventure"], draw: (d) => {
    d.rect(60, 38, 54, 28, "d", { rx: 6 }); d.rect(20, 56, 160, 112, "d", { rx: 18 }); d.rect(20, 86, 160, 12, "s"); d.circle(100, 124, 40, "l"); d.circle(100, 124, 30, "p"); d.circle(100, 124, 14, "d"); d.circle(90, 114, 6, "l"); d.rect(142, 66, 24, 12, "a", { rx: 4 });
  } },
  { id: "anchor", name: "Anchor", tags: ["anchor", "sea", "sailor", "nautical", "marine", "ship"], colls: ["Travel_Adventure", "Sunset_Surf"], draw: (d) => {
    d.stk(ellipsePath(100, 38, 14, 14), "p", 10); d.stk("M100 54V170M62 84H138M34 118Q42 172 100 172Q158 172 166 118", "p", 12); d.poly([[16, 128], [50, 130], [34, 104]], "p"); d.poly([[184, 128], [150, 130], [166, 104]], "p"); d.circle(100, 38, 5, "a");
  } },
  { id: "palm", name: "Palm Tree", tags: ["palm", "tropical", "beach", "island", "summer", "goa", "vacation"], colls: ["Sunset_Surf", "Travel_Adventure"], draw: (d) => {
    d.ellipse(100, 184, 56, 8, "s"); d.stk("M96 184Q90 130 104 82", "d", 13);
    for (const a of [-20, 35, 95, 150, 205, 262]) d.g(`rotate(${a} 104 80)`, () => d.path("M104 80Q130 36 176 52Q140 62 104 80Z", a % 2 ? "p" : "s", { outline: true }));
    d.circle(98, 88, 8, "a"); d.circle(112, 92, 8, "a");
  } },
  { id: "plane", name: "Paper Plane", tags: ["plane", "paper plane", "travel", "flight", "send", "fly", "adventure"], colls: ["Travel_Adventure"], draw: (d) => {
    d.poly([[14, 100], [186, 24], [94, 116]], "p", { outline: true }); d.poly([[94, 116], [186, 24], [112, 176]], "s", { outline: true }); d.poly([[94, 116], [112, 176], [106, 132]], "a"); d.det("M30 160Q50 140 70 150T110 170", 4, "d", 0.0);
  } },
  { id: "lotus", name: "Lotus", tags: ["lotus", "padma", "yoga", "calm", "flower", "wellness", "meditation", "indian"], colls: ["Wellness_Mindful", "Desi_Festive"], draw: (d) => {
    const pet = (rot: number, role: "p" | "s" | "a") => d.g(`rotate(${rot} 100 168)`, () => d.path("M100 168Q66 116 100 40Q134 116 100 168Z", role, { outline: true }));
    pet(-66, "a"); pet(66, "a"); pet(-34, "s"); pet(34, "s"); pet(0, "p"); d.stk("M28 176Q64 160 100 176T172 176", "d", 6);
  } },
  { id: "leaf", name: "Single Leaf", tags: ["leaf", "nature", "green", "eco", "plant", "organic"], colls: ["Botanical_Studio", "Eco_Earth", "Wellness_Mindful"], draw: (d) => {
    d.path("M38 164Q22 56 162 34Q176 148 38 164Z", "p", { outline: true }); d.stk("M42 160Q100 100 154 42", "l", 6); for (const [x, y] of [[62, 130], [86, 110], [110, 88], [132, 66]]) { d.det(`M${x} ${y}l-6 -26`, 3.5, "l", 0.8); d.det(`M${x} ${y}l22 6`, 3.5, "l", 0.8); }
  } },
  { id: "moon", name: "Crescent Moon", tags: ["moon", "night", "crescent", "sleep", "celestial", "stars", "eid"], colls: ["Celestial_Skies", "Wellness_Mindful"], draw: (d) => {
    d.path("M128 20A82 82 0 1 0 180 132A66 66 0 1 1 128 20Z", "p", { outline: true }); d.poly(sparkle(150, 56, 14), "a"); d.poly(sparkle(176, 98, 8), "s"); d.poly(sparkle(60, 40, 9), "s");
  } },
  { id: "sun", name: "Sun", tags: ["sun", "summer", "sunshine", "day", "bright", "celestial", "happy"], colls: ["Celestial_Skies", "Sunset_Surf", "Kids_Playroom"], draw: (d) => {
    for (let i = 0; i < 12; i++) d.g(`rotate(${i * 30} 100 100)`, () => d.poly([[100, 12], [112, 44], [88, 44]], i % 2 ? "s" : "p", { outline: true })); d.circle(100, 100, 44, "a", { outline: true }); d.stk("M80 108Q100 128 120 108", "d", 5); d.circle(86, 92, 4, "d"); d.circle(114, 92, 4, "d");
  } },
  { id: "heart", name: "Heart", tags: ["heart", "love", "valentine", "romance", "like", "kind"], colls: ["Love_Celebrate", "Wellness_Mindful"], draw: (d) => {
    d.path("M100 178C20 124 12 62 56 46C80 38 96 54 100 68C104 54 120 38 144 46C188 62 180 124 100 178Z", "p", { outline: true }); d.path("M48 74Q52 58 70 56", "l", { op: 0 }); d.stk("M44 78Q48 60 68 58", "l", 7, { op: 0.8 });
  } },
  { id: "waves", name: "Ocean Waves", tags: ["wave", "ocean", "sea", "surf", "water", "beach", "summer"], colls: ["Sunset_Surf"], draw: (d) => {
    d.clipCircle(100, 100, 82, () => { d.rect(0, 0, 200, 200, "l"); d.circle(140, 62, 22, "a"); d.path(waveBand(104, 10, 80, 0), "s"); d.path(waveBand(128, 12, 100, 1.4), "p"); d.path(waveBand(152, 10, 70, 3), "d"); }); d.stk(ellipsePath(100, 100, 82, 82), "d", 6);
  } },
  { id: "feather", name: "Feather", tags: ["feather", "light", "free", "bird", "boho", "soft"], colls: ["Wellness_Mindful"], draw: (d) => {
    d.path("M52 180Q10 100 120 22Q170 14 180 28Q172 104 108 150Q76 170 52 180Z", "p", { outline: true }); d.stk("M52 180Q96 104 174 32", "l", 6); for (let i = 0; i < 6; i++) { const t = 0.2 + i * 0.13; const x = 52 + 122 * t, y = 180 - 148 * t; d.det(`M${n1(x)} ${n1(y)}l-22 -8`, 3, "l", 0.7); d.det(`M${n1(x)} ${n1(y)}l8 26`, 3, "l", 0.7); }
  } },
  { id: "cactus", name: "Cactus", tags: ["cactus", "desert", "succulent", "plant", "boho", "southwest"], colls: ["Botanical_Studio"], draw: (d) => {
    d.stk("M78 118H58Q44 118 44 104V84", "p", 24); d.stk("M122 104H142Q156 104 156 90V68", "p", 24); d.rect(76, 40, 48, 134, "p", { rx: 24, outline: true }); for (let y = 62; y < 166; y += 18) d.det(`M100 ${y}v8`, 3, "l", 0.8); d.circle(100, 36, 9, "a");
    d.path("M64 160H136L128 194H72Z", "a", { outline: true });
  } },
  { id: "sunflower", name: "Sunflower", tags: ["sunflower", "flower", "bloom", "summer", "yellow", "garden", "botanical"], colls: ["Botanical_Studio"], draw: (d) => {
    for (let i = 0; i < 16; i++) d.ellipse(100, 36, 13, 30, i % 2 ? "a" : "s", { rot: i * 22.5, outline: true }); for (let i = 0; i < 16; i++) { const t = i * 22.5; d.g(`rotate(${t} 100 100)`, () => d.ellipse(100, 36, 13, 30, i % 2 ? "a" : "s", { outline: true })); } d.circle(100, 100, 34, "d"); for (let i = 0; i < 12; i++) { const [x, y] = pol(100, 100, 18 + (i % 2) * 8, 12, i * 30)[i % 12]; d.circle(x, y, 3, "p"); }
  } },
  { id: "rose", name: "Rose", tags: ["rose", "flower", "romance", "love", "bloom", "garden"], colls: ["Botanical_Studio", "Love_Celebrate"], draw: (d) => {
    leaf(d, "translate(98 158) scale(1.1) rotate(-160)", "s"); leaf(d, "translate(102 158) scale(1.1) rotate(-20) scale(-1 1)", "s"); d.stk("M100 130V190", "s", 8);
    d.circle(100, 90, 62, "p", { outline: true }); d.circle(100, 90, 44, "a", { op: 0.55 }); d.stk("M100 90m-6 0a6 6 0 1 1 12 0a14 14 0 1 1 -28 0a24 24 0 1 1 48 0a36 36 0 1 1 -72 0", "d", 5, { op: 0.85 });
  } },
  { id: "tulip", name: "Tulip", tags: ["tulip", "flower", "spring", "garden", "bloom", "floral"], colls: ["Botanical_Studio"], draw: (d) => {
    d.stk("M100 126V192", "s", 10); d.path("M100 186Q56 176 52 120Q94 128 100 186Z", "s", { outline: true }); d.path("M100 186Q144 176 148 120Q106 128 100 186Z", "s", { outline: true });
    d.path("M58 46Q56 128 100 134Q144 128 142 46L120 76L100 36L80 76Z", "p", { outline: true }); d.path("M100 36L120 76Q112 112 100 134Q88 112 80 76Z", "a");
  } },
  { id: "crown", name: "Crown", tags: ["crown", "king", "queen", "royal", "luxury", "streetwear", "gold"], colls: ["Streetwear_Icons"], draw: (d) => {
    d.path("M22 66L62 108L100 40L138 108L178 66L164 156H36Z", "a", { outline: true }); d.rect(36, 156, 128, 20, "d", { rx: 5 }); d.circle(100, 42, 9, "p", { outline: true }); d.circle(22, 64, 8, "p", { outline: true }); d.circle(178, 64, 8, "p", { outline: true });
    for (const x of [66, 100, 134]) d.circle(x, 166, 5, "l");
  } },
  { id: "flame", name: "Flame", tags: ["flame", "fire", "hot", "streetwear", "burn", "energy"], colls: ["Streetwear_Icons"], draw: (d) => {
    const f = "M100 14C132 56 172 86 162 138C154 176 120 190 100 190C70 190 38 170 38 136C38 104 64 92 72 54C90 74 94 48 100 14Z";
    d.path(f, "a", { outline: true }); d.g("translate(100 190) scale(.68) translate(-100 -190)", () => d.path(f, "s")); d.g("translate(100 190) scale(.4) translate(-100 -190)", () => d.path(f, "l"));
  } },
  { id: "bolt", name: "Lightning Bolt", tags: ["lightning", "bolt", "energy", "power", "electric", "streetwear"], colls: ["Streetwear_Icons", "Retro_Arcade"], draw: (d) => {
    d.poly([[118, 8], [38, 112], [92, 112], [74, 192], [164, 76], [108, 76]], "a", { outline: true }); d.poly([[118, 34], [64, 106], [100, 106], [90, 160], [140, 88], [102, 88]], "s", { op: 0.9 });
  } },
  { id: "gem", name: "Diamond", tags: ["diamond", "gem", "jewel", "luxury", "sparkle", "streetwear"], colls: ["Streetwear_Icons", "Love_Celebrate"], draw: (d) => {
    d.poly([[54, 58], [146, 58], [180, 98], [100, 182], [20, 98]], "p", { outline: true }); d.poly([[54, 58], [100, 98], [20, 98]], "s"); d.poly([[146, 58], [180, 98], [100, 98]], "s"); d.poly([[54, 58], [146, 58], [100, 98]], "l"); d.poly([[20, 98], [100, 98], [100, 182]], "a", { op: 0.85 });
  } },
  { id: "dice", name: "Dice", tags: ["dice", "game", "luck", "casino", "play", "streetwear"], colls: ["Streetwear_Icons", "Gaming_Tech"], draw: (d) => {
    d.rect(44, 44, 124, 124, "p", { rx: 24, outline: true }); d.rect(30, 30, 124, 124, "l", { rx: 24, outline: true }); for (const [x, y] of [[62, 62], [122, 62], [92, 92], [62, 122], [122, 122]]) d.circle(x, y, 10, "d");
  } },
  { id: "star", name: "Bold Star", tags: ["star", "favourite", "shine", "award", "bright", "campus"], colls: ["Streetwear_Icons", "Campus_Team", "Kids_Playroom"], draw: (d) => {
    d.poly(starPts(100, 104, 88, 40, 5), "a", { outline: true }); d.poly(starPts(100, 104, 52, 24, 5), "s");
  } },
  { id: "cake", name: "Celebration Cake", tags: ["cake", "birthday", "party", "celebrate", "sweet", "candles"], colls: ["Love_Celebrate"], draw: (d) => {
    d.ellipse(100, 182, 80, 10, "s"); d.rect(36, 106, 128, 70, "p", { rx: 10, outline: true }); d.path("M36 112q12 18 24 0t24 0t24 0t24 0t24 0t20 0V126H36Z", "l", { outline: true });
    for (const [x, r] of [[72, "a"], [100, "s"], [128, "a"]] as const) { d.rect(x - 5, 66, 10, 38, r, { rx: 3, outline: true }); d.ellipse(x, 56, 6, 10, "s"); }
    for (const x of [58, 86, 114, 142]) d.circle(x, 152, 5, "l");
  } },
  { id: "balloons", name: "Balloons", tags: ["balloon", "party", "celebrate", "birthday", "kids", "fun"], colls: ["Love_Celebrate", "Kids_Playroom"], draw: (d) => {
    d.det("M130 160Q110 180 100 196M72 142Q86 170 100 196", 3.5); d.ellipse(134, 100, 36, 48, "s", { outline: true }); d.poly([[128, 146], [140, 146], [134, 156]], "s"); d.ellipse(74, 82, 44, 58, "p", { outline: true }); d.poly([[66, 138], [82, 138], [74, 150]], "p");
    d.ellipse(62, 62, 8, 16, "l", { op: 0.55, rot: 20 }); d.ellipse(124, 80, 6, 12, "l", { op: 0.55, rot: 20 });
  } },
  { id: "gift", name: "Gift Box", tags: ["gift", "present", "surprise", "birthday", "celebrate", "wrap"], colls: ["Love_Celebrate"], draw: (d) => {
    d.rect(34, 90, 132, 88, "p", { rx: 6, outline: true }); d.rect(24, 66, 152, 32, "s", { rx: 6, outline: true }); d.rect(90, 66, 20, 112, "a"); d.ellipse(78, 50, 24, 15, "a", { rot: -25, outline: true }); d.ellipse(122, 50, 24, 15, "a", { rot: 25, outline: true }); d.circle(100, 60, 9, "d");
  } },
  { id: "laurel", name: "Laurel Wreath", tags: ["laurel", "wreath", "victory", "champion", "award", "campus", "classic"], colls: ["Campus_Team"], draw: (d) => {
    for (const side of [1, -1]) for (let i = 0; i < 9; i++) { const a = (110 + i * 17) * (Math.PI / 180); const x = 100 + side * 70 * Math.cos(a), y = 100 + 70 * Math.sin(a); d.ellipse(x, y, 9, 19, i % 2 ? "p" : "s", { rot: side * (a * 180 / Math.PI - 90 + 30), outline: true }); }
    d.poly(starPts(100, 100, 26, 11, 5), "a", { outline: true });
  } },
  { id: "pennant", name: "Pennant", tags: ["pennant", "flag", "team", "school", "spirit", "campus", "varsity"], colls: ["Campus_Team"], draw: (d) => {
    d.rect(18, 12, 9, 180, "d", { rx: 4 }); d.poly([[27, 36], [184, 100], [27, 164]], "p", { outline: true }); d.poly([[27, 66], [130, 100], [27, 134]], "s"); d.poly(starPts(60, 100, 14, 6, 5), "l");
  } },
  { id: "gradcap", name: "Graduation Cap", tags: ["graduation", "cap", "college", "degree", "school", "campus", "student"], colls: ["Campus_Team"], draw: (d) => {
    d.path("M52 96V134Q100 168 148 134V96L100 120Z", "p", { outline: true }); d.poly([[100, 30], [188, 72], [100, 114], [12, 72]], "d", { outline: true }); d.stk("M170 80V134", "a", 5); d.circle(170, 142, 9, "a"); d.circle(100, 72, 5, "a");
  } },
  { id: "book", name: "Open Book", tags: ["book", "read", "study", "school", "knowledge", "campus", "library"], colls: ["Campus_Team"], draw: (d) => {
    d.path("M100 66Q58 40 14 56V160Q58 146 100 168Z", "l", { outline: true }); d.path("M100 66Q142 40 186 56V160Q142 146 100 168Z", "l", { outline: true }); d.path("M100 168Q58 148 8 164V172Q58 156 100 178Q142 156 192 172V164Q142 148 100 168Z", "p", { outline: true });
    for (const y of [78, 96, 114]) { d.det(`M28 ${y - 6}Q60 ${y - 14} 86 ${y + 2}`, 3.5, "d", 0.6); d.det(`M172 ${y - 6}Q140 ${y - 14} 114 ${y + 2}`, 3.5, "d", 0.6); }
  } },
  { id: "tree", name: "Tree", tags: ["tree", "forest", "nature", "eco", "green", "earth", "plant"], colls: ["Eco_Earth", "Botanical_Studio"], draw: (d) => {
    d.ellipse(100, 186, 50, 7, "s", { op: 0.8 }); d.path("M90 186Q94 150 90 120H110Q106 150 110 186Z", "d"); d.circle(100, 66, 46, "p", { outline: true }); d.circle(66, 98, 34, "p", { outline: true }); d.circle(134, 98, 34, "p", { outline: true }); d.circle(100, 100, 30, "p"); d.circle(86, 60, 10, "s", { op: 0.7 }); d.circle(124, 90, 8, "s", { op: 0.7 });
  } },
  { id: "drop", name: "Water Drop", tags: ["water", "drop", "rain", "eco", "blue", "pure"], colls: ["Eco_Earth"], draw: (d) => {
    d.path("M100 14Q166 100 154 130Q144 184 100 184Q56 184 46 130Q34 100 100 14Z", "p", { outline: true }); d.stk("M66 130Q68 156 90 164", "l", 8, { op: 0.8 }); d.poly(sparkle(140, 78, 10), "l");
  } },
  { id: "planet", name: "Ringed Planet", tags: ["planet", "saturn", "space", "galaxy", "cosmic", "astronomy", "orbit"], colls: ["Celestial_Skies", "Kids_Playroom"], draw: (d) => {
    d.g("rotate(-22 100 100)", () => { d.stk("M12 100A88 24 0 0 1 188 100", "a", 12); d.circle(100, 100, 52, "p", { outline: true }); d.path("M56 82Q100 96 144 82", "s", { op: 0 }); d.stk("M56 78Q100 92 146 76", "s", 8, { op: 0.7 }); d.stk("M12 100A88 24 0 0 0 188 100", "a", 12); });
    d.poly(sparkle(40, 36, 10), "s"); d.poly(sparkle(166, 160, 8), "l");
  } },
  { id: "rocket", name: "Rocket", tags: ["rocket", "space", "launch", "kids", "adventure", "future"], colls: ["Kids_Playroom", "Celestial_Skies"], draw: (d) => {
    d.g("rotate(30 100 100)", () => { d.path("M100 150Q112 186 100 202Q88 186 100 150Z", "s"); d.path("M100 10Q152 44 142 122H58Q48 44 100 10Z", "l", { outline: true }); d.path("M100 10Q124 24 132 56H68Q76 24 100 10Z", "a"); d.circle(100, 78, 16, "p", { outline: true }); d.circle(100, 78, 8, "d"); d.poly([[58, 100], [30, 142], [58, 138]], "a", { outline: true }); d.poly([[142, 100], [170, 142], [142, 138]], "a", { outline: true }); d.rect(70, 120, 60, 12, "p"); });
  } },
  { id: "rainbow", name: "Rainbow", tags: ["rainbow", "kids", "happy", "colour", "sky", "cloud", "pride"], colls: ["Kids_Playroom"], draw: (d) => {
    d.stk("M22 150A78 78 0 0 1 178 150", "a", 16); d.stk("M40 150A60 60 0 0 1 160 150", "s", 16); d.stk("M58 150A42 42 0 0 1 142 150", "p", 16);
    d.circle(28, 152, 20, "l", { outline: true }); d.circle(52, 156, 17, "l", { outline: true }); d.circle(172, 152, 20, "l", { outline: true }); d.circle(148, 156, 17, "l", { outline: true });
  } },
  { id: "cloud", name: "Cloud", tags: ["cloud", "sky", "weather", "dream", "soft", "kids"], colls: ["Kids_Playroom"], draw: (d) => {
    d.path("M46 150Q16 150 20 118Q24 92 52 92Q56 56 94 52Q130 50 142 84Q184 82 184 118Q184 150 150 150Z", "l", { outline: true }); d.circle(78, 118, 5, "d"); d.circle(116, 118, 5, "d"); d.stk("M90 130Q97 138 104 130", "d", 4); d.circle(66, 132, 8, "s", { op: 0.6 }); d.circle(130, 132, 8, "s", { op: 0.6 });
  } },
  { id: "dino", name: "Cute Dino", tags: ["dinosaur", "dino", "kids", "jurassic", "cute", "stegosaurus"], colls: ["Kids_Playroom"], draw: (d) => {
    for (const [x, y] of [[52, 78], [72, 62], [96, 56], [120, 62], [140, 76]] as const) d.poly([[x - 12, y + 22], [x, y - 8], [x + 12, y + 22]], "a", { outline: true });
    d.poly([[30, 126], [6, 150], [44, 148]], "p", { outline: true }); d.ellipse(92, 118, 64, 40, "p", { outline: true }); d.ellipse(160, 96, 26, 20, "p", { outline: true }); d.rect(60, 140, 18, 38, "p", { rx: 8, outline: true }); d.rect(112, 140, 18, 38, "p", { rx: 8, outline: true });
    d.circle(168, 90, 4.5, "d"); d.stk("M154 106Q166 112 176 104", "d", 3.5); d.ellipse(92, 134, 38, 20, "s", { op: 0.6 });
  } },
  { id: "cat", name: "Cat Face", tags: ["cat", "kitten", "pet", "meow", "cute", "animal"], colls: ["Pets_Paws"], draw: (d) => {
    d.path("M38 62L54 14L92 44Q100 42 108 44L146 14L162 62Q176 96 162 132Q142 172 100 172Q58 172 38 132Q24 96 38 62Z", "p", { outline: true }); d.poly([[52, 28], [78, 48], [56, 58]], "s"); d.poly([[148, 28], [122, 48], [144, 58]], "s");
    d.ellipse(72, 98, 12, 14, "a"); d.ellipse(128, 98, 12, 14, "a"); d.ellipse(72, 98, 5, 11, "d"); d.ellipse(128, 98, 5, 11, "d"); d.poly([[91, 120], [109, 120], [100, 131]], "s", { outline: true }); d.det("M100 131Q92 144 82 138M100 131Q108 144 118 138", 4);
    d.det("M60 126L24 120M60 136L26 142M140 126L176 120M140 136L174 142", 3.5, "d", 0.8);
  } },
  { id: "dog", name: "Dog Face", tags: ["dog", "puppy", "pet", "woof", "cute", "animal", "paws"], colls: ["Pets_Paws"], draw: (d) => {
    d.path("M44 46Q12 56 20 124Q34 130 52 112Q56 70 62 56Z", "s", { outline: true }); d.path("M156 46Q188 56 180 124Q166 130 148 112Q144 70 138 56Z", "s", { outline: true });
    d.ellipse(100, 102, 54, 58, "p", { outline: true }); d.ellipse(100, 134, 32, 26, "l", { outline: true }); d.ellipse(100, 122, 13, 9, "d"); d.circle(76, 92, 8, "d"); d.circle(124, 92, 8, "d"); d.circle(73, 89, 2.5, "l"); d.circle(121, 89, 2.5, "l");
    d.path("M92 144Q100 168 108 144Z", "a", { outline: true }); d.ellipse(124, 86, 20, 18, "s", { op: 0.55 });
  } },
  { id: "paw", name: "Paw Print", tags: ["paw", "pet", "dog", "cat", "animal", "print", "love"], colls: ["Pets_Paws"], draw: (d) => {
    d.path("M58 150Q58 110 100 106Q142 110 142 150Q142 178 100 178Q58 178 58 150Z", "p", { outline: true }); d.ellipse(46, 96, 15, 21, "p", { rot: -20, outline: true }); d.ellipse(80, 62, 16, 23, "p", { outline: true }); d.ellipse(120, 62, 16, 23, "p", { outline: true }); d.ellipse(154, 96, 15, 21, "p", { rot: 20, outline: true });
  } },
  { id: "rabbit", name: "Bunny", tags: ["bunny", "rabbit", "easter", "cute", "pet", "kids", "animal"], colls: ["Pets_Paws", "Kids_Playroom"], draw: (d) => {
    d.ellipse(70, 52, 16, 50, "l", { rot: -10, outline: true }); d.ellipse(130, 52, 16, 50, "l", { rot: 10, outline: true }); d.ellipse(70, 54, 7, 34, "s", { rot: -10 }); d.ellipse(130, 54, 7, 34, "s", { rot: 10 });
    d.ellipse(100, 128, 52, 46, "l", { outline: true }); d.circle(80, 120, 6, "d"); d.circle(120, 120, 6, "d"); d.poly([[94, 136], [106, 136], [100, 144]], "a"); d.det("M100 144Q92 154 84 148M100 144Q108 154 116 148", 3.5); d.circle(66, 140, 9, "s", { op: 0.55 }); d.circle(134, 140, 9, "s", { op: 0.55 });
  } },
  { id: "fish", name: "Fish", tags: ["fish", "ocean", "sea", "aquarium", "pet", "marine"], colls: ["Pets_Paws", "Sunset_Surf"], draw: (d) => {
    d.poly([[148, 100], [190, 62], [184, 100], [190, 138]], "s", { outline: true }); d.path("M22 100Q86 24 150 100Q86 176 22 100Z", "p", { outline: true }); d.path("M80 52Q96 28 116 46", "a", { outline: true }); d.path("M84 148Q96 172 116 154", "a", { outline: true });
    d.circle(56, 94, 9, "l"); d.circle(56, 94, 4.5, "d"); for (const x of [88, 108, 128]) d.det(`M${x} 80Q${x + 10} 100 ${x} 120`, 3.5, "l", 0.7);
  } },
  { id: "fox", name: "Fox", tags: ["fox", "wild", "animal", "forest", "wildlife", "geometric"], colls: ["Wildlife_Heroes"], draw: (d) => {
    d.poly([[100, 176], [24, 84], [28, 18], [78, 58], [122, 58], [172, 18], [176, 84]], "a", { outline: true }); d.poly([[28, 18], [50, 36], [40, 64]], "d"); d.poly([[172, 18], [150, 36], [160, 64]], "d");
    d.poly([[100, 176], [30, 96], [100, 130]], "l"); d.poly([[100, 176], [170, 96], [100, 130]], "l"); d.poly([[62, 92], [88, 100], [68, 110]], "d"); d.poly([[138, 92], [112, 100], [132, 110]], "d"); d.circle(100, 172, 9, "d");
  } },
  { id: "owl", name: "Owl", tags: ["owl", "wise", "night", "bird", "wildlife", "animal"], colls: ["Wildlife_Heroes"], draw: (d) => {
    d.poly([[44, 62], [54, 14], [86, 46]], "p", { outline: true }); d.poly([[156, 62], [146, 14], [114, 46]], "p", { outline: true }); d.ellipse(100, 112, 64, 76, "p", { outline: true }); d.ellipse(100, 138, 42, 46, "s");
    d.circle(70, 86, 25, "l", { outline: true }); d.circle(130, 86, 25, "l", { outline: true }); d.circle(72, 88, 11, "d"); d.circle(128, 88, 11, "d"); d.poly([[91, 102], [109, 102], [100, 122]], "a", { outline: true });
    d.ellipse(38, 128, 14, 38, "a", { rot: 12 }); d.ellipse(162, 128, 14, 38, "a", { rot: -12 }); for (const y of [128, 146, 164]) d.det(`M84 ${y}q8 8 16 0q8 8 16 0`, 3, "d", 0.5);
  } },
  { id: "lion", name: "Lion", tags: ["lion", "king", "wild", "brave", "wildlife", "animal", "leo"], colls: ["Wildlife_Heroes"], draw: (d) => {
    d.poly(starPts(100, 100, 92, 58, 18), "a", { outline: true }); d.circle(100, 106, 52, "p", { outline: true }); d.circle(58, 66, 14, "p", { outline: true }); d.circle(142, 66, 14, "p", { outline: true });
    d.ellipse(100, 128, 28, 20, "l", { outline: true }); d.poly([[91, 116], [109, 116], [100, 128]], "d"); d.circle(80, 96, 6, "d"); d.circle(120, 96, 6, "d"); d.det("M100 128V138M100 138Q90 148 82 142M100 138Q110 148 118 142", 4);
  } },
  { id: "panda", name: "Panda", tags: ["panda", "bamboo", "cute", "wildlife", "animal", "kids"], colls: ["Wildlife_Heroes", "Kids_Playroom"], draw: (d) => {
    d.circle(48, 50, 24, "d"); d.circle(152, 50, 24, "d"); d.circle(100, 108, 66, "l", { outline: true }); d.ellipse(72, 98, 18, 24, "d", { rot: 24 }); d.ellipse(128, 98, 18, 24, "d", { rot: -24 }); d.circle(75, 98, 6, "l"); d.circle(125, 98, 6, "l");
    d.ellipse(100, 126, 12, 8, "d"); d.stk("M100 134Q88 150 76 142M100 134Q112 150 124 142", "d", 4); d.circle(66, 136, 10, "s", { op: 0.5 }); d.circle(134, 136, 10, "s", { op: 0.5 });
  } },
  { id: "elephant", name: "Elephant", tags: ["elephant", "wildlife", "animal", "indian", "gentle", "kids"], colls: ["Wildlife_Heroes", "Desi_Festive"], draw: (d) => {
    d.circle(40, 96, 38, "s", { outline: true }); d.circle(160, 96, 38, "s", { outline: true }); d.circle(40, 96, 22, "a", { op: 0.5 }); d.circle(160, 96, 22, "a", { op: 0.5 });
    d.circle(100, 96, 58, "p", { outline: true }); d.stk("M100 122V162Q100 186 130 178", "p", 32); d.stk("M100 122V162Q100 186 130 178", "d", 3, { op: 0.0 }); d.path("M66 128Q54 150 66 170Q70 150 80 140Z", "l", { outline: true }); d.path("M134 128Q146 150 134 170Q130 150 120 140Z", "l", { outline: true }); d.circle(78, 84, 6.5, "d"); d.circle(122, 84, 6.5, "d");
  } },
  { id: "whale", name: "Whale", tags: ["whale", "ocean", "sea", "marine", "wildlife", "save the oceans"], colls: ["Wildlife_Heroes", "Sunset_Surf"], draw: (d) => {
    d.stk("M80 60Q80 40 70 28M80 60Q92 40 104 32", "s", 6); d.path("M18 124Q18 70 88 68Q150 68 168 104Q184 84 190 58Q198 92 186 118Q198 128 198 152Q170 144 160 132Q140 164 88 164Q18 164 18 124Z", "p", { outline: true });
    d.path("M30 134Q90 158 152 128Q140 160 88 164Q36 162 30 134Z", "l"); d.circle(52, 108, 6, "d"); d.stk("M56 130Q72 140 88 134", "d", 3.5);
  } },
  { id: "octopus", name: "Octopus", tags: ["octopus", "ocean", "sea", "tentacles", "marine", "wildlife"], colls: ["Wildlife_Heroes", "Sunset_Surf"], draw: (d) => {
    for (const [x0, bend] of [[54, -1], [74, 1], [96, -1], [118, 1], [140, -1]] as const) d.stk(`M${x0} 108Q${x0 + bend * 26} 150 ${x0 + bend * 10} 172Q${x0 + bend * 2} 184 ${x0 + bend * 14} 188`, "p", 16);
    d.ellipse(100, 68, 52, 52, "p", { outline: true }); d.circle(78, 76, 13, "l"); d.circle(122, 76, 13, "l"); d.circle(80, 78, 6, "d"); d.circle(120, 78, 6, "d"); d.stk("M90 100Q100 108 110 100", "d", 4); for (const [x, y] of [[66, 150], [136, 148], [100, 160]]) d.circle(x, y, 4, "s");
  } },
  { id: "butterfly", name: "Butterfly", tags: ["butterfly", "wings", "spring", "nature", "garden", "colourful"], colls: ["Wildlife_Heroes", "Botanical_Studio"], draw: (d) => {
    d.mirror(() => { d.path("M96 100Q38 12 18 50Q8 94 96 108Z", "p", { outline: true }); d.path("M96 112Q28 118 38 168Q80 192 98 124Z", "s", { outline: true }); d.circle(48, 66, 12, "a"); d.circle(60, 148, 9, "l"); d.circle(52, 92, 5, "l"); });
    d.ellipse(100, 112, 7, 46, "d"); d.det("M98 68Q90 44 74 36M102 68Q110 44 126 36", 4);
  } },
  { id: "bee", name: "Bumble Bee", tags: ["bee", "honey", "garden", "nature", "buzz", "eco", "insect"], colls: ["Eco_Earth", "Wildlife_Heroes"], draw: (d) => {
    d.ellipse(92, 62, 24, 36, "l", { rot: -25, outline: true, op: 0.95 }); d.ellipse(124, 60, 24, 36, "l", { rot: 15, outline: true, op: 0.95 });
    d.poly([[22, 118], [46, 108], [46, 128]], "d"); d.ellipse(94, 118, 56, 42, "a", { outline: true }); for (const x of [78, 104]) d.rect(x, 80, 14, 76, "d", { rx: 4 }); d.ellipse(94, 118, 56, 42, "a", { op: 0 }); d.circle(152, 116, 24, "d"); d.circle(160, 110, 6, "l"); d.det("M158 94Q164 76 178 72M146 94Q146 76 136 68", 4);
  } },
  { id: "surfboard", name: "Surfboard", tags: ["surf", "surfboard", "beach", "summer", "waves", "ocean", "goa"], colls: ["Sunset_Surf"], draw: (d) => {
    d.g("rotate(28 100 100)", () => { d.path("M100 4Q148 100 100 196Q52 100 100 4Z", "p", { outline: true }); d.stk("M100 20V180", "a", 8); d.path("M100 150Q116 168 100 184Q84 168 100 150Z", "d"); d.stk("M72 80Q100 70 128 80", "s", 6); });
  } },
  { id: "shell", name: "Seashell", tags: ["shell", "beach", "sea", "summer", "ocean", "scallop"], colls: ["Sunset_Surf"], draw: (d) => {
    d.path("M100 178L22 90Q16 40 62 34Q100 30 100 30Q100 30 138 34Q184 40 178 90Z", "p", { outline: true }); for (const a of [-60, -30, 0, 30, 60]) d.det(`M100 178L${n1(100 + 100 * Math.sin((a * Math.PI) / 180))} ${n1(178 - 120 * Math.cos((a * Math.PI) / 180))}`, 4, "d", 0.45); d.rect(78, 170, 44, 16, "a", { rx: 6, outline: true });
  } },
];

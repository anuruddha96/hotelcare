/**
 * HotelCare review reply library.
 * Each rating has 11 topic categories × 6 editorially curated response ideas
 * (132 core variations), plus varied introductions and natural endings.
 * Content is selected deterministically per review; no OpenAI call is needed.
 * Never add service claims without written review evidence.
 */
export type ReviewTopic = "general" | "staff" | "service" | "food" | "breakfast" |
  "coffee" | "location" | "cleanliness" | "atmosphere" | "value" | "rooms";
type Rating = "4" | "5";
type Variants = Record<Rating, string[]>;
const topics: Record<ReviewTopic, Variants> = {
  general: {
    "5": [
      "Your generous rating means a lot to the whole team.",
      "We're grateful that you chose to share such a positive rating.",
      "It's lovely to receive your encouragement.",
      "Your kind rating gives our team a wonderful boost.",
      "We're pleased to have earned such a lovely rating.",
      "It means so much when guests take a moment to share their appreciation.",
    ],
    "4": [
      "We appreciate your support and will keep aiming for an even better experience.",
      "Four stars mean a lot, and we'll keep working on the finer details.",
      "We're glad you took a moment to rate your experience.",
      "Thank you for your encouragement as we continue to improve.",
      "Your rating is appreciated, and we hope to make another visit even better.",
      "We value your rating and the opportunity to keep getting better.",
    ],
  },
  staff: {
    "5": [
      "We're delighted that the team made you feel welcome.",
      "It's especially rewarding to hear kind words about our colleagues.",
      "Your recognition of the team means so much to us.",
      "We're happy the people behind your experience stood out.",
      "We'll be glad to share your encouraging words with the team.",
      "Our team will be pleased to know their care was noticed.",
    ],
    "4": [
      "We appreciate your kind words about the team and your thoughtful rating.",
      "It's encouraging to hear our colleagues made a positive impression.",
      "Your recognition of the staff is appreciated; we're always learning.",
      "We're glad the team contributed positively to your visit.",
      "We'll share your feedback with the colleagues who helped you.",
      "Thank you for acknowledging our staff as we work on the details.",
    ],
  },
  service: {
    "5": [
      "It's wonderful to hear that the service stood out for you.",
      "We're so pleased our service made your experience enjoyable.",
      "Your comments about the service are especially rewarding.",
      "Knowing that the service met your expectations makes our day.",
      "We're glad the attention you received made a difference.",
      "Thank you for noticing the care that goes into our service.",
    ],
    "4": [
      "We're glad you appreciated the service, and we'll keep refining the details.",
      "Your feedback on the service is very helpful to our team.",
      "It's good to know our service made a positive impression.",
      "We appreciate the four stars and your comments about the service.",
      "Your experience helps us see where we can make service even better.",
      "Thank you for highlighting the service; we'll keep improving.",
    ],
  },
  food: {
    "5": [
      "We're thrilled you enjoyed the food you mentioned.",
      "Your lovely comments about the food are a pleasure to read.",
      "It's wonderful to know the flavors made an impression.",
      "We're glad the food added something special to your visit.",
      "Your appreciation of the food means a great deal to the team.",
      "We love hearing that the food was a highlight for you.",
    ],
    "4": [
      "Thank you for your comments about the food and for the four stars.",
      "We're pleased the food was a positive part of your visit.",
      "Your feedback on the food is appreciated as we refine our offering.",
      "We value the four-star rating and your impressions of the food.",
      "It's encouraging to know the food stood out in your experience.",
      "Your thoughts about the food help us keep improving.",
    ],
  },
  breakfast: {
    "5": [
      "It's lovely to hear you enjoyed the breakfast.",
      "We're delighted that breakfast was a highlight of your visit.",
      "Your kind words about breakfast are wonderful to receive.",
      "We're glad breakfast helped start your day on a positive note.",
      "It's a pleasure to know our breakfast offering stood out for you.",
      "We're happy you enjoyed the breakfast experience.",
    ],
    "4": [
      "We appreciate your thoughts about breakfast and your four-star rating.",
      "We're pleased you enjoyed the breakfast and will keep improving the details.",
      "Thank you for taking the time to share your breakfast experience.",
      "Your breakfast feedback is valuable to the team.",
      "It's good to know breakfast made a positive impression.",
      "We'll keep working to make the breakfast experience even better.",
    ],
  },
  coffee: {
    "5": [
      "We're especially happy to hear you enjoyed the coffee.",
      "It's lovely that the coffee stood out for you.",
      "We're glad your coffee was a highlight of the visit.",
      "Your appreciation of the coffee means a lot to the team.",
      "Great to hear the coffee added to your experience.",
      "We're pleased the coffee earned such kind words.",
    ],
    "4": [
      "We're happy you mentioned the coffee and appreciate the four stars.",
      "Thank you for sharing your thoughts about the coffee.",
      "We're pleased the coffee made a positive impression.",
      "Your feedback about the coffee helps us keep refining the experience.",
      "We're grateful for the four stars and your comments about the coffee.",
      "It's good to know you enjoyed the coffee you mentioned.",
    ],
  },
  location: {
    "5": [
      "We're pleased our location suited your plans so well.",
      "It's wonderful to hear you enjoyed where we're situated.",
      "We're glad the location added convenience to your visit.",
      "It's a pleasure to know the location worked so well for you.",
      "Your comments about the location are lovely to hear.",
      "We're happy our setting was a positive part of your experience.",
    ],
    "4": [
      "Thank you for noting the location and for your thoughtful rating.",
      "We're glad the location worked well for your visit.",
      "We appreciate your comments on the location and the four stars.",
      "It's encouraging to hear our location suited your needs.",
      "Your feedback about our location is appreciated.",
      "We're pleased the location was a positive part of your experience.",
    ],
  },
  cleanliness: {
    "5": [
      "We're so pleased the cleanliness stood out to you.",
      "Thank you for noticing the care taken with cleanliness.",
      "It's wonderful to hear you appreciated how things were kept.",
      "Your kind words about cleanliness mean a lot to us.",
      "We're happy the attention to cleanliness made a difference.",
      "We're glad you noticed the care given to our spaces.",
    ],
    "4": [
      "We appreciate your observations about cleanliness and the four stars.",
      "Thank you for noticing the attention paid to our spaces.",
      "It's good to hear cleanliness made a positive impression.",
      "Your comments on cleanliness are helpful to the team.",
      "We're pleased you appreciated the upkeep of our spaces.",
      "We'll keep paying attention to cleanliness and the smaller details.",
    ],
  },
  atmosphere: {
    "5": [
      "We're delighted you enjoyed the atmosphere.",
      "It's lovely that the atmosphere was a highlight for you.",
      "We're so pleased the surroundings made a positive impression.",
      "Your kind words about the atmosphere are wonderful to hear.",
      "We're glad you liked the feel of the place.",
      "It's great to know the atmosphere added to your experience.",
    ],
    "4": [
      "We appreciate the four stars and your comments about the atmosphere.",
      "We're pleased the atmosphere added to your visit.",
      "Thank you for sharing your impressions of the surroundings.",
      "Your feedback on the atmosphere means a lot to us.",
      "We're glad the environment made a positive impression.",
      "It's encouraging to hear you enjoyed the atmosphere.",
    ],
  },
  value: {
    "5": [
      "We're glad you felt the experience offered good value.",
      "It's wonderful to hear you appreciated the value of your visit.",
      "We're pleased the experience felt worthwhile to you.",
      "Your comments about value are especially appreciated.",
      "We're happy the offering met your expectations for value.",
      "It's lovely to know you felt your visit was worth it.",
    ],
    "4": [
      "We appreciate your thoughts about value and your four-star rating.",
      "Your comments on value help us see the experience from your perspective.",
      "We're pleased you found value in your visit.",
      "Thank you for sharing your view on value; it helps us improve.",
      "We're grateful for the four stars and your thoughts on the offering.",
      "We value your feedback about the experience and its worth.",
    ],
  },
  rooms: {
    "5": [
      "We're delighted the room was a highlight of your stay.",
      "It's wonderful to hear you enjoyed the room.",
      "We're glad the accommodation suited your visit.",
      "Your kind comments about the room mean a lot to us.",
      "We're happy the room made a good impression.",
      "We're pleased you enjoyed your accommodation.",
    ],
    "4": [
      "We appreciate your comments on the room and the four stars.",
      "Thank you for letting us know how you found the room.",
      "We're pleased the accommodation was a positive part of your stay.",
      "Your room feedback helps us focus on the details.",
      "We're grateful for your observations about the room.",
      "It's encouraging to hear you appreciated the accommodation.",
    ],
  },
};
const keywords: Array<[ReviewTopic, RegExp]> = [
  ["staff", /\b(staff|team|employee|waiter|waitress|receptionist|host|colleagues|personnel)\b|személyzet|felszolgál|pincér|recepciós|kedvesek|kiszolgálók/i],
  ["coffee", /\b(coffee|espresso|cappuccino|latte|barista|flat white)\b|kávé|barista/i],
  ["breakfast", /\b(breakfast|brunch|buffet|pancakes|croissant)\b|reggeli|brunch|svédasztal/i],
  ["food", /\b(food|meal|dish|dessert|brownie|taste|flavor|delicious|dinner|lunch|menu)\b|étel|finom|ebéd|vacsora|desszert/i],
  ["service", /\b(service|helpful|friendly|attentive|prompt|quick|efficient|wait time|waiting)\b|kiszolgálás|segítőkész|gyors|figyelmes|várakozás/i],
  ["location", /\b(location|central|centre|center|nearby|walkable|neighborhood)\b|elhelyezkedés|belváros|központ|közel/i],
  ["cleanliness", /\b(clean|spotless|tidy|hygien|neat)\b|tiszta|tisztaság|rendezett/i],
  ["atmosphere", /\b(atmosphere|ambience|ambiance|cozy|decor|vibe|interior|music)\b|hangulat|környezet|otthonos/i],
  ["value", /\b(value|price|pricing|affordable|worth|reasonable)\b|ár.?érték|megéri|árak/i],
  ["rooms", /\b(room|bed|suite|accommodation|sleep|mattress)\b|szoba|ágy|alvás/i],
];
const negatives = /\b(but|however|unfortunately|disappoint|poor|bad|cold|overpriced|slow|rude|dirty|noisy|not good|not enough|waited|problem|issue|complaint|terrible|broken|worse|late)\b|de\s|viszont|sajnos|rossz|hideg|lassú|drága|koszos|piszkos|panasz|probléma|zajos|nem\s/i;
const hungarianWords = /nagyon|köszön|kedves|személyzet|kiszolgálás|finom|reggeli|kávé|hangulat|szoba|elhelyezkedés|tisztaság|visszatér|ajánlom|tetszett|szuper|élmény|gyors|remek|kellemes/i;
const starters: Record<Rating, string[]> = {
  "5": [
    "Thank you for the five stars{guest}!",
    "We're grateful for your wonderful rating{guest}.",
    "Many thanks for sharing your lovely review{guest}.",
    "We really appreciate your five-star support{guest}.",
    "What a pleasure to read your five-star feedback{guest}!",
    "Your five stars mean a lot to us{guest}.",
  ],
  "4": [
    "Thank you for the four stars{guest}.",
    "We're grateful for your thoughtful rating{guest}.",
    "Many thanks for taking the time to review us{guest}.",
    "We appreciate your four-star feedback{guest}.",
    "Thank you for sharing your impressions{guest}.",
    "Your four stars and feedback are appreciated{guest}.",
  ],
};
const closers: Record<Rating, string[]> = {
  "5": [
    "We hope to welcome you back to {venue} soon.",
    "It would be lovely to see you again.",
    "We look forward to another visit.",
    "We hope you'll stop by again.",
    "Until next time!",
    "We'd be delighted to welcome you back.",
  ],
  "4": [
    "We hope to make your next visit even better.",
    "We look forward to another opportunity to welcome you.",
    "We'd love to see you again.",
    "Thank you for giving us the chance to keep improving.",
    "We hope your next visit earns a fifth star.",
    "We look forward to welcoming you back.",
  ],
};
const hungarian: Record<Rating, string[]> = {
  "5": [
    "Köszönjük szépen az ötcsillagos értékelést{guest}! Örülünk, hogy ilyen kedvező benyomást szereztél. Várunk vissza szeretettel a {venue} csapatával!",
    "Hálásak vagyunk az öt csillagért{guest}! Nagyon sokat jelent számunkra a visszajelzésed. Reméljük, hamarosan újra találkozunk!",
    "Nagyon köszönjük a maximális értékelést{guest}! Öröm számunkra, hogy megosztottad a tapasztalatodat.",
    "Köszönjük az öt csillagot{guest}! A csapatunknak sokat jelent az elismerésed. Szeretettel várunk legközelebb is!",
    "Köszönjük, hogy időt szántál az értékelésre{guest}! Nagyon örülünk az öt csillagnak, és reméljük, hamarosan újra vendégül láthatunk.",
    "Nagyon hálásak vagyunk a kedves értékelésért{guest}! Jó érzés tudni, hogy pozitív élménnyel távoztál.",
    "Köszönjük az ötcsillagos támogatást{guest}! Reméljük, legközelebb is találkozunk.",
    "Őszintén köszönjük a kiváló értékelést{guest}! A visszajelzésed sokat jelent nekünk.",
  ],
  "4": [
    "Köszönjük a négycsillagos értékelést{guest}! Értékeljük a visszajelzésedet, és azon dolgozunk, hogy legközelebb még jobb élményben legyen részed.",
    "Nagyon köszönjük a négy csillagot{guest}! Reméljük, legközelebb az ötödiket is kiérdemelhetjük.",
    "Hálásak vagyunk az értékelésedért{guest}! Fontos nekünk, hogy folyamatosan fejlődjünk.",
    "Köszönjük, hogy megosztottad a tapasztalatodat{guest}! Bízunk benne, hogy legközelebb is találkozunk.",
    "Köszönjük a pozitív értékelést{guest}! Figyelünk a részletekre, és igyekszünk egyre jobbak lenni.",
    "Nagyon értékeljük a négy csillagot{guest}! Szeretettel várunk újra.",
    "Köszönjük a visszajelzésedet{guest}! Örülünk a négy csillagnak, és tovább dolgozunk a fejlődésen.",
    "Köszönjük az értékelést{guest}! Reméljük, legközelebb még szebb élménnyel gazdagodsz.",
  ],
};
export const CURATED_REPLY_BASE_COUNT = Object.values(topics)
  .reduce((n, entry) => n + entry["4"].length + entry["5"].length, 0);
export const CURATED_TOPICS = Object.keys(topics) as ReviewTopic[];
const hash = (value: string) => {
  let n = 2166136261;
  for (const ch of value) n = Math.imul(n ^ ch.charCodeAt(0), 16777619);
  return n >>> 0;
};
const firstName = (input: string) => {
  const name = (input || "").trim().split(/\s+/)[0] || "";
  return /^[\p{L}][\p{L}'’-]{1,24}$/u.test(name) &&
    !/^(google|anonymous|user|local|guide|guest|unknown)$/i.test(name) ? name : "";
};
export function replyTopic(comment: string): ReviewTopic {
  for (const [topic, regex] of keywords) if (regex.test(comment)) return topic;
  return "general";
}
export function requiresCarefulReview(comment: string) {
  return Boolean(comment && negatives.test(comment));
}
export type PoolReplyInput = {
  reviewId: string;
  rating: number;
  comment?: string | null;
  reviewerName?: string | null;
  venueName: string;
  languageMode?: string | null;
  venueCategory?: string | null;
  venueContext?: string | null;
  signature?: string | null;
};
export function buildCuratedReply(input: PoolReplyInput) {
  if (![4, 5].includes(Number(input.rating))) return null;
  const comment = String(input.comment || "").trim();
  if (requiresCarefulReview(comment)) return null;
  const textLanguage = input.languageMode === "hungarian" ? "hu" :
    input.languageMode === "english" ? "en" : comment && hungarianWords.test(comment) ? "hu" : "en";
  const topic = replyTopic(comment);
  const seed = hash(input.reviewId + "|" + input.venueName + "|" + input.rating);
  const rating = String(input.rating) as Rating;
  const guestName = firstName(input.reviewerName || "");
  const guest = guestName ? ", " + guestName : "";
  const venue = String(input.venueName || "our business").trim().slice(0, 120);
  const signature = String(input.signature || "").trim().slice(0, 100);
  if (textLanguage === "hu") {
    const pool = hungarian[rating];
    const base = pool[seed % pool.length].replaceAll("{guest}", guest).replaceAll("{venue}", venue);
    return { text: signature ? base + "\n\n" + signature : base,
      topic, templateId: "hu-" + rating + "-" + (seed % pool.length), language: "hu", method: "curated_pool" };
  }
  const phrases = topics[topic][rating];
  const start = starters[rating][seed % starters[rating].length].replaceAll("{guest}", guest);
  let message = phrases[Math.floor(seed / 11) % phrases.length];
  // More specific products/benefits are mentioned ONLY if in the guest's text,
  // with independently verified factual venue context.
  if (topic === "coffee" && /barista/i.test(String(input.venueContext || "")) &&
      /barista|coffee|espresso|cappuccino|latte|kávé/i.test(comment)) {
    message = message.replace(/the coffee/i, "the barista-made coffee");
  }
  if (topic === "location" && /city cent(?:er|re)|belváros/i.test(String(input.venueContext || "")) &&
      /central|centre|center|location|belváros|központ/i.test(comment)) {
    message = message.replace("the location", "our city-centre location").replace("our location", "our city-centre location");
  }
  const ending = closers[rating][Math.floor(seed / 101) % closers[rating].length]
    .replaceAll("{venue}", venue);
  const output = [start, message, ending].join(" ");
  return { text: signature ? output + "\n\n" + signature : output,
    topic, templateId: "en-" + rating + "-" + topic + "-" + (Math.floor(seed / 11) % phrases.length) +
      "-" + (seed % starters[rating].length) + "-" + (Math.floor(seed / 101) % closers[rating].length),
    language: "en", method: "curated_pool" };
}

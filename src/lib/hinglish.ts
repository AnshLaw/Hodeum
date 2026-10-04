/**
 * Hinglish text tools. Hodey writes Hinglish the way people type it: Hindi words in Devanagari, English
 * words in English ("Insert tab पर click कीजिए"). From that one form:
 * - `speakable` spells known English words in Devanagari, which the Hindi voice pronounces well;
 * - `romanize` writes the Hindi words in English letters for learners who read Hinglish that way.
 */

/** English words Hodey uses, as the Hindi voice should say them. Display form first (its casing is kept). */
const LOANWORDS: [string, string][] = [
  ["PivotTable", "पिवट टेबल"], ["PivotTables", "पिवट टेबल्स"], ["Insert", "इंसर्ट"], ["Home", "होम"], ["Data", "डेटा"],
  ["Formulas", "फ़ॉर्मूलाज़"], ["Excel", "एक्सेल"], ["OK", "ओके"], ["Region", "रीजन"], ["Sales", "सेल्स"], ["Product", "प्रोडक्ट"],
  ["Windows", "विंडोज़"], ["Explorer", "एक्सप्लोरर"], ["ZIP", "ज़िप"], ["Hode", "होड"], ["Hodey", "होडी"],
  ["click", "क्लिक"], ["right-click", "राइट-क्लिक"], ["double-click", "डबल-क्लिक"], ["tab", "टैब"], ["tabs", "टैब्स"],
  ["pivot", "पिवट"], ["table", "टेबल"], ["tables", "टेबल्स"], ["ribbon", "रिबन"], ["button", "बटन"], ["buttons", "बटन्स"],
  ["range", "रेंज"], ["confirm", "कन्फ़र्म"], ["field", "फ़ील्ड"], ["fields", "फ़ील्ड्स"], ["list", "लिस्ट"], ["tick", "टिक"],
  ["total", "टोटल"], ["totals", "टोटल्स"], ["value", "वैल्यू"], ["values", "वैल्यूज़"], ["row", "रो"], ["rows", "रोज़"],
  ["column", "कॉलम"], ["columns", "कॉलम्स"], ["cell", "सेल"], ["cells", "सेल्स"], ["sheet", "शीट"], ["workbook", "वर्कबुक"],
  ["chart", "चार्ट"], ["charts", "चार्ट्स"], ["dialog", "डायलॉग"], ["menu", "मेन्यू"], ["option", "ऑप्शन"], ["options", "ऑप्शन्स"],
  ["file", "फ़ाइल"], ["files", "फ़ाइल्स"], ["folder", "फ़ोल्डर"], ["zip", "ज़िप"], ["compress", "कंप्रेस"], ["archive", "आर्काइव"],
  ["window", "विंडो"], ["maximize", "मैक्सिमाइज़"], ["mouse", "माउस"], ["select", "सेलेक्ट"], ["selected", "सेलेक्टेड"], ["step", "स्टेप"], ["steps", "स्टेप्स"],
  ["hint", "हिंट"], ["highlight", "हाइलाइट"], ["screen", "स्क्रीन"], ["save", "सेव"], ["copy", "कॉपी"], ["paste", "पेस्ट"],
  ["format", "फ़ॉर्मैट"], ["software", "सॉफ़्टवेयर"], ["computer", "कंप्यूटर"], ["settings", "सेटिंग्स"], ["app", "ऐप"],
  ["filter", "फ़िल्टर"], ["sort", "सॉर्ट"], ["group", "ग्रुप"], ["checkbox", "चेकबॉक्स"], ["scroll", "स्क्रॉल"], ["type", "टाइप"],
  ["enter", "एंटर"], ["delete", "डिलीट"], ["add", "ऐड"], ["use", "यूज़"], ["left", "लेफ़्ट"], ["right", "राइट"], ["top", "टॉप"],
  ["summary", "समरी"], ["rearrange", "रीअरेंज"], ["number", "नंबर"], ["numbers", "नंबर्स"], ["actions", "एक्शन्स"], ["pack", "पैक"],
  ["share", "शेयर"], ["common", "कॉमन"], ["extra", "एक्स्ट्रा"], ["area", "एरिया"], ["mark", "मार्क"], ["control", "कंट्रोल"],
  ["pointer", "पॉइंटर"], ["second", "सेकंड"], ["okay", "ओके"], ["switch", "स्विच"], ["answer", "आंसर"], ["local", "लोकल"],
  ["vision", "विज़न"], ["model", "मॉडल"], ["ready", "रेडी"], ["point", "पॉइंट"], ["Ask", "आस्क"], ["sure", "श्योर"], ["complete", "कम्प्लीट"],
  ["to", "टू"], ["help", "हेल्प"], ["mode", "मोड"], ["stop", "स्टॉप"], ["done", "डन"],
  ["try", "ट्राई"], ["close", "क्लोज़"], ["perfect", "परफ़ेक्ट"], ["great", "ग्रेट"], ["good", "गुड"],
  ["iPhone", "आईफ़ोन"], ["phone", "फ़ोन"], ["tap", "टैप"], ["Display", "डिस्प्ले"], ["Brightness", "ब्राइटनेस"], ["Appearance", "अपीयरेंस"],
  ["Dark", "डार्क"], ["Light", "लाइट"], ["Wallpaper", "वॉलपेपर"], ["Text", "टेक्स्ट"], ["Size", "साइज़"], ["mirror", "मिरर"],
  ["mirroring", "मिररिंग"], ["Show", "शो"], ["connect", "कनेक्ट"], ["start", "स्टार्ट"], ["on", "ऑन"], ["grey", "ग्रे"], ["gear", "गियर"],
  ["setting", "सेटिंग"], ["look", "लुक"], ["background", "बैकग्राउंड"], ["choices", "चॉइसेज़"], ["Screen", "स्क्रीन"],
  ["search", "सर्च"], ["formula", "फ़ॉर्मूला"], ["quick", "क्विक"], ["check", "चेक"], ["email", "ईमेल"], ["skip", "स्किप"], ["card", "कार्ड"], ["sounds", "साउंड्स"],
];

/** Common Hindi words written the way people type Hinglish (rules alone get these wrong). */
const HINDI_WORDS: Record<string, string> = {
  में: "mein", हैं: "hain", है: "hai", नहीं: "nahi", यह: "yeh", ये: "ye", वह: "woh", वो: "wo", क्या: "kya", हाँ: "haan", हां: "haan",
  तो: "to", भी: "bhi", और: "aur", मैं: "main", मैंने: "maine", आप: "aap", आपने: "aapne", आपको: "aapko", आपकी: "aapki", आपका: "aapka",
  इसे: "ise", उसे: "use", इसका: "iska", किस: "kis", कौन: "kaun", कैसे: "kaise", क्यों: "kyon", कहाँ: "kahaan", यहाँ: "yahaan",
  वहाँ: "wahaan", अब: "ab", फिर: "phir", से: "se", पर: "par", को: "ko", का: "ka", की: "ki", के: "ke", एक: "ek", हूँ: "hoon",
  हो: "ho", कीजिए: "kijiye", करो: "karo", करें: "karein", बहुत: "bahut", बढ़िया: "badhiya", ठीक: "theek", सही: "sahi", ज़रा: "zara",
  थोड़ा: "thoda", ऊपर: "upar", नीचे: "neeche", तरफ़: "taraf", लिए: "liye", जैसे: "jaise", सब: "sab", कुछ: "kuch", खुद: "khud",
  साथ: "saath", देखिए: "dekhiye", चुनिए: "chuniye", इसलिए: "isliye", ताकि: "taaki", चाहिए: "chahiye", कोई: "koi", किसी: "kisi",
  बिना: "bina", जगह: "jagah", बगल: "bagal", हिसाब: "hisaab", पहला: "pehla", बाद: "baad",
};

const NUKTA = /़/g;
const strip = (word: string) => word.normalize("NFC").replace(NUKTA, "");
const DEVANAGARI_WORD = /[ऀ-ॣ०-ॿ]+/g;
const LATIN_WORD = /[A-Za-z][A-Za-z'-]*/g;

const TO_DEVANAGARI = new Map(LOANWORDS.map(([english, hindi]) => [english.toLowerCase(), hindi]));
const TO_ENGLISH = new Map<string, string>();
for (const [english, hindi] of LOANWORDS) if (!TO_ENGLISH.has(strip(hindi))) TO_ENGLISH.set(strip(hindi), english);
const HINDI_ROMAN = new Map(Object.entries(HINDI_WORDS).map(([hindi, roman]) => [strip(hindi), roman]));

/** Two-word spellings ("पिवट टेबल" → PivotTable), longest first, matched with or without nuktas. */
const TWO_WORD: [RegExp, string][] = [...TO_ENGLISH.entries()]
  .filter(([hindi]) => hindi.includes(" "))
  .sort(([a], [b]) => b.length - a.length)
  .map(([hindi, english]) => [new RegExp([...hindi].map((c) => `${c}़?`).join(""), "g"), english]);

/** An English word written in Devanagari ("क्लिक"), as speech recognition does for Hinglish. */
export const isLoanword = (word: string): boolean => TO_ENGLISH.has(strip(word));

/** For Hodey's Hindi voice: known English words in a Hindi sentence spelled in Devanagari. */
export function speakable(text: string): string {
  if (!/[ऀ-ॿ]/.test(text)) return text;
  return text.replace(LATIN_WORD, (word) => TO_DEVANAGARI.get(word.toLowerCase()) ?? word);
}

/** For learners who read Hinglish in English letters ("Insert tab par click kijiye"). */
export function romanize(text: string): string {
  if (!/[ऀ-ॿ]/.test(text)) return text;
  let out = text.normalize("NFC");
  for (const [pattern, english] of TWO_WORD) out = out.replace(pattern, english);
  out = out.replace(DEVANAGARI_WORD, (word) => TO_ENGLISH.get(strip(word)) ?? HINDI_ROMAN.get(strip(word)) ?? transliterate(word));
  out = out.replace(/।/g, ".").replace(/॥/g, ".");
  return out.replace(/(^|[.!?]\s+)([a-z])/g, (_, start: string, letter: string) => start + letter.toUpperCase());
}

const CONSONANTS: Record<string, string> = {
  क: "k", ख: "kh", ग: "g", घ: "gh", ङ: "n", च: "ch", छ: "chh", ज: "j", झ: "jh", ञ: "n", ट: "t", ठ: "th", ड: "d", ढ: "dh", ण: "n",
  त: "t", थ: "th", द: "d", ध: "dh", न: "n", प: "p", फ: "ph", ब: "b", भ: "bh", म: "m", य: "y", र: "r", ल: "l", व: "v", श: "sh",
  ष: "sh", स: "s", ह: "h", ळ: "l",
};
/** Consonants with a nukta (ज़, फ़, ड़). */
const NUKTA_CONSONANTS: Record<string, string> = { क: "q", ख: "kh", ग: "gh", ज: "z", ड: "d", ढ: "dh", फ: "f" };
const VOWELS: Record<string, string> = { अ: "a", आ: "aa", इ: "i", ई: "ee", उ: "u", ऊ: "oo", ऋ: "ri", ए: "e", ऐ: "ai", ओ: "o", औ: "au", ऑ: "o", ऍ: "e" };
const MATRAS: Record<string, string> = { "ा": "aa", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo", "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॉ": "o", "ॅ": "e" };
const VIRAMA = "्";
const NASALS = new Set(["ं", "ँ"]);
const DIGITS = "०१२३४५६७८९";

/** One syllable: a consonant cluster and its vowel ("a" when it's the inherent vowel, which may be silent). */
interface Syllable {
  consonants: string[];
  vowel: string;
  inherent: boolean;
  nasal: boolean;
}

function syllables(word: string): Syllable[] {
  const out: Syllable[] = [];
  let joining = false;
  let lastConsonant = "";
  for (const c of word.normalize("NFD")) {
    const last = out.at(-1);
    if (CONSONANTS[c]) lastConsonant = c;
    if (c === "़" && last) {
      const withNukta = NUKTA_CONSONANTS[lastConsonant];
      if (withNukta) last.consonants[last.consonants.length - 1] = withNukta;
    } else if (CONSONANTS[c] && joining && last) {
      last.consonants.push(CONSONANTS[c]);
      joining = false;
    } else if (CONSONANTS[c]) {
      out.push({ consonants: [CONSONANTS[c]], vowel: "a", inherent: true, nasal: false });
    } else if (c === VIRAMA && last) {
      last.vowel = "";
      last.inherent = false;
      joining = true;
    } else if (MATRAS[c] && last) {
      last.vowel = MATRAS[c];
      last.inherent = false;
    } else if (VOWELS[c]) {
      out.push({ consonants: [], vowel: VOWELS[c], inherent: false, nasal: false });
    } else if (NASALS.has(c) && last) {
      last.nasal = true;
    } else if (DIGITS.includes(c)) {
      out.push({ consonants: [String(DIGITS.indexOf(c))], vowel: "", inherent: false, nasal: false });
    }
  }
  return out;
}

/** Hindi drops the inherent vowel at a word's end and between a vowel and a single consonant + vowel. */
function dropSilentVowels(word: Syllable[]): void {
  const last = word.at(-1);
  if (word.length > 1 && last?.inherent) last.vowel = "";
  for (let i = word.length - 2; i >= 1; i--) {
    const [before, here, after] = [word[i - 1], word[i], word[i + 1]];
    if (here.inherent && before.vowel !== "" && after.consonants.length === 1 && after.vowel !== "") here.vowel = "";
  }
}

/** Long vowels are written short where Hinglish usually does ("karna", not "karnaa"). */
function vowelFor(syllable: Syllable, index: number, count: number): string {
  const final = index === count - 1;
  if (syllable.vowel === "aa" && syllable.consonants.length > 0 && (final || index > 0)) return "a";
  if (syllable.vowel === "ee" && final) return "i";
  return syllable.vowel;
}

function transliterate(word: string): string {
  const parts = syllables(word);
  dropSilentVowels(parts);
  const roman = parts.map((s, i) => s.consonants.join("") + vowelFor(s, i, parts.length) + (s.nasal ? "n" : "")).join("");
  // A vowel after "i" gets a glide, as in "kijiye".
  return roman.replace(/i([aeou])/g, "iy$1");
}

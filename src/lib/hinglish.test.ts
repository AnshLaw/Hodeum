import { describe, expect, it } from "vitest";
import { isLoanword, romanize, speakable } from "./hinglish";
import { detectLanguage } from "./language";

describe("speakable", () => {
  it("writes known English words in Devanagari inside Hindi sentences, so the Hindi voice says them well", () => {
    expect(speakable("ऊपर Insert tab पर click कीजिए।")).toBe("ऊपर इंसर्ट टैब पर क्लिक कीजिए।");
    expect(speakable("अब PivotTable पर click कीजिए।")).toBe("अब पिवट टेबल पर क्लिक कीजिए।");
  });

  it("leaves English sentences and unknown words alone", () => {
    expect(speakable("Click the Insert tab.")).toBe("Click the Insert tab.");
    expect(speakable("ये Zorblax है।")).toBe("ये Zorblax है।");
  });
});

describe("romanize", () => {
  it("writes Hindi words in English letters and keeps English words as they are", () => {
    expect(romanize("ऊपर Insert tab पर click कीजिए।")).toBe("Upar Insert tab par click kijiye.");
    expect(romanize("मैंने उसे highlight कर दिया है।")).toBe("Maine use highlight kar diya hai.");
  });

  it("turns Devanagari spellings of English words back into English", () => {
    expect(romanize("इंसर्ट टैब खोलिए")).toBe("Insert tab kholiye");
    expect(romanize("पिवट टेबल पर क्लिक कीजिए")).toBe("PivotTable par click kijiye");
  });

  it("drops the silent vowels the way people write Hinglish", () => {
    expect(romanize("समझाओ")).toBe("Samjhao");
    expect(romanize("नमस्ते")).toBe("Namaste");
    expect(romanize("करना")).toBe("Karna");
    expect(romanize("बहुत बढ़िया")).toBe("Bahut badhiya");
  });

  it("leaves text without Devanagari untouched", () => {
    expect(romanize("Click OK.")).toBe("Click OK.");
  });
});

describe("isLoanword", () => {
  it("knows English words as speech recognition writes them in Devanagari", () => {
    expect(isLoanword("क्लिक")).toBe(true);
    expect(isLoanword("कीजिए")).toBe(false);
  });
});

describe("detectLanguage", () => {
  it("hears English, Hindi and Hinglish", () => {
    expect(detectLanguage("teach me how to make a pivot table")).toBe("en");
    expect(detectLanguage("मुझे यह समझ नहीं आ रहा")).toBe("hi");
    expect(detectLanguage("मुझे पिवट टेबल बनाना सिखाओ")).toBe("hinglish");
    expect(detectLanguage("ये button क्या करता है")).toBe("hinglish");
    expect(detectLanguage("mujhe pivot table banana sikhao")).toBe("hinglish");
  });

  it("stays in English for English words the speech model spelled in Devanagari", () => {
    expect(detectLanguage("शो मी फॉलिप स्लाइडर")).toBe("en");
    expect(detectLanguage("वॉल्यूम स्लाइडर कहाँ")).toBe("en");
  });

  it("needs a sentence, not a word or two, to switch language", () => {
    expect(detectLanguage("क्या है")).toBeUndefined();
    expect(detectLanguage("kya hai")).toBeUndefined();
  });
});

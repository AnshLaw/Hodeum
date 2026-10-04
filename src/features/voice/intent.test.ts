import { describe, expect, it } from "vitest";
import { appQuery, classify, isSubstantive, opensWithQuestion, type Intent } from "./intent";

/** The 30 cases the idle-loop investigation validated, plus the Hinglish and Hindi ones. */
const CASES: [string, Intent][] = [
  ["Hello hello hello hello", "noise"],
  ["Fifteen sixteen seventeen", "noise"],
  ["We are okay we are going to put monster tricks out a little bit", "unclear"],
  ["Hello, can you hear me", "greeting"],
  ["Hello body, can you listen to", "greeting"],
  ["hi there", "greeting"],
  ["how are you", "greeting"],
  ["good morning", "greeting"],
  ["testing testing", "noise"],
  ["testing one two three", "greeting"],
  ["um hello", "greeting"],
  ["yeah yeah", "noise"],
  ["thank you for watching", "noise"],
  ["what's up", "greeting"],
  ["namaste", "greeting"],
  ["नमस्ते", "greeting"],
  ["open whatsapp", "open_app"],
  ["open brave", "open_app"],
  ["launch excel", "open_app"],
  ["open the file explorer", "open_app"],
  ["switch to excel", "open_app"],
  ["open whatsapp please", "open_app"],
  ["excel kholo", "open_app"],
  ["एक्सेल खोलो", "open_app"],
  ["how to send a pdf on whatsapp", "task"],
  ["how to open whatsapp", "task"],
  ["make a pivot table in excel", "task"],
  ["teach me how to make a pivot table", "task"],
  ["zip these files", "task"],
  ["turn on dark mode on iphone", "task"],
  ["send a pdf to mom on whatsapp", "task"],
  ["open a new tab in brave", "task"],
  ["pivot table kaise banate hain", "task"],
  ["पिवट टेबल कैसे बनाते हैं", "task"],
  ["what does this button do", "question"],
  ["where is the insert tab", "question"],
  ["ये बटन क्या करता है", "question"],
  ["new tab", "unclear"],
  ["add a chart", "task"],
  ["thanks", "ack"],
  ["okay great", "ack"],
  ["", "noise"],
  ["um", "noise"],
  ["[music]", "noise"],
  ["42 17", "noise"],
  ["how many sheets are there", "question"],
  ["explain this screen", "unclear"],
  ["क्या आप मुझे डार्क मोड चालू करना सिखा सकते हैं", "task"],
  ["kya aap mujhe pivot table banana sikha sakte ho", "task"],
  ["मुझे डार्क मोड चालू करना सीखना है", "task"],
  ["could you teach me how to make a chart", "task"],
  ["is this on", "greeting"],
  ["is it working", "greeting"],
  ["mic check one two", "greeting"],
];

describe("classify", () => {
  it.each(CASES)("%s -> %s", (said, intent) => {
    expect(classify(said)).toBe(intent);
  });

  it("during a Hode, 'is this on?' asks about the screen, while checks on Hodey's hearing stay greetings", () => {
    expect(classify("is this on", { inHode: true })).toBe("question");
    expect(classify("is it working", { inHode: true })).toBe("question");
    expect(classify("can you hear me", { inHode: true })).toBe("greeting");
    expect(classify("testing one two three", { inHode: true })).toBe("greeting");
    expect(classify("is the mic on", { inHode: true })).toBe("greeting");
  });

  it("calls a control a control when the router knows it", () => {
    expect(classify("give me a hint", { isCommand: (text) => text === "give me a hint" })).toBe("control");
  });

  it("asks the catalog whether an open request names an app, so 'open the insert tab' isn't one", () => {
    const isApp = (name: string) => name === "excel";
    expect(classify("open excel", { isApp })).toBe("open_app");
    expect(classify("open the insert tab", { isApp })).toBe("task");
  });
});

describe("isSubstantive", () => {
  it("is two or more real words, in any language", () => {
    for (const said of ["explain this screen", "tell me about this page", "new tab", "इस पेज के बारे में बताओ", "is page ke bare mein batao"]) {
      expect(isSubstantive(said), said).toBe(true);
    }
  });

  it("isn't a fragment, a filler phrase, thanks or a count", () => {
    for (const said of ["the tab", "let me think", "I don't know", "never mind", "the third one", "give me a minute", "sounds good", "yes please", "haan theek hai", "okay thank you", "one two three"]) {
      expect(isSubstantive(said), said).toBe(false);
    }
  });
});

describe("opensWithQuestion", () => {
  it("is a question word or helper verb first, not a request with one inside", () => {
    expect(opensWithQuestion("What is a pivot table?")).toBe(true);
    expect(opensWithQuestion("how many sheets are there")).toBe(true);
    expect(opensWithQuestion("how do I make a pivot table")).toBe(false);
    expect(opensWithQuestion("क्या आप मुझे डार्क मोड चालू करना सिखा सकते हैं")).toBe(false);
  });
});

describe("appQuery", () => {
  it("finds the app's name in English, Hinglish and Hindi requests", () => {
    expect(appQuery("Open WhatsApp, please.")).toBe("whatsapp");
    expect(appQuery("open the file explorer app")).toBe("file explorer");
    expect(appQuery("bring up my calculator")).toBe("calculator");
    expect(appQuery("excel kholo")).toBe("excel");
    expect(appQuery("whatsapp open karo")).toBe("whatsapp");
    expect(appQuery("एक्सेल खोलो")).toBe("एक्सेल");
    expect(appQuery("सेटिंग्स खोल दो")).toBe("सेटिंग्स");
  });

  it("isn't an app request when more follows the name", () => {
    expect(appQuery("open whatsapp and send a message")).toBeUndefined();
    expect(appQuery("open a new tab in brave")).toBeUndefined();
    expect(appQuery("how to open whatsapp")).toBeUndefined();
  });
});

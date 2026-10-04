import { describe, expect, it } from "vitest";
import { appQuery, asksAboutScreen, classify, withoutHodeysName, type Intent } from "./intent";

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
  ["pivot table kya hai", "question"],
  ["क्या डार्क मोड चालू है", "question"],
  ["dark mode kahan hai", "question"],
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

describe("asksAboutScreen", () => {
  it("is asking Hodey to explain, describe or tell, in English, Hinglish or Hindi", () => {
    const asks = [
      "explain this screen",
      "tell me about this page",
      "Can you describe what's on my screen?",
      "please summarize this page",
      "show me the insert tab",
      "इस पेज के बारे में बताओ",
      "is page ke bare mein batao",
      "ye samjhao",
      "mujhe batao na",
      "is screen ko explain karo",
    ];
    for (const said of asks) expect(asksAboutScreen(said), said).toBe(true);
  });

  it("is pointing at something on screen", () => {
    for (const said of ["this button", "that error", "anything wrong with this page", "इस बटन का मतलब", "ye button"]) {
      expect(asksAboutScreen(said), said).toBe(true);
    }
  });

  it("isn't thanks, a sign-off, a mic check, a remark to someone else or speech recognition's noise", () => {
    const chatter = [
      "shukriya hodey",
      "dhanyavaad hodey",
      "शुक्रिया होडी",
      "bahut badhiya",
      "that makes sense",
      "great job hodey",
      "bye hodey",
      "see you later",
      "can you hear me clearly",
      "hello can you hear me now",
      "mic testing one two three",
      "testing the mic",
      "meri awaaz aa rahi hai",
      "sunai de raha hai",
      "sorry I wasn't talking to you",
      "I was talking to someone else",
      "never mind forget it",
      "koi baat nahi",
      "Thank you for watching, see you next time",
      "subscribe to my channel",
      "We are okay we are going to put monster tricks out a little bit",
      "new tab",
      "I'll tell you later",
      "let me show you something",
    ];
    for (const said of chatter) expect(asksAboutScreen(said), said).toBe(false);
  });
});

describe("withoutHodeysName", () => {
  it("drops Hodey's name wherever it falls, as speech recognition writes it", () => {
    expect(withoutHodeysName("the classic one please Hodey")).toBe("the classic one please");
    expect(withoutHodeysName("the second one hodi")).toBe("the second one");
    expect(withoutHodeysName("दूसरा वाला होडी")).toBe("दूसरा वाला");
  });

  it("leaves words that only contain it", () => {
    expect(withoutHodeysName("nobody told me")).toBe("nobody told me");
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

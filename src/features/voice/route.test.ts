import { describe, expect, it } from "vitest";
import { initialState, type HodeState } from "../hode/model";
import { step } from "../hode/reducer";
import { PACK } from "../hode/test-fixtures";
import { TASK_PACKS } from "../../task-packs";
import type { InstalledApp } from "../../lib/types";
import catalog from "../apps/__fixtures__/start-apps.json";
import { routeUtterance, wakeRest } from "./route";

const APPS = catalog as InstalledApp[];
const routeApps = (s: HodeState, text: string, openAllowed = false) => routeUtterance(s, text, TASK_PACKS, openAllowed, [], APPS);

const guiding: HodeState = { ...initialState, phase: "guiding", pack: PACK };
const route = (s: HodeState, text: string, openAllowed = false) => routeUtterance(s, text, TASK_PACKS, openAllowed);
const types = (events: { type: string }[]) => events.map((e) => e.type);

describe("asking Hodey to look it up", () => {
  const asked: HodeState = { ...guiding, dialogue: [{ who: "learner", text: "how do I freeze the top row" }, { who: "hodey", text: "I'm not sure from here." }] };

  it("takes the question to the web when the learner says so", () => {
    expect(route(guiding, "search the web for how to pin a chat in WhatsApp")).toEqual([{ type: "VOICE_QUESTION", question: "how to pin a chat in whatsapp", lookUp: true }]);
    expect(route(initialState, "google how to make a pivot table")).toEqual([{ type: "VOICE_QUESTION", question: "how to make a pivot table", lookUp: true }]);
    expect(route(guiding, "look up how to sort by date")).toEqual([{ type: "VOICE_QUESTION", question: "how to sort by date", lookUp: true }]);
  });

  it("leaves emails, links, paths and file names out of the question it takes to the web", () => {
    expect(route(guiding, "look up how to email jane.doe@example.com from outlook")).toEqual([{ type: "VOICE_QUESTION", question: "how to email from outlook", lookUp: true }]);
    expect(route(guiding, "search the web for how to open Q3-salaries.xlsx in excel")).toEqual([{ type: "VOICE_QUESTION", question: "how to open in excel", lookUp: true }]);
    expect(route(guiding, String.raw`Google how to back up C:\Users\anshr\Documents or www.acme-intranet.com/payroll`)).toEqual([{ type: "VOICE_QUESTION", question: "how to back up or", lookUp: true }]);
  });

  it("looks up the question just asked when told to look it up", () => {
    expect(route(asked, "look it up")).toEqual([{ type: "VOICE_QUESTION", question: "how do I freeze the top row", lookUp: true }]);
    expect(route(asked, "can you google it please")).toEqual([{ type: "VOICE_QUESTION", question: "how do I freeze the top row", lookUp: true }]);
    expect(route({ ...asked, spokenQuestion: "where is the filter button" }, "search online")).toEqual([{ type: "VOICE_QUESTION", question: "where is the filter button", lookUp: true }]);
  });

  it("understands it in Hinglish and Hindi", () => {
    expect(route(guiding, "pivot table kaise banate hain google karo")).toEqual([{ type: "VOICE_QUESTION", question: "pivot table kaise banate hain", lookUp: true }]);
    expect(route(asked, "google karo")).toEqual([{ type: "VOICE_QUESTION", question: "how do I freeze the top row", lookUp: true }]);
    expect(route(asked, "गूगल करो")).toEqual([{ type: "VOICE_QUESTION", question: "how do I freeze the top row", lookUp: true }]);
  });

  it("leaves searching inside an app, and app names, alone", () => {
    expect(route(guiding, "search for a file named budget")).toEqual([{ type: "VOICE_QUESTION", question: "search for a file named budget" }]);
    expect(route(guiding, "look it up")).toEqual([{ type: "VOICE_QUESTION", question: "look it up" }]);
    expect(types(routeApps(initialState, "open google chrome", true))).not.toContain("VOICE_QUESTION");
  });
});

describe("pressing the mic and asking to be taught", () => {
  it("plans a Hode from a how-to request, as Start a Hode would", () => {
    expect(types(route(initialState, "how do I send a message on discord", true))).toEqual(["START_HODE", "GOAL_SUBMITTED"]);
    expect(types(route(initialState, "teach me to rename a file", true))).toEqual(["START_HODE", "GOAL_SUBMITTED"]);
    expect(types(route(initialState, "help me add a column in excel", true))).toEqual(["START_HODE", "GOAL_SUBMITTED"]);
    expect(types(route(initialState, "excel mein chart kaise banate hain", true))).toEqual(["START_HODE", "GOAL_SUBMITTED"]);
  });

  it("starts it while vision is still loading, so Hodey can say so", () => {
    const events = routeUtterance(initialState, "how do I send a message on discord", TASK_PACKS, false, [], [], true);
    expect(events).toMatchObject([{ type: "START_HODE" }, { type: "GOAL_SUBMITTED", openAllowed: false, visionStarting: true }]);
  });

  it("still answers a question about what's on screen", () => {
    expect(route(initialState, "What does this button do?")).toEqual([{ type: "VOICE_QUESTION", question: "What does this button do?" }]);
  });
});

describe("routeUtterance", () => {
  it("starts a Hode from a spoken goal when idle", () => {
    const events = route(initialState, "Hey Hodey, teach me how to make a pivot table in Excel");
    expect(types(events)).toEqual(["START_HODE", "GOAL_SUBMITTED"]);
    expect(events[1]).toMatchObject({ goal: "teach me how to make a pivot table in Excel", pack: { id: "excel-pivot" } });
  });

  it("treats an idle what/where question as a question about the screen", () => {
    expect(route(initialState, "What does this button do?")).toEqual([{ type: "VOICE_QUESTION", question: "What does this button do?" }]);
  });

  it("plans a Hode from a how-to request even when vision can't plan it yet: the Hode says why", () => {
    expect(route(initialState, "how do I write a poem")).toMatchObject([{ type: "START_HODE" }, { type: "GOAL_SUBMITTED", openAllowed: false }]);
    expect(types(route(initialState, "how do I write a poem", true))).toEqual(["START_HODE", "GOAL_SUBMITTED"]);
  });

  it("submits whatever is said during goal entry as the goal", () => {
    expect(route({ ...initialState, phase: "goal_entry" }, "zip these files")).toMatchObject([{ type: "GOAL_SUBMITTED", goal: "zip these files" }]);
  });

  it("maps spoken controls during a Hode, ignoring the wake word and politeness", () => {
    expect(route(guiding, "Hodey, give me a hint please")).toEqual([{ type: "HINT_REQUESTED" }]);
    expect(route(guiding, "say that again")).toEqual([{ type: "REPEAT" }]);
    expect(route(guiding, "I did it")).toEqual([{ type: "LOOK_AGAIN" }]);
    expect(route(guiding, "stop")).toEqual([{ type: "END_HODE" }]);
    expect(route({ ...guiding, phase: "paused" }, "continue")).toEqual([{ type: "RESUME" }]);
    expect(route({ ...guiding, phase: "answering" }, "got it, thanks")).toEqual([{ type: "DISMISS" }]);
  });

  it("switches mode and reveals the flow by voice", () => {
    expect(route(guiding, "agent mode")).toEqual([{ type: "SET_MODE", mode: "agent" }]);
    expect(route(guiding, "walk me through every step")).toEqual([{ type: "SET_MODE", mode: "agent" }]);
    expect(route(guiding, "switch to teach mode")).toEqual([{ type: "SET_MODE", mode: "teach" }]);
    expect(route(guiding, "help mode please")).toEqual([{ type: "SET_MODE", mode: "help" }]);
    expect(route(guiding, "Hodey, can you do it for me")).toEqual([{ type: "SET_AGENT_STYLE", style: "execute" }]);
    expect(route(guiding, "just guide me")).toEqual([{ type: "SET_AGENT_STYLE", style: "guide" }]);
    expect(route(guiding, "आप कर दो")).toEqual([{ type: "SET_AGENT_STYLE", style: "execute" }]);
    expect(route(guiding, "tum kar do")).toEqual([{ type: "SET_AGENT_STYLE", style: "execute" }]);
    expect(route(guiding, "show me all the steps")).toEqual([{ type: "SHOW_ALL_STEPS" }]);
  });

  it("hears 'where is it?' and 'I don't see it' as being stuck, in any language, not as a pause", () => {
    const stuck = [{ type: "SAID_STUCK" }];
    for (const said of ["where?", "Where is it?", "I don't see it", "I can't find it", "I can't see it anywhere", "where is that"]) {
      expect(route(guiding, said), said).toEqual(stuck);
    }
    for (const said of ["कहाँ है", "कहां है?", "नहीं दिख रहा", "मुझे दिख नहीं रहा", "नहीं मिल रहा है", "kahan hai", "dikh nahi raha", "mujhe nahi dikh raha", "kidhar hai"]) {
      expect(route(guiding, said), said).toEqual(stuck);
    }
    expect(route(guiding, "wait")).toEqual([{ type: "PAUSE" }]);
    expect(route(guiding, "hold on")).toEqual([{ type: "PAUSE" }]);
    expect(route(guiding, "where is the insert tab")).toEqual([{ type: "VOICE_QUESTION", question: "where is the insert tab" }]);
  });

  it("asks anything else as a question, mid-Hode", () => {
    expect(route(guiding, "where is the insert tab")).toEqual([{ type: "VOICE_QUESTION", question: "where is the insert tab" }]);
  });

  it("drops the wake word, including the ways speech recognition mishears it", () => {
    expect(route(guiding, "Hello body, give me a hint")).toEqual([{ type: "HINT_REQUESTED" }]);
    expect(route(guiding, "hey howdy repeat that")).toEqual([{ type: "REPEAT" }]);
    expect(route(guiding, "Hodie, stop")).toEqual([{ type: "END_HODE" }]);
  });

  it("drops the learner's own wake words too", () => {
    const routeWith = (text: string) => routeUtterance(guiding, text, TASK_PACKS, false, ["Hey Hodes", "Jarvis"]);
    expect(routeWith("hey hodes, give me a hint")).toEqual([{ type: "HINT_REQUESTED" }]);
    expect(routeWith("Jarvis repeat that")).toEqual([{ type: "REPEAT" }]);
    expect(routeWith("Hey Hodi stop")).toEqual([{ type: "END_HODE" }]);
  });

  it("hears the closing card's buttons read aloud, and 'skip step'", () => {
    const closing: HodeState = { ...initialState, phase: "success", pack: PACK };
    for (const said of ["practice on your own", "Practice on my own", "खुद प्रैक्टिस करो", "khud karke dekhta hoon", "practice karo"]) {
      expect(route(closing, said), said).toEqual([{ type: "PRACTICE_AGAIN" }]);
    }
    expect(route(guiding, "skip step")).toEqual([{ type: "SKIP_STEP" }]);
  });

  it("ignores silence and noise", () => {
    expect(route(guiding, "  ")).toEqual([]);
    expect(route(guiding, "um")).toEqual([]);
  });

  it("drops a lone word that isn't a control: keyboard clicks and noise come out as one", () => {
    expect(route(guiding, "yeah")).toEqual([]);
    expect(route(initialState, "the")).toEqual([]);
    expect(route(guiding, "hint")).toEqual([{ type: "HINT_REQUESTED" }]);
  });

  it("says nothing back to thanks or okay with no Hode running", () => {
    expect(route(initialState, "thanks", true)).toEqual([]);
    expect(route(initialState, "okay thank you", true)).toEqual([]);
    expect(route(initialState, "great", true)).toEqual([]);
  });

  it("takes thanks as Got it for an answer", () => {
    expect(route({ ...initialState, phase: "answering" }, "thanks")).toEqual([{ type: "DISMISS" }]);
    expect(route({ ...initialState, phase: "answering" }, "perfect thank you")).toEqual([{ type: "DISMISS" }]);
  });
});

describe("what the learner means", () => {
  it("never starts a Hode from noise, filler or a mishearing", () => {
    for (const said of ["Hello hello hello hello", "hello hello", "testing testing", "Fifteen sixteen seventeen", "thank you for watching", "yeah yeah", "um so"]) {
      expect(route(initialState, said, true), said).toEqual([]);
    }
  });

  it("greets back instead of starting a Hode", () => {
    for (const said of ["hi there", "how are you", "can you hear me", "good morning", "Hello, can you hear me", "Hello body, can you listen to", "namaste"]) {
      expect(route(initialState, said, true), said).toEqual([{ type: "CHITCHAT", kind: "greeting" }]);
    }
  });

  it("starts an open Hode only for a real task: anything else unclear is at most a question", () => {
    expect(route(initialState, "new tab", true)).toEqual([{ type: "VOICE_QUESTION", question: "new tab" }]);
    expect(types(route(initialState, "We are okay we are going to put monster tricks out a little bit", true))).toEqual(["VOICE_QUESTION"]);
    for (const said of ["how to send a pdf on whatsapp", "make a pivot table in excel", "add a chart", "zip these files"]) {
      expect(types(route(initialState, said, true)), said).toEqual(["START_HODE", "GOAL_SUBMITTED"]);
    }
  });

  it("asks about the screen for anything unclear with a few real words in it, as main did", () => {
    for (const said of ["explain this screen", "how many sheets are there", "tell me about this page", "इस पेज के बारे में बताओ"]) {
      expect(route(initialState, said), said).toEqual([{ type: "VOICE_QUESTION", question: said }]);
      expect(route(initialState, said, true), said).toEqual([{ type: "VOICE_QUESTION", question: said }]);
    }
  });

  it("still drops noise, a lone word, thanks and filler, and greets a mic check", () => {
    for (const said of ["um so", "the", "thanks a lot", "let me think", "never mind", "the third one"]) {
      expect(route(initialState, said, true), said).toEqual([]);
    }
    for (const said of ["can you hear me", "is this working", "is it on", "testing one two three"]) {
      expect(route(initialState, said, true), said).toEqual([{ type: "CHITCHAT", kind: "greeting" }]);
    }
  });

  it("during a Hode, 'is this on?' is a question about the screen, unless it names Hodey's hearing", () => {
    for (const said of ["is this on?", "Is it working?", "is this working"]) {
      expect(route(guiding, said), said).toEqual([{ type: "VOICE_QUESTION", question: said }]);
    }
    expect(route(guiding, "can you hear me")).toEqual([]);
    expect(route(guiding, "is the mic on")).toEqual([]);
    expect(route(initialState, "is the toggle on")).toEqual([{ type: "VOICE_QUESTION", question: "is the toggle on" }]);
  });

  it("starts a pack's lesson asked for in Hindi or Hinglish, question word and all", () => {
    const darkMode = [{ type: "START_HODE" }, { type: "GOAL_SUBMITTED", pack: { id: "windows-dark-mode" } }];
    for (const said of ["क्या आप मुझे डार्क मोड चालू करना सिखा सकते हैं", "kya aap mujhe dark mode chalu karna sikha sakte ho", "can you teach me to turn on dark mode"]) {
      expect(route(initialState, said), said).toMatchObject(darkMode);
    }
  });

  it("answers a question that opens with a question word, even about a pack's task", () => {
    expect(route(initialState, "what is a pivot table")).toEqual([{ type: "VOICE_QUESTION", question: "what is a pivot table" }]);
    expect(route(initialState, "is dark mode on")).toEqual([{ type: "VOICE_QUESTION", question: "is dark mode on" }]);
    expect(route(initialState, "ये बटन क्या करता है")).toEqual([{ type: "VOICE_QUESTION", question: "ये बटन क्या करता है" }]);
  });

  it("still starts a pack's lesson from its own words, verb or not", () => {
    expect(route(initialState, "pivot table")).toMatchObject([{ type: "START_HODE" }, { type: "GOAL_SUBMITTED", pack: { id: "excel-pivot" } }]);
  });

  it("drops noise and greetings during a Hode instead of asking them as questions", () => {
    expect(route(guiding, "hello hello")).toEqual([]);
    expect(route(guiding, "hi there")).toEqual([]);
    expect(route(guiding, "testing testing")).toEqual([]);
  });

  it("opens an installed app in any phase, even with vision not ready", () => {
    const excel = { type: "OPEN_APP", app: { name: "Excel" }, said: "Open Excel" };
    expect(routeApps(initialState, "Open Excel")).toMatchObject([excel]);
    expect(routeApps({ ...initialState, phase: "answering" }, "Open Excel")).toMatchObject([excel]);
    expect(routeApps(guiding, "Open Excel")).toMatchObject([excel]);
    expect(routeApps(initialState, "hey hodey open whatsapp please")).toMatchObject([{ type: "OPEN_APP", app: { name: "WhatsApp" } }]);
    expect(routeApps(initialState, "excel kholo")).toMatchObject([{ type: "OPEN_APP", app: { name: "Excel" } }]);
    expect(routeApps(initialState, "एक्सेल खोलो")).toMatchObject([{ type: "OPEN_APP", app: { name: "Excel" } }]);
    expect(routeApps({ ...initialState, phase: "goal_entry" }, "open settings")).toMatchObject([{ type: "OPEN_APP", app: { name: "Settings" } }]);
  });

  it("keeps 'open the insert tab' a question during a Hode, and controls still win", () => {
    expect(routeApps(guiding, "open the insert tab")).toEqual([{ type: "VOICE_QUESTION", question: "open the insert tab" }]);
    expect(routeApps(guiding, "go to teach mode")).toEqual([{ type: "SET_MODE", mode: "teach" }]);
    expect(routeApps(guiding, "show me")).toEqual([{ type: "SHOW_ME" }]);
  });

  it("asks which app when several fit, from idle", () => {
    expect(routeApps(initialState, "open outlook")).toMatchObject([{ type: "APP_OPEN_FAILED", reason: "ambiguous" }]);
  });

  it("opens the variant asked for by its whole name", () => {
    expect(routeApps(initialState, "open outlook classic")).toMatchObject([{ type: "OPEN_APP", app: { name: "Outlook (classic)" } }]);
  });

  it("names the installed app a spoken goal is about, from idle or goal entry", () => {
    expect(routeApps(initialState, "how do I send a message on Discord", true)).toMatchObject([{ type: "START_HODE" }, { type: "GOAL_SUBMITTED", app: "Discord" }]);
    expect(routeApps({ ...initialState, phase: "goal_entry" }, "Hey Hodey, how do I send a message on Discord")).toMatchObject([{ type: "GOAL_SUBMITTED", goal: "how do I send a message on Discord", app: "Discord" }]);
    expect(routeApps(initialState, "how do I turn on dark mode in discord", true)).toMatchObject([{ type: "START_HODE" }, { type: "GOAL_SUBMITTED", app: "Discord", pack: undefined }]);
  });

  it("without a catalog, an app request is an ordinary goal", () => {
    expect(types(route(initialState, "open excel", true))).toEqual(["START_HODE", "GOAL_SUBMITTED"]);
  });

  it("in goal entry, a greeting or something unclear gets a reply instead of becoming the goal", () => {
    const entry = { ...initialState, phase: "goal_entry" as const };
    expect(route(entry, "hi there")).toEqual([{ type: "CHITCHAT", kind: "greeting" }]);
    expect(route(entry, "new tab")).toEqual([{ type: "CHITCHAT", kind: "unclear" }]);
    expect(route(entry, "hello hello")).toEqual([]);
  });

  it("hears the measured mishearings of Hodey's name, but not 'hold it'", () => {
    expect(route(guiding, "Hey Holdy, give me a hint")).toEqual([{ type: "HINT_REQUESTED" }]);
    expect(route(guiding, "Heyhodi, give me a hint")).toEqual([{ type: "HINT_REQUESTED" }]);
    expect(route(guiding, "Hey Hudi give me a hint")).toEqual([{ type: "HINT_REQUESTED" }]);
    expect(route(guiding, "Hodee, repeat that")).toEqual([{ type: "REPEAT" }]);
    expect(route(guiding, "Holdie stop")).toEqual([{ type: "END_HODE" }]);
    expect(route(guiding, "hold it")).toEqual([{ type: "VOICE_QUESTION", question: "hold it" }]);
  });
});

describe("answering \"Did you mean Outlook or Outlook (classic)?\"", () => {
  const asked = routeApps(initialState, "open outlook").reduce((s, e) => step(s, e).state, initialState);
  const opened = (name: string) => [{ type: "OPEN_APP", app: { name } }];

  it("opens the one the learner names", () => {
    expect(routeApps(asked, "Outlook classic")).toMatchObject(opened("Outlook (classic)"));
    expect(routeApps(asked, "classic wala")).toMatchObject(opened("Outlook (classic)"));
    expect(routeApps(asked, "Outlook")).toMatchObject(opened("Outlook"));
  });

  it("opens the one the learner picks by place", () => {
    expect(routeApps(asked, "the second one")).toMatchObject(opened("Outlook (classic)"));
    expect(routeApps(asked, "the first")).toMatchObject(opened("Outlook"));
    expect(routeApps(asked, "doosra wala")).toMatchObject(opened("Outlook (classic)"));
    expect(routeApps(asked, "पहला वाला")).toMatchObject(opened("Outlook"));
  });

  it("leaves the question as it was when the reply picks neither", () => {
    for (const said of ["the third one", "thunderbird"]) {
      const events = routeApps(asked, said);
      expect(types(events), said).not.toContain("OPEN_APP");
      expect(events.reduce((s, e) => step(s, e).state, asked), said).toEqual(asked);
    }
  });
});

describe("wakeRest (hands-free)", () => {
  it("returns what follows Hodey's name", () => {
    expect(wakeRest("Hey Hodey, give me a hint.", [])).toBe("give me a hint.");
    expect(wakeRest("Hodey what's this button?", [])).toBe("what's this button?");
    expect(wakeRest("Okay Hodi.", [])).toBe("");
  });

  it("accepts the learner's own wake words", () => {
    expect(wakeRest("Hey Hodes, show me the steps", ["Hey Hodes"])).toBe("show me the steps");
  });

  it("ignores room speech that doesn't open with a wake word", () => {
    expect(wakeRest("I told somebody about Hodey yesterday", [])).toBeUndefined();
    expect(wakeRest("body temperature is normal", [])).toBeUndefined();
    expect(wakeRest("hey, what's up", [])).toBeUndefined();
  });

  it("hears the measured mishearings after a greeting, run together too", () => {
    expect(wakeRest("Hey Holdy, give me a hint.", [])).toBe("give me a hint.");
    expect(wakeRest("Heyhodi give me a hint", [])).toBe("give me a hint");
    expect(wakeRest("Hey Hudi, give me a hint", [])).toBe("give me a hint");
    expect(wakeRest("Hodee, give me a hint", [])).toBe("give me a hint");
    expect(wakeRest("hold it right there", [])).toBeUndefined();
    expect(wakeRest("Holdy give me a hint", [])).toBeUndefined();
  });

  it("hears Hodey's name in Hindi script", () => {
    expect(wakeRest("हे होडी, मदद करो", [])).toBe("मदद करो");
  });
});

import { COPY } from "./copy";
import type { ReplyLanguage } from "./language";
import type { MouseButton } from "./types";

/** Everything Hodey says that isn't from a task pack or the vision model, per language. */
export interface SpokenCopy {
  clarify: string;
  /** `clarify` for a Hode on the iPhone, where scrolling is the usual fix. */
  clarifyPhone: string;
  /** Said the moment the learner asks something, so there's no dead air while Hodey looks. */
  acks: readonly string[];
  switchToApp: (app: string) => string;
  /** `switchToApp` for a Hode on the iPhone: the mirror isn't showing yet. */
  connectPhone: string;
  needVisionToAnswer: string;
  itsHere: (name: string) => string;
  noPack: string;
  hodeCompleteSpeech: string;
  rememberedOnYourOwn: string;
  /** A step done unaided with a skill the learner picked up earlier in this same Hode. */
  gotTheHang: string;
  /** Teach mode's opening, after the pack's idea: who does the clicking. */
  youDoTheClicking: string;
  /** The learner said they did the step, but the screen doesn't show it. */
  cantSeeItDone: string;
  /** The closing question answered right, ahead of its explanation. */
  reviewRight: readonly string[];
  /** The closing question answered wrong: the right answer, kindly. */
  reviewWrong: (answer: string) => string;
  /** A spoken answer to the closing question that names none of the options. */
  pickAnAnswer: string;
  /** A practice round's opening. */
  practiceIntro: string;
  /** A practice round finished with no help at all. */
  didItAlone: string;
  /** Explain in an open-ended Hode, asked of the vision model as the learner's question. */
  whyThisStep: string;
  /** "How do I open Excel?": the launch any app shares, while Hodey waits for it to open. */
  howToOpen: (app: string) => string;
  /** The app the learner was learning to open is open. */
  openedIt: (app: string) => string;
  /** Said when the learner gets a step right (Teach, or Help once Hodey stepped in); varied so it doesn't sound canned. */
  stepDone: readonly string[];
  /** Agent mode's lighter acknowledgement of a step done right. */
  stepDoneLight: readonly string[];
  nothingMarked: string;
  thatsControl: (name: string, explain: string) => string;
  thatsElement: (name: string, role: string) => string;
  neededForThisStep: string;
  /** Stuck signals (PRD §7). Short and plain: Hodey points at the right control as it says them. */
  repeatedClick: (control: string) => string;
  menuLoop: (menu: string) => string;
  undoLoop: string;
  /** Said instead of guidance while an unexpected dialog is in the way. */
  surpriseDialog: (title: string) => string;
  targetMissing: (target: string) => string;
  /** Agent · Do it for me: said while Hodey is about to press a control, so the learner can stop it. */
  doing: (label: string, button: MouseButton) => string;
  /** Agent · Do it for me: Hodey finished `objective` and waits for the learner to check it. */
  checkpoint: (objective: string) => string;
  /** Hodey couldn't press this step's control safely; the learner does this one. */
  overToYou: string;
  /** Hodey did the last step; the learner checks the result. */
  hodeyFinished: string;
}

const ENGLISH: SpokenCopy = {
  clarify: COPY.clarify,
  clarifyPhone: COPY.clarifyPhone,
  acks: COPY.acks,
  switchToApp: COPY.switchToApp,
  connectPhone: COPY.connectPhone,
  needVisionToAnswer: COPY.needVisionToAnswer,
  itsHere: COPY.itsHere,
  noPack: COPY.noPack,
  hodeCompleteSpeech: COPY.hodeCompleteSpeech,
  rememberedOnYourOwn: COPY.rememberedOnYourOwn,
  gotTheHang: "You've got the hang of it.",
  youDoTheClicking: "You do the clicking; I'll help if you get stuck.",
  cantSeeItDone: "I can't see that done yet. If it is, you can skip this step.",
  reviewRight: ["That's it."],
  reviewWrong: (answer) => `Not quite: it's ${answer}.`,
  pickAnAnswer: "Tap one of the answers on the card, or say it.",
  practiceIntro: "Your turn to do it on your own. I'll stay quiet unless you get stuck.",
  didItAlone: "You did the whole thing on your own.",
  whyThisStep: "Why is this the next step?",
  howToOpen: (app) => `Press the Windows key, type ${app}, then press Enter. I'll pick up once ${app} is open.`,
  openedIt: (app) => `${app} is open. The Windows key, the app's name, then Enter: that opens any app on your PC.`,
  stepDone: ["Nice, that's it.", "Exactly right.", "Good, that's the one.", "Yes, well done."],
  stepDoneLight: ["Good.", "Done."],
  nothingMarked: COPY.nothingMarked,
  thatsControl: (name, explain) => `That's ${name}. ${explain}`,
  thatsElement: (name, role) => `That's the "${name}" ${role}.`,
  neededForThisStep: "It's the one you need for this step.",
  repeatedClick: (control) => `${control} isn't the one. Try the one I've highlighted.`,
  menuLoop: (menu) => `The ${menu} menu isn't the one we need. Try the one I've highlighted.`,
  undoLoop: "No problem. Let's take it one step at a time.",
  surpriseDialog: (title) => `"${title}" opened, and it isn't part of this step. Close it, then we'll carry on.`,
  targetMissing: (target) => `I can't see ${target} on the screen yet. Let's find it together.`,
  doing: (label, button) => (button === "right" ? `Right-clicking ${label}.` : `Clicking ${label}.`),
  checkpoint: (objective) => `Done: ${objective}. Take a look. Say continue when it looks right, or "let me try" to take over.`,
  overToYou: "I can't safely click this one myself, so it's your turn.",
  hodeyFinished: "All done. Check the result and make sure it's what you wanted.",
};

/** Gender-neutral on purpose: the learner picks a female or male Hindi voice. */
const HINDI: SpokenCopy = {
  clarify: "मुझे पक्का नहीं पता कि आपको कौन सा कंट्रोल चाहिए। जहाँ आप काम कर रहे हैं, पॉइंटर को उसके पास ले जाइए।",
  clarifyPhone: "मुझे अभी आपके आईफ़ोन पर वो नहीं दिख रहा। थोड़ा स्क्रॉल कीजिए, फिर हम दोबारा देखेंगे।",
  acks: ["एक सेकंड।", "ज़रा देखने दीजिए।", "हाँ, अभी देखते हैं।", "ठीक है, एक पल।"],
  connectPhone: "अपना आईफ़ोन जोड़िए: होडी के मेन्यू में Show iPhone खोलिए और मिररिंग शुरू कीजिए। फिर हम वहीं से आगे बढ़ेंगे।",
  switchToApp: (app) => `${app} खोलिए या उस पर जाइए, फिर हम वहीं से आगे बढ़ेंगे।`,
  needVisionToAnswer: "इसका जवाब लोकल विज़न मॉडल के बिना नहीं दिया जा सकता, और वो अभी तैयार नहीं है। पॉइंट एंड आस्क से उस जगह की तरफ़ इशारा करके देखिए।",
  itsHere: (name) => `ये ${name} है। मैंने इसे हाइलाइट कर दिया है।`,
  noPack: "इसके लिए अभी मेरे पास कोई होड नहीं है। “पिवट टेबल बनाओ” या “ये फ़ाइलें ज़िप करो” बोलकर देखिए।",
  hodeCompleteSpeech: "होड पूरा हुआ। बहुत बढ़िया।",
  rememberedOnYourOwn: "बढ़िया, ये आपको खुद याद था।",
  gotTheHang: "अब आपको ये आ गया है।",
  youDoTheClicking: "क्लिक आप करेंगे; अटकने पर मदद मिलेगी।",
  cantSeeItDone: "मुझे ये अभी हुआ हुआ नहीं दिख रहा। अगर हो गया है, तो ये स्टेप छोड़ सकते हैं।",
  reviewRight: ["बिल्कुल सही।"],
  reviewWrong: (answer) => `पूरी तरह नहीं: सही जवाब है ${answer}।`,
  pickAnAnswer: "कार्ड पर किसी एक जवाब पर टैप कीजिए, या उसे बोलिए।",
  practiceIntro: "अब आप खुद कीजिए। आप अटकें, तभी मदद मिलेगी।",
  didItAlone: "आपने पूरा काम खुद कर लिया।",
  whyThisStep: "ये अगला स्टेप क्यों है?",
  howToOpen: (app) => `विंडोज़ बटन दबाइए, ${app} टाइप कीजिए, फिर एंटर दबाइए। ${app} खुलते ही हम आगे बढ़ेंगे।`,
  openedIt: (app) => `${app} खुल गया। विंडोज़ बटन, ऐप का नाम, फिर एंटर: इसी से आपके कंप्यूटर का कोई भी ऐप खुल जाता है।`,
  stepDone: ["बढ़िया, यही था।", "बिल्कुल सही।", "हाँ, यही वाला।", "शाबाश, सही किया।"],
  stepDoneLight: ["ठीक है।", "हो गया।"],
  nothingMarked: "वहाँ अभी कोई कंट्रोल समझ नहीं आ रहा। किसी एक बटन के आसपास छोटा हिस्सा मार्क करके देखिए।",
  thatsControl: (name, explain) => `ये ${name} है। ${explain}`,
  thatsElement: (name, role) => `ये "${name}" ${role} है।`,
  neededForThisStep: "इस स्टेप के लिए आपको यही चाहिए।",
  repeatedClick: (control) => `${control} वो नहीं है। जो मैंने हाइलाइट किया है, उसे आज़माइए।`,
  menuLoop: (menu) => `${menu} मेन्यू वो नहीं है जो हमें चाहिए। जो मैंने हाइलाइट किया है, उसे आज़माइए।`,
  undoLoop: "कोई बात नहीं। चलिए, एक-एक कदम करके चलते हैं।",
  surpriseDialog: (title) => `"${title}" खुल गया है, जो इस स्टेप का हिस्सा नहीं है। उसे बंद कीजिए, फिर हम आगे बढ़ेंगे।`,
  targetMissing: (target) => `मुझे स्क्रीन पर अभी ${target} नहीं दिख रहा। चलिए, साथ में ढूँढते हैं।`,
  doing: (label, button) => (button === "right" ? `${label} पर राइट-क्लिक कर रहा हूँ।` : `${label} पर क्लिक कर रहा हूँ।`),
  checkpoint: (objective) => `हो गया: ${objective}। एक बार देख लीजिए। सही लगे तो "आगे बढ़ो" कहिए, या खुद करना हो तो "मुझे करने दो"।`,
  overToYou: "ये वाला मैं सुरक्षित तरीके से खुद क्लिक नहीं कर सकता, इसलिए अब आपकी बारी है।",
  hodeyFinished: "सब हो गया। नतीजा देख लीजिए कि यही आप चाहते थे।",
};

/** Hindi words in Devanagari, English words in English; the voice gets Devanagari via `speakable`. */
const HINGLISH: SpokenCopy = {
  clarify: "मुझे sure नहीं है कि आपको कौन सा control चाहिए। जहाँ आप काम कर रहे हैं, pointer को उसके पास ले जाइए।",
  clarifyPhone: "मुझे अभी आपके iPhone पर वो नहीं दिख रहा। थोड़ा scroll कीजिए, फिर हम दोबारा देखेंगे।",
  acks: ["एक second।", "ज़रा देखने दीजिए।", "हाँ, अभी देखते हैं।", "Okay, एक पल।"],
  connectPhone: "अपना iPhone connect कीजिए: Hodey के menu में Show iPhone खोलिए और mirroring start कीजिए। फिर हम वहीं से आगे बढ़ेंगे।",
  switchToApp: (app) => `${app} खोलिए या उस पर switch कीजिए, फिर हम वहीं से आगे बढ़ेंगे।`,
  needVisionToAnswer: "इसका answer local vision model के बिना नहीं दिया जा सकता, और वो अभी ready नहीं है। Point & Ask से उस जगह की तरफ़ point करके देखिए।",
  itsHere: (name) => `ये ${name} है। मैंने इसे highlight कर दिया है।`,
  noPack: "इसके लिए अभी मेरे पास कोई Hode नहीं है। “PivotTable बनाओ” या “ये files zip करो” बोलकर देखिए।",
  hodeCompleteSpeech: "Hode complete. बहुत बढ़िया।",
  rememberedOnYourOwn: "बढ़िया, ये आपको खुद याद था।",
  gotTheHang: "अब आपको ये आ गया।",
  youDoTheClicking: "Click आप करेंगे; अटके तो help मिलेगी।",
  cantSeeItDone: "मुझे ये अभी done नहीं दिख रहा। अगर हो गया है, तो ये step skip कर सकते हैं।",
  reviewRight: ["बिल्कुल सही।"],
  reviewWrong: (answer) => `पूरी तरह नहीं: सही answer है ${answer}।`,
  pickAnAnswer: "Card पर किसी एक answer पर tap कीजिए, या उसे बोलिए।",
  practiceIntro: "अब आप खुद कीजिए। अटकें, तभी help मिलेगी।",
  didItAlone: "आपने पूरा काम खुद कर लिया।",
  whyThisStep: "ये next step क्यों है?",
  howToOpen: (app) => `Windows button दबाइए, ${app} type कीजिए, फिर Enter दबाइए। ${app} खुलते ही हम आगे बढ़ेंगे।`,
  openedIt: (app) => `${app} खुल गया। Windows button, app का नाम, फिर Enter: इसी से आपके computer का कोई भी app खुल जाता है।`,
  stepDone: ["बढ़िया, यही था।", "Perfect, बिल्कुल सही।", "हाँ, यही वाला।", "Great, सही किया।"],
  stepDoneLight: ["Good।", "Done।"],
  nothingMarked: "वहाँ अभी कोई control समझ नहीं आ रहा। किसी एक button के आसपास छोटा area mark करके देखिए।",
  thatsControl: (name, explain) => `ये ${name} है। ${explain}`,
  thatsElement: (name, role) => `ये "${name}" ${role} है।`,
  neededForThisStep: "इस step के लिए आपको यही चाहिए।",
  repeatedClick: (control) => `${control} वो नहीं है। जो मैंने highlight किया है, उसे try कीजिए।`,
  menuLoop: (menu) => `${menu} menu वो नहीं है जो हमें चाहिए। जो मैंने highlight किया है, उसे try कीजिए।`,
  undoLoop: "कोई बात नहीं। चलिए, एक-एक step करके चलते हैं।",
  surpriseDialog: (title) => `"${title}" खुल गया है, जो इस step का हिस्सा नहीं है। उसे close कीजिए, फिर हम आगे बढ़ेंगे।`,
  targetMissing: (target) => `मुझे screen पर अभी ${target} नहीं दिख रहा। चलिए, साथ में ढूँढते हैं।`,
  doing: (label, button) => (button === "right" ? `${label} पर right-click कर रहा हूँ।` : `${label} पर click कर रहा हूँ।`),
  checkpoint: (objective) => `हो गया: ${objective}। एक बार check कर लीजिए। सही लगे तो "continue" कहिए, या खुद करना हो तो "मुझे करने दो"।`,
  overToYou: "ये वाला मैं safely खुद click नहीं कर सकता, इसलिए अब आपकी बारी है।",
  hodeyFinished: "सब हो गया। Result check कर लीजिए कि यही आप चाहते थे।",
};

const BY_LANGUAGE: Record<ReplyLanguage, SpokenCopy> = { en: ENGLISH, hi: HINDI, hinglish: HINGLISH };

export function spoken(language: ReplyLanguage = "en"): SpokenCopy {
  return BY_LANGUAGE[language];
}

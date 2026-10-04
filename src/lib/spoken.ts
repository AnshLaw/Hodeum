import { COPY } from "./copy";
import type { ReplyLanguage } from "./language";

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
  nothingMarked: string;
  thatsControl: (name: string, explain: string) => string;
  thatsElement: (name: string, role: string) => string;
  neededForThisStep: string;
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
  nothingMarked: COPY.nothingMarked,
  thatsControl: (name, explain) => `That's ${name}. ${explain}`,
  thatsElement: (name, role) => `That's the "${name}" ${role}.`,
  neededForThisStep: "It's the one you need for this step.",
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
  nothingMarked: "वहाँ अभी कोई कंट्रोल समझ नहीं आ रहा। किसी एक बटन के आसपास छोटा हिस्सा मार्क करके देखिए।",
  thatsControl: (name, explain) => `ये ${name} है। ${explain}`,
  thatsElement: (name, role) => `ये "${name}" ${role} है।`,
  neededForThisStep: "इस स्टेप के लिए आपको यही चाहिए।",
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
  nothingMarked: "वहाँ अभी कोई control समझ नहीं आ रहा। किसी एक button के आसपास छोटा area mark करके देखिए।",
  thatsControl: (name, explain) => `ये ${name} है। ${explain}`,
  thatsElement: (name, role) => `ये "${name}" ${role} है।`,
  neededForThisStep: "इस step के लिए आपको यही चाहिए।",
};

const BY_LANGUAGE: Record<ReplyLanguage, SpokenCopy> = { en: ENGLISH, hi: HINDI, hinglish: HINGLISH };

export function spoken(language: ReplyLanguage = "en"): SpokenCopy {
  return BY_LANGUAGE[language];
}

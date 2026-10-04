import { COPY } from "./copy";
import type { ReplyLanguage } from "./language";

/** Everything Hodey says that isn't from a task pack or the vision model, per language. */
export interface SpokenCopy {
  clarify: string;
  /** Said the moment the learner asks something, so there's no dead air while Hodey looks. */
  acks: readonly string[];
  switchToApp: (app: string) => string;
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
  acks: COPY.acks,
  switchToApp: COPY.switchToApp,
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
  acks: ["एक सेकंड।", "ज़रा देखने दीजिए।", "हाँ, अभी देखते हैं।", "ठीक है, एक पल।"],
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

export function spoken(language: ReplyLanguage = "en"): SpokenCopy {
  return language === "en" ? ENGLISH : HINDI;
}

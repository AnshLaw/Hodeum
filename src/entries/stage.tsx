import { Stage } from "../stage/Stage";
import { createStageEnvironment } from "../stage/environment";
import { DEFAULT_PREFS, seedPrefs } from "../features/dock/dock";
import { mount } from "./mount";

// The stage's top bar covers the auto-hide sliver, so rehearsals start with Hodey always shown.
try {
  seedPrefs(window.localStorage, { ...DEFAULT_PREFS, visibility: "pinned" });
} catch (error) {
  console.error("Local storage is unavailable; the practice stage keeps the default auto-hide", error);
}

// Created outside React so StrictMode's double render can't spawn a second runtime.
mount(<Stage env={createStageEnvironment()} />);

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ActivityState } from "../../lib/activity";
import { COPY } from "../../lib/copy";
import { TuckedOrb, type TuckedOrbProps } from "./TuckedOrb";

const QUIET: ActivityState = { screen: false, mic: false, cloud: false };
const render = (props: Partial<TuckedOrbProps> = {}) =>
  renderToStaticMarkup(createElement(TuckedOrb, { mood: "sleeping", activity: QUIET, paused: false, onReveal: () => undefined, ...props }));

describe("TuckedOrb", () => {
  it("is a button that says Hodey is still here, and how to open it", () => {
    const html = render();
    expect(html).toMatch(/^<button type="button" class="notch__orb notch__orb--tucked"/);
    expect(html).toContain(`aria-label="${COPY.tuckedOrb}"`);
  });

  it("shows Hodey asleep in it, or resting over a paused Hode", () => {
    expect(render()).toContain('class="hodey hodey--sleeping"');
    const paused = render({ mood: "resting", paused: true });
    expect(paused).toContain('class="hodey hodey--resting"');
    expect(paused).toContain(`aria-label="${COPY.tuckedOrbPaused}"`);
  });

  it("keeps the privacy dots on the orb, and says what they mean", () => {
    const html = render({ activity: { screen: false, mic: true, cloud: true } });
    expect(html).toContain('data-channel="mic"');
    expect(html).toContain('data-channel="cloud"');
    expect(html).not.toContain('data-channel="screen"');
    expect(html).toContain(`aria-label="${COPY.tuckedOrb}. ${COPY.privacyMic}. ${COPY.privacyCloud}"`);
  });

  it("shows no dots while nothing is in use", () => {
    expect(render()).not.toContain("privacy-dots");
  });
});

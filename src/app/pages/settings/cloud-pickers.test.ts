import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../../data/settings";
import { PracticeCloudCatalog, PracticeCloudKeys } from "../../../stage/practice-cloud-keys";
import { CLOUD_ROWS } from "./cloud-settings";
import { KeyLink, ProviderPickers } from "./CloudPickers";

const row = (provider: string) => CLOUD_ROWS.find((r) => r.provider === provider)!;
const catalog = new PracticeCloudCatalog(new PracticeCloudKeys());
const render = (provider: string, cloud = DEFAULT_SETTINGS.cloud) =>
  renderToStaticMarkup(createElement(ProviderPickers, { row: row(provider), cloud, catalog, present: false, reloadKey: undefined, onChange: () => undefined }));

describe("cloud pickers (first render, before any list loads)", () => {
  it("offers the current Gemini model, marked recommended, and asks for a key", () => {
    const html = render("gemini");
    expect(html).toContain('aria-label="Gemini model"');
    expect(html).toContain('<option value="gemini-3.5-flash-lite" selected="">Gemini 3.5 Flash-Lite (recommended)</option>');
    expect(html).toContain("Save a key to choose from every model");
  });

  it("gives ElevenLabs a model and a voice dropdown with a preview that needs a key", () => {
    const html = render("elevenlabs", { ...DEFAULT_SETTINGS.cloud, elevenlabsVoice: "JBFqnCBsd6RMkjVDRZzb" });
    expect(html).toContain('aria-label="Voice model"');
    expect(html).toContain('<option value="JBFqnCBsd6RMkjVDRZzb" selected="">JBFqnCBsd6RMkjVDRZzb</option>');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>▶ Preview<\/button>/);
  });

  it("has no picker for Backboard", () => {
    expect(render("backboard")).toBe("");
  });

  it("links to the official key page", () => {
    const html = renderToStaticMarkup(createElement(KeyLink, { row: row("backboard") }));
    expect(html).toContain('href="https://app.backboard.io"');
    expect(html).toContain("then Settings → API Keys");
  });
});

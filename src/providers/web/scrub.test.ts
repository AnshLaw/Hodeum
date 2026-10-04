import { describe, expect, it } from "vitest";
import { withoutAddresses } from "./scrub";

describe("withoutAddresses", () => {
  it("removes emails, links, file paths and file names, as src-tauri/src/web_search/scrub.rs does", () => {
    expect(withoutAddresses(String.raw`email anshr@example.com about C:\Users\anshr\Q3-salaries.xlsx see https://intranet/x pivot table`)).toBe("email about see pivot table");
  });

  it("finds each kind however it's written", () => {
    expect(withoutAddresses("how do I email jane.doe@example.com from Outlook?")).toBe("how do I email from Outlook?");
    expect(withoutAddresses("where do I paste www.acme-intranet.com/payroll in Brave?")).toBe("where do I paste in Brave?");
    expect(withoutAddresses("save it to C:/Reports/q3 then ~/notes and /home/jane/x")).toBe("save it to then and");
    expect(withoutAddresses(String.raw`map \\payroll-server\share as a drive`)).toBe("map as a drive");
    expect(withoutAddresses("open Q3-salaries.XLSX and scan_0001.PDF in Excel")).toBe("open and in Excel");
    expect(withoutAddresses("रिपोर्ट.xlsx कैसे खोलें")).toBe("कैसे खोलें");
  });

  it("keeps the words and numbers a how-to question needs", () => {
    const question = "How do I set line spacing to 1.5 and zoom to 150% in Word, e.g. with Ctrl+Shift+>?";
    expect(withoutAddresses(question)).toBe(question);
  });
});

import { describe, expect, it } from "vitest";
import { skillRecord } from "../hode/test-fixtures";
import type { SkillRecord } from "../../lib/types";
import { TASK_PACKS } from "../../task-packs";
import {
  areaTitle,
  buildSkillGraph,
  masteryChanges,
  changeText,
  masteryLabel,
  nextUp,
  orderSkills,
  prerequisiteEdges,
  skillArea,
  skillMastery,
  skillName,
  suggestedPacks,
} from "./graph";

const [excel, zip, iphone] = TASK_PACKS;

function mastered(skillId: string): SkillRecord {
  return { ...skillRecord("independent", skillId), status: "mastered" };
}

describe("skill names and areas", () => {
  it("groups by the id's first part and names the rest", () => {
    expect(skillArea("excel.pivot.create")).toBe("excel");
    expect(skillName("excel.navigation.insert_tab")).toBe("Navigation · Insert tab");
  });

  it("titles known areas and capitalises unknown ones", () => {
    expect(areaTitle("ios")).toBe("iPhone");
    expect(areaTitle("excel")).toBe("Excel");
    expect(areaTitle("photoshop")).toBe("Photoshop");
  });
});

describe("mastery", () => {
  it("labels untried, practised and mastered skills", () => {
    expect(masteryLabel(undefined)).toBe("New");
    expect(masteryLabel(skillRecord("hint"))).toBe("Learning");
    expect(masteryLabel(mastered("excel.pivot.create"))).toBe("Mastered");
  });

  it("measures progress from the help Hodey gives, zero when untried", () => {
    expect(skillMastery(undefined)).toBe(0);
    expect(skillMastery(skillRecord("demonstrate"))).toBeLessThan(skillMastery(skillRecord("hint")));
    expect(skillMastery(mastered("excel.pivot.create"))).toBe(1);
  });
});

describe("prerequisite edges", () => {
  it("links each pack step's skill to the next distinct one", () => {
    expect(prerequisiteEdges([excel])).toEqual([
      { from: "excel.navigation.insert_tab", to: "excel.pivot.create" },
      { from: "excel.pivot.create", to: "excel.pivot.fields" },
    ]);
  });

  it("never repeats an edge across packs", () => {
    expect(prerequisiteEdges([zip, zip])).toEqual([{ from: "windows.explorer.context_menu", to: "windows.explorer.compress" }]);
  });

  it("orders skills so prerequisites come first, keeping first-seen order otherwise", () => {
    const edges = [{ from: "a.x", to: "a.y" }];
    expect(orderSkills(["a.y", "a.z", "a.x"], edges)).toEqual(["a.z", "a.x", "a.y"]);
  });

  it("survives a cycle", () => {
    const edges = [
      { from: "a.x", to: "a.y" },
      { from: "a.y", to: "a.x" },
    ];
    expect(orderSkills(["a.x", "a.y"], edges).sort()).toEqual(["a.x", "a.y"]);
  });
});

describe("buildSkillGraph", () => {
  it("shows every pack skill, grouped by area, practised areas first", () => {
    const graph = buildSkillGraph([skillRecord("hint", "windows.explorer.compress")], TASK_PACKS);
    expect(graph.areas.map((a) => a.id)).toEqual(["windows", "excel", "ios"]);
    const windows = graph.areas[0];
    expect(windows.title).toBe("Windows");
    expect(windows.nodes.map((n) => [n.id, n.masteryLabel])).toEqual([
      ["windows.explorer.context_menu", "New"],
      ["windows.explorer.compress", "Learning"],
    ]);
  });

  it("marks a node linked when its prerequisite is the node before it", () => {
    const excelArea = buildSkillGraph([], [excel]).areas[0];
    expect(excelArea.nodes.map((n) => n.linked)).toEqual([false, true, true]);
  });

  it("keeps practised skills no pack knows, and counts mastered ones", () => {
    const graph = buildSkillGraph([mastered("general.copy_paste")], []);
    expect(graph.areas).toHaveLength(1);
    expect(graph.areas[0]).toMatchObject({ id: "general", title: "Anything else", mastered: 1 });
  });
});

describe("masteryChanges", () => {
  it("compares each practised skill before and after the Hode", () => {
    const before = [skillRecord("guide", "excel.pivot.create")];
    const after = [skillRecord("hint", "excel.pivot.create"), mastered("excel.pivot.fields")];
    const changes = masteryChanges(["excel.pivot.create", "excel.pivot.fields"], before, after);
    expect(changes.map((c) => [c.id, c.fromLabel, c.toLabel, c.newlyMastered])).toEqual([
      ["excel.pivot.create", "Learning", "Learning", false],
      ["excel.pivot.fields", "New", "Mastered", true],
    ]);
    expect(changes[0].to).toBeGreaterThan(changes[0].from);
    expect(changes[1].label).toBe("Pivot · Fields");
  });

  it("words each change: a new label, a move within one, or none", () => {
    const [moved, learned] = masteryChanges(["excel.pivot.create", "excel.pivot.fields"], [skillRecord("guide", "excel.pivot.create")], [skillRecord("hint", "excel.pivot.create"), skillRecord("guide", "excel.pivot.fields")]);
    expect(changeText(moved)).toBe("Learning ↑");
    expect(changeText(learned)).toBe("New → Learning");
    const [steady] = masteryChanges(["excel.pivot.create"], [skillRecord("hint", "excel.pivot.create")], []);
    expect(changeText(steady)).toBe("Learning");
  });

  it("holds a skill steady when its new progress isn't saved yet", () => {
    const before = [skillRecord("hint", "excel.pivot.create")];
    const [change] = masteryChanges(["excel.pivot.create"], before, []);
    expect(change.to).toBe(change.from);
  });
});

describe("suggestions", () => {
  it("suggests untried packs first and hides mastered ones", () => {
    const zipDone = zip.steps.map((s) => mastered(s.skill));
    expect(suggestedPacks([excel, zip], zipDone).map((p) => p.id)).toEqual([excel.id]);
    expect(suggestedPacks([excel, zip], []).map((p) => p.id)).toEqual([excel.id, zip.id]);
  });

  it("points to another Hode in the same area before switching apps", () => {
    const sameArea = { ...zip, id: "windows-other", title: "Rename files", steps: [{ ...zip.steps[0], skill: "windows.explorer.rename" }] };
    const next = nextUp([excel, iphone, zip, sameArea], zip.steps.map((s) => mastered(s.skill)), zip.id);
    expect(next).toMatchObject({ skillId: "windows.explorer.rename", label: "Explorer · Rename" });
    expect(next?.pack.id).toBe("windows-other");
  });

  it("names the first unmastered skill of the suggested Hode", () => {
    const next = nextUp([excel], [mastered("excel.navigation.insert_tab")], undefined);
    expect(next).toMatchObject({ skillId: "excel.pivot.create" });
  });

  it("suggests practising the same Hode again when nothing else is left", () => {
    expect(nextUp([excel], [skillRecord("guide", "excel.pivot.create")], excel.id)?.pack.id).toBe(excel.id);
  });

  it("has nothing to suggest once everything is mastered", () => {
    expect(nextUp([zip], zip.steps.map((s) => mastered(s.skill)), zip.id)).toBeUndefined();
  });
});

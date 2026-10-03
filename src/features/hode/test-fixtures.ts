import type {
  AssistanceLevel,
  LearnerAnnotation,
  Rect,
  ScreenObservation,
  SkillRecord,
  TaskPack,
  TeachingAction,
  UiElement,
} from "../../lib/types";

const TAB_SPACING = 50;

export function el(name: string, role: string, extra: Partial<UiElement> = {}): UiElement {
  return { id: `${role}:${name}`, name, role, bounds: { x: 0, y: 0, width: 40, height: 20 }, source: "mock", confidence: 0.95, ...extra };
}

export function tab(name: string, index: number, selected = false): UiElement {
  return el(name, "tab item", { bounds: { x: index * TAB_SPACING, y: 0, width: 40, height: 20 }, selected });
}

export function obs(elements: UiElement[]): ScreenObservation {
  return { app: "Excel", windowTitle: "Book1 - Excel", elements, at: 0 };
}

export const INSERT_BOUNDS: Rect = { x: TAB_SPACING, y: 0, width: 40, height: 20 };
export const HOME_SELECTED = obs([tab("Home", 0, true), tab("Insert", 1), tab("Data", 2)]);
export const DATA_SELECTED = obs([tab("Home", 0), tab("Insert", 1), tab("Data", 2, true)]);
export const INSERT_SELECTED = obs([
  tab("Home", 0),
  tab("Insert", 1, true),
  tab("Data", 2),
  el("PivotTable", "button", { bounds: { x: 0, y: 40, width: 60, height: 50 } }),
]);
export const FIELDS_VISIBLE = obs([el("PivotTable Fields", "pane", { bounds: { x: 300, y: 40, width: 200, height: 300 } })]);

export const PACK: TaskPack = {
  id: "test-pack",
  title: "Test",
  app: "Excel",
  goalPhrases: ["test"],
  prerequisites: ["Open the workbook."],
  steps: [
    {
      id: "open-insert",
      objective: "Open the Insert tab",
      skill: "excel.navigation.insert_tab",
      target: { names: ["Insert"], role: "tab item" },
      speech: { demonstrate: "Click Insert. I highlighted it.", guide: "Open Insert.", hint: "Which tab adds things?", observe: "", independent: "" },
      explain: "Insert adds things.",
      success: { kind: "element_selected", names: ["Insert"] },
      mistakes: [{ signal: { kind: "element_selected", names: ["Data"] }, correction: "You opened Data. Insert is further left." }],
    },
    {
      id: "click-pivot",
      objective: "Click PivotTable",
      skill: "excel.pivot.create",
      target: { names: ["PivotTable"], role: "button" },
      speech: { demonstrate: "Click PivotTable.", guide: "Click PivotTable.", hint: "Far left.", observe: "", independent: "" },
      explain: "Summarizes data.",
      success: { kind: "element_visible", names: ["PivotTable Fields"] },
      mistakes: [],
    },
  ],
};

export function skillRecord(level: AssistanceLevel, skillId = "excel.navigation.insert_tab"): SkillRecord {
  return {
    skill_id: skillId,
    status: "learning",
    confidence: 1,
    success_count: 1,
    failure_count: 0,
    last_assistance_level: level,
    last_seen_at: "2026-10-03T00:00:00.000Z",
  };
}

export function annotation(intent: LearnerAnnotation["intent"], bounds: Rect, question?: string): LearnerAnnotation {
  return { id: "a1", shape: { kind: "rect", bounds }, intent, question, createdAt: 0 };
}

export function guideAction(overrides: Partial<TeachingAction> = {}): TeachingAction {
  return {
    kind: "guide",
    speech: "Click Insert. I highlighted it.",
    target: { elementId: "tab item:Insert", bounds: INSERT_BOUNDS, confidence: 0.95, label: "Insert" },
    skill: "excel.navigation.insert_tab",
    assistanceLevel: "demonstrate",
    ...overrides,
  };
}

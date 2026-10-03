import excelPivot from "./excel-pivot.json";
import windowsZip from "./windows-zip.json";
import { loadTaskPack } from "./schema";

export const TASK_PACKS = [loadTaskPack(excelPivot), loadTaskPack(windowsZip)];
export { appFromGoal, matchGoal } from "./match";

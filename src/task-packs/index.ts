import excelPivot from "./excel-pivot.json";
import windowsZip from "./windows-zip.json";
import iphoneDarkMode from "./iphone-dark-mode.json";
import { loadTaskPack } from "./schema";

export const TASK_PACKS = [loadTaskPack(excelPivot), loadTaskPack(windowsZip), loadTaskPack(iphoneDarkMode)];
export { appFromGoal, matchGoal } from "./match";

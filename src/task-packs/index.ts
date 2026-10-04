import excelPivot from "./excel-pivot.json";
import windowsZip from "./windows-zip.json";
import iphoneDarkMode from "./iphone-dark-mode.json";
import iphoneLightMode from "./iphone-light-mode.json";
import windowsDarkMode from "./windows-dark-mode.json";
import windowsLightMode from "./windows-light-mode.json";
import notepadSaveNote from "./notepad-save-note.json";
import calculatorPercent from "./calculator-percent.json";
import { loadTaskPack } from "./schema";

// Order breaks ties between equally good matches: the iPhone lesson comes before the Windows ones.
export const TASK_PACKS = [excelPivot, windowsZip, iphoneDarkMode, iphoneLightMode, windowsDarkMode, windowsLightMode, notepadSaveNote, calculatorPercent].map(loadTaskPack);
export { appFromGoal, matchGoal } from "./match";

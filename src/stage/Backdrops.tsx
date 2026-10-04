import { Fragment } from "react";
import { EXCEL_LAYOUT, type ExcelScene } from "./scenes/excel";
import { EXPLORER_LAYOUT } from "./scenes/explorer";
import { PHONE_FRAME, type IphoneScene } from "./scenes/iphone";
import { rectStyle } from "./MockAppView";

const COLUMNS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const VISIBLE_ROWS = 18;
const PIVOT_COLUMN = 4;
const ROW_HEADER_WIDTH = 40;
const CELL = { width: 112, height: 24 };

function cellText(data: string[][], pivot: string[][] | undefined, row: number, column: number): string {
  if (column < PIVOT_COLUMN) return data[row]?.[column] ?? "";
  return pivot?.[row]?.[column - PIVOT_COLUMN] ?? "";
}

/** Static parts of the practice Excel window: ribbon band and a live sheet (data + pivot result). */
export function ExcelBackdrop({ scene }: { scene: ExcelScene }) {
  const { data, pivot } = scene.sheet();
  const grid = { gridTemplateColumns: `${ROW_HEADER_WIDTH}px repeat(${COLUMNS.length}, ${CELL.width}px)`, gridAutoRows: `${CELL.height}px` };
  return (
    <>
      <div className="excel-ribbon" style={rectStyle(EXCEL_LAYOUT.ribbon)} />
      <div className="excel-sheet" style={{ ...rectStyle(EXCEL_LAYOUT.sheet), ...grid }}>
        <div className="excel-sheet__head" />
        {COLUMNS.map((c) => (
          <div key={c} className="excel-sheet__head">
            {c}
          </div>
        ))}
        {Array.from({ length: VISIBLE_ROWS }, (_, row) => (
          <Fragment key={row}>
            <div className="excel-sheet__head">{row + 1}</div>
            {COLUMNS.map((c, column) => (
              <div key={c} className="excel-sheet__cell" data-header={row === 0 && cellText(data, pivot, row, column) !== "" ? "true" : undefined}>
                {cellText(data, pivot, row, column)}
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    </>
  );
}

const NAV_ITEMS = ["Home", "Desktop", "Documents", "Downloads", "Pictures"];
const LIST_COLUMNS = ["Name", "Date modified", "Type", "Size"];

export function ExplorerBackdrop() {
  const { commandBar, addressBar, nav, list, listHeaderHeight } = EXPLORER_LAYOUT;
  return (
    <>
      <div className="explorer-bar" style={rectStyle(commandBar)}>
        <span>New</span>
        <span>Cut</span>
        <span>Copy</span>
        <span>Sort</span>
        <span>View</span>
      </div>
      <div className="explorer-address" style={rectStyle(addressBar)}>
        <span>This PC › Documents › Q3 report</span>
      </div>
      <ul className="explorer-nav" style={rectStyle(nav)}>
        {NAV_ITEMS.map((item) => (
          <li key={item} data-current={item === "Documents" ? "true" : undefined}>
            {item}
          </li>
        ))}
      </ul>
      <div className="explorer-header" style={{ ...rectStyle({ ...list, height: listHeaderHeight }) }}>
        {LIST_COLUMNS.map((column) => (
          <span key={column}>{column}</span>
        ))}
      </div>
    </>
  );
}

/** The practice phone's body; the screen follows the scene's tone like real Dark Mode. */
export function IphoneBackdrop({ scene }: { scene: IphoneScene }) {
  return <div className="iphone-screen" data-tone={scene.snapshot().tone} style={rectStyle(PHONE_FRAME)} />;
}

/**
 * Everyday English words found in app names ("Photos", "Phone Link", "Teams", "Zoom", "To Do"). A goal that uses
 * them ("take photos", "zoom in", "how to do") isn't naming the app unless it says so ("in Photos"). Lowercase.
 * Not a dictionary: a word missing here makes a name count as a name wherever it appears.
 */
const GROUPS = [
  // Windows' own apps and tools.
  "mail calendar people photos photo camera clock alarms alarm maps map weather news money sports tips tip settings setting store",
  "paint terminal calculator media player music movies movie tv films film video videos phone link sticky notes note voice sound",
  "recorder quick assist feedback hub get help started start family game games bar casual collection solitaire power automate",
  "shell command prompt control panel task manager run character magnifier narrator keyboard screen remote desktop connection",
  "steps disk cleanup print management registry editor system information resource monitor performance services event viewer",
  "computer security backup health check update journal whiteboard scan fax recovery drive drives tools windows home dev live",
  "captions access accessibility mobile devices device wallet plans translator translate 3d app apps",
  // Office, Google and Apple apps known by a plain word.
  "office word teams team to do project publisher outlook edge code studio visual docs sheets slides forms keep meet chat",
  "messages message messenger contacts connect cast display books reader podcasts assistant lens play files file explorer",
  "folder documents pictures downloads gallery apple prime fit find flow sway lists planner bookings stream loop designer",
  "defender",
  // Other apps named with an everyday word.
  "zoom slack steam signal notion brave opera box line arc spark pro premiere illustrator express bridge animate audition",
  "notebook launcher browser workplace idle threads audible element session wire monday sketch dimension animator insomnia",
  "origin among us everything ditto calibre cursor console samples sample warp linear craft loom fork tower brackets rider",
  "fleet gateway toolbox hyper",
];

export const COMMON_WORDS: ReadonlySet<string> = new Set(GROUPS.flatMap((group) => group.split(" ")));

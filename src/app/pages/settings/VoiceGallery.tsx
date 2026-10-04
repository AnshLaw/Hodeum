import type { NaturalVoice } from "../../../providers/speech/native-voice";
import { NATURAL_PREFIX } from "../../../providers/speech/native-voice";

const PLAY_ICON = (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M4 2.5v9l7.5-4.5z" fill="currentColor" />
  </svg>
);

/** Kokoro's voices first under their own heading, Supertonic's after. */
function groups(voices: NaturalVoice[]): [string, NaturalVoice[]][] {
  const kokoro = voices.filter((v) => v.id.startsWith("kokoro:"));
  const others = voices.filter((v) => !v.id.startsWith("kokoro:"));
  return ([["Natural voices", kokoro], ["More voices (Supertonic)", others]] as [string, NaturalVoice[]][]).filter(([, list]) => list.length > 0);
}

interface GalleryProps {
  voices: NaturalVoice[];
  /** The saved setting: "" (Hodey's default, the first voice) or "hodey:<id>". */
  selected: string;
  onSelect: (name: string) => void;
  onPreview: (name: string) => void;
}

/** Every natural voice as a card: hear it with ▶, choose it by clicking the card. */
export function VoiceGallery({ voices, selected, onSelect, onPreview }: GalleryProps) {
  const isSelected = (voice: NaturalVoice) => selected === `${NATURAL_PREFIX}${voice.id}` || (selected === "" && voice.id === voices[0]?.id);
  return (
    <div className="hvoices">
      {groups(voices).map(([title, list], index) => (
        <details key={title} className="hvoices__group" open={index === 0 || list.some(isSelected)}>
          <summary className="hvoices__title">
            {title} · {list.length}
          </summary>
          <div className="hvoices__grid" role="radiogroup" aria-label={title}>
            {list.map((voice) => {
              const name = `${NATURAL_PREFIX}${voice.id}`;
              return (
                <div key={voice.id} className="hvoice-card" data-selected={isSelected(voice) || undefined}>
                  <button type="button" role="radio" aria-checked={isSelected(voice)} className="hvoice-card__pick" onClick={() => onSelect(name)}>
                    <strong>{voice.label}</strong>
                    <span className="hmuted">{voice.description}</span>
                  </button>
                  <button type="button" className="hvoice-card__play" aria-label={`Hear ${voice.label}`} title={`Hear ${voice.label}`} onClick={() => onPreview(name)}>
                    {PLAY_ICON}
                  </button>
                </div>
              );
            })}
          </div>
        </details>
      ))}
    </div>
  );
}

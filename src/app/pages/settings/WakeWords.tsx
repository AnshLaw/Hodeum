import { useState, type FormEvent } from "react";
import { MAX_WAKE_WORD, MAX_WAKE_WORDS } from "../../../data/settings";

/** Hodey's built-in name; always recognised (with common mishearings). */
const BUILT_IN = "Hey Hodey";

/** Extra names the learner calls Hodey, as removable chips plus an input to add more. */
export function WakeWords({ words, onChange }: { words: string[]; onChange: (words: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const full = words.length >= MAX_WAKE_WORDS;
  const add = (event: FormEvent) => {
    event.preventDefault();
    const word = draft.trim();
    if (!word || full || words.some((w) => w.toLowerCase() === word.toLowerCase())) return;
    onChange([...words, word]);
    setDraft("");
  };
  return (
    <div className="hwake">
      <ul className="hwake__list" aria-label="Wake words">
        <li className="hwake__chip" data-builtin>
          {BUILT_IN}
        </li>
        {words.map((word) => (
          <li key={word} className="hwake__chip">
            {word}
            <button type="button" className="hwake__remove" aria-label={`Remove ${word}`} onClick={() => onChange(words.filter((w) => w !== word))}>
              ×
            </button>
          </li>
        ))}
      </ul>
      <form className="hwake__add" onSubmit={add}>
        <input className="field" value={draft} maxLength={MAX_WAKE_WORD} onChange={(e) => setDraft(e.target.value)} placeholder={full ? "That's the maximum" : "Add one, e.g. Hey Hodes"} disabled={full} aria-label="New wake word" />
        <button type="submit" className="btn" disabled={full || draft.trim() === ""}>
          Add
        </button>
      </form>
    </div>
  );
}

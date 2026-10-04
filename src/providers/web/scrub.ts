/** A letter, mark, digit or underscore: what Rust's Unicode `\w` matches. */
const WORD_CHAR = String.raw`[\p{L}\p{M}\p{N}_]`;

/** The email, link, path and file-name rules of src-tauri/src/web_search/scrub.rs, in the same order. Keep them in step. */
const ADDRESSES: readonly RegExp[] = [
  /\S+@\S+/gu,
  /\b(?:https?:\/\/|www\.)\S+/giu,
  /(?:\b[a-z]:[\\/]|\\\\|~\/|\/(?:users|home)\/)[^\s"']*/giu,
  new RegExp(String.raw`[\p{L}\p{M}\p{N}_-]+\.(?:xlsx?|docx?|pptx?|pdf|csv|txt|png|jpe?g|zip)(?!${WORD_CHAR})`, "giu"),
];

/**
 * Removes emails, links, file paths and file names (the addresses of people, pages and files) from what the
 * learner said. They're found by their punctuation (@ . / \ :), so this runs before a web query is built from
 * the question's words, which drops it; Rust removes them again from every query. Numbers and the Windows
 * user name outlast the punctuation, and Rust removes those.
 */
export function withoutAddresses(text: string): string {
  return ADDRESSES.reduce((out, pattern) => out.replace(pattern, " "), text)
    .replace(/\s+/g, " ")
    .trim();
}

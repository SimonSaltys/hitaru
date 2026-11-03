const ANKI_CONNECT = "http://127.0.0.1:8765";
// Green in Anki's card counts: past learning, whether young or mature. Suspended cards aren't being kept up.
const GREEN_CARDS = "is:review -is:suspended";
const WORD_FIELDS = ["Word", "Expression", "Vocab", "Vocabulary"];
const READING_FIELDS = ["Word Reading", "Reading", "Kana"];

export interface AnkiWord {
  word: string;
  reading: string;
}

interface AnkiNote {
  fields: Record<string, { value: string }>;
}

async function ankiConnect<T>(action: string, params: unknown): Promise<T> {
  const response = await fetch(ANKI_CONNECT, {
    method: "POST",
    body: JSON.stringify({ action, version: 6, params }),
    signal: AbortSignal.timeout(10_000),
  });
  const { result, error } = (await response.json()) as { result: T; error: string | null };
  if (error) throw new Error(error);
  return result;
}

function field(note: AnkiNote, names: string[]): string {
  for (const name of names) {
    const value = note.fields[name]?.value;
    if (value) return value.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
  }
  return "";
}

/** Skips notes without a word field, since their front could be anything. */
export function wordsFromNotes(notes: AnkiNote[]): AnkiWord[] {
  return notes
    .map((note) => ({ word: field(note, WORD_FIELDS), reading: field(note, READING_FIELDS) }))
    .filter(({ word }) => word);
}

async function wordsMatching(query: string): Promise<AnkiWord[]> {
  const ids = await ankiConnect<number[]>("findNotes", { query });
  return wordsFromNotes(await ankiConnect<AnkiNote[]>("notesInfo", { notes: ids }));
}

/** Throws if Anki is closed or AnkiConnect isn't installed. */
export function greenWords(): Promise<AnkiWord[]> {
  return wordsMatching(GREEN_CARDS);
}

/** Every word with a card, however far along it is. */
export function allWords(): Promise<AnkiWord[]> {
  return wordsMatching("deck:*");
}

export interface NewNote {
  deckName: string;
  modelName: string;
  fields: Record<string, string>;
  tags: string[];
}

export function createDeck(deck: string): Promise<number> {
  return ankiConnect("createDeck", { deck });
}

/** False for a duplicate, which Anki judges by a note type's first field. */
export async function canAddNote(note: NewNote): Promise<boolean> {
  const [can] = await ankiConnect<boolean[]>("canAddNotes", { notes: [note] });
  return can === true;
}

export function addNote(note: NewNote): Promise<number> {
  return ankiConnect("addNote", { note });
}

export function storeMedia(filename: string, contents: Buffer): Promise<string> {
  return ankiConnect("storeMediaFile", { filename, data: contents.toString("base64") });
}

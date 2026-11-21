import type { Episode } from "../../bridge/library";

export interface Season {
  /** The folder's own name, or null when the show has only one folder. */
  label: string | null;
  episodes: Episode[];
}

export interface Show {
  name: string;
  seasons: Season[];
}

/** Groups the library by show, then by folder, keeping the server's order. */
export function groupShows(episodes: Episode[]): Show[] {
  const shows = new Map<string, Map<string, Episode[]>>();
  for (const e of episodes) {
    const folders = shows.get(e.show) ?? new Map<string, Episode[]>();
    folders.set(e.folder, [...(folders.get(e.folder) ?? []), e]);
    shows.set(e.show, folders);
  }
  return [...shows].map(([name, folders]) => ({
    name,
    seasons: [...folders].map(([folder, list]) => ({
      label: folders.size > 1 ? folder.split(/[\\/]/).pop() ?? folder : null,
      episodes: list,
    })),
  }));
}

/** A short number and a readable title from a release file name. */
export function episodeLabel(name: string, fallback: number): { number: string; title: string | null } {
  const match = /\bS\d+\s*E(\d+)\b/i.exec(name) ?? /\b(?:E|EP|Episode\s*)(\d+)\b/i.exec(name);
  const number = match ? String(Number(match[1])) : String(fallback);
  const dash = name.indexOf(" - ");
  const title = dash >= 0 ? name.slice(dash + 3).trim() || null : null;
  return { number, title };
}

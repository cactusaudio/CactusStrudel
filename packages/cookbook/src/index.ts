export interface SnippetEntry {
  id: string;
  genre: string;
  role: string;
  mini_notation?: string;
  raw?: string;
  tags: string[];
  bpm_range?: [number, number];
  notes?: string;
}

export async function loadCookbook(_genreSlug?: string): Promise<SnippetEntry[]> {
  return [];
}

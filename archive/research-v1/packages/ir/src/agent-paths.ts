export const AGENT_WRITE_PATHS: Record<string, string[]> = {
  'producer-brief-interpreter': ['/brief/'],
  'producer-reference-decomposer': ['/brief/references/', '/brief/modifiers/'],
  'producer-arranger': ['/song/', '/layers/', '/harmony/'],
  'producer-composer': ['/pattern_bank/'],
  'producer-sound-designer': ['/sound_palette/'],
  'producer-mix-engineer': ['/mix_graph/'],
  'producer-critic': ['/critique_graph/'],
  'producer-revision-planner': [],
};

export function isAgentAllowedToWrite(agent: string, pointer: string): boolean {
  const allowed = AGENT_WRITE_PATHS[agent];
  if (!allowed) return false;
  if (allowed.length === 0) return false;
  return allowed.some((prefix) => pointer.startsWith(prefix));
}

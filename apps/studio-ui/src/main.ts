// Cactus Studio — SessionGraph viewer.
// The UI is a read-only client of session bundles produced by the CLI.

interface SessionGraph {
  session_id: string;
  brief: { text: string; bpm?: number; primary_genre?: string };
  song: {
    total_bars: number;
    sections: Array<{ id: string; name: string; start_bar: number; end_bar: number; energy: number; function: string }>;
    energy_curve: number[];
  };
  layers: Array<{ id: string; role: string; orbit: number; description?: string }>;
  critique_graph: Array<{ scores: Record<string, number>; targets: unknown[]; notes?: string }>;
}

const sessionInput = document.getElementById('session-input') as HTMLInputElement;
const iterInput = document.getElementById('iter-input') as HTMLInputElement;
const loadButton = document.getElementById('load') as HTMLButtonElement;
const status = document.getElementById('status') as HTMLSpanElement;

loadButton.addEventListener('click', () => loadSession().catch((e) => setStatus(`error: ${(e as Error).message}`, true)));

async function loadSession(): Promise<void> {
  const id = sessionInput.value.trim();
  const iter = parseInt(iterInput.value, 10) || 0;
  if (!id) {
    setStatus('paste a session id', true);
    return;
  }
  const base = `/sessions/${id}/iter_${String(iter).padStart(4, '0')}`;
  setStatus('loading…');
  const graphResp = await fetch(`${base}.json`);
  if (!graphResp.ok) {
    setStatus(`graph not found at ${base}.json`, true);
    return;
  }
  const graph = (await graphResp.json()) as SessionGraph;
  renderGraph(graph);
  // Try audio.
  const audioPane = document.getElementById('audio-pane') as HTMLElement;
  const player = document.getElementById('player') as HTMLAudioElement;
  player.src = `${base}.wav`;
  audioPane.hidden = false;
  setStatus('loaded');
}

function renderGraph(graph: SessionGraph): void {
  // Brief
  const brief = document.getElementById('brief-pane') as HTMLElement;
  const briefText = document.getElementById('brief-text') as HTMLElement;
  briefText.textContent = JSON.stringify({
    text: graph.brief.text,
    bpm: graph.brief.bpm,
    primary_genre: graph.brief.primary_genre,
  }, null, 2);
  brief.hidden = false;

  // Song
  const songPane = document.getElementById('song-pane') as HTMLElement;
  const songGrid = document.getElementById('song-grid') as HTMLElement;
  songGrid.innerHTML = '';
  songGrid.className = 'song-grid';
  const total = graph.song.total_bars || 1;
  for (const sec of graph.song.sections) {
    const row = document.createElement('div');
    row.className = 'song-section';
    const widthPct = (((sec.end_bar - sec.start_bar) / total) * 100).toFixed(1);
    row.innerHTML = `<span style="width:${widthPct}%; min-width:80px;">${escapeHtml(sec.name)} <span class="muted">[${sec.start_bar}-${sec.end_bar}]</span></span><span class="bar" style="width:${(sec.energy * 100).toFixed(0)}px;"></span><span class="energy">e=${sec.energy.toFixed(2)} fn=${sec.function}</span>`;
    songGrid.appendChild(row);
  }
  songPane.hidden = false;

  // Layers
  const layersPane = document.getElementById('layers-pane') as HTMLElement;
  const layersList = document.getElementById('layers-list') as HTMLElement;
  layersList.innerHTML = '';
  for (const layer of graph.layers) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="role">${escapeHtml(layer.role)}</span><span>${escapeHtml(layer.id)}</span><span class="muted">orbit ${layer.orbit}</span>${layer.description ? `<span class="muted">${escapeHtml(layer.description)}</span>` : ''}`;
    layersList.appendChild(li);
  }
  layersPane.hidden = false;

  // Critique
  const critPane = document.getElementById('critique-pane') as HTMLElement;
  const critJson = document.getElementById('critique-json') as HTMLElement;
  if (graph.critique_graph.length > 0) {
    critJson.textContent = JSON.stringify(graph.critique_graph[graph.critique_graph.length - 1], null, 2);
    critPane.hidden = false;
  } else {
    critPane.hidden = true;
  }

  // Raw
  const raw = document.getElementById('raw-pane') as HTMLElement;
  const rawJson = document.getElementById('raw-json') as HTMLElement;
  rawJson.textContent = JSON.stringify(graph, null, 2);
  raw.hidden = false;
}

function setStatus(msg: string, error = false): void {
  status.textContent = msg;
  status.style.color = error ? 'var(--warn)' : 'var(--muted)';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

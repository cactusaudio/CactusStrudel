import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { audioEngine, type AudioSnapshot } from '../audio-engine';
import { appStore, useAppState } from '../store';
import { formatDuration, ProvenanceStrip } from './ui';

export function Transport(): JSX.Element {
  const app = useAppState();
  const [audio, setAudio] = useState<AudioSnapshot>(audioEngine.getSnapshot());
  useEffect(() => audioEngine.subscribe(() => setAudio(audioEngine.getSnapshot())), []);

  const compare = app.compare;
  const canCompare = Boolean(compare.a && compare.b);
  const selected = compare.selected === 'b' && compare.b ? compare.b : compare.a;
  const activeIsLoaded = selected
    && audio.revision?.id === selected.id
    && audio.revision?.audio_sha === selected.audio_sha;

  const choose = (side: 'a' | 'b') => {
    const revision = side === 'a' ? compare.a : compare.b;
    if (!revision) return;
    appStore.auditionSide(side, audioEngine.wantsPlayback());
  };

  const toggle = () => {
    if (!selected) return;
    if (!activeIsLoaded) audioEngine.load(selected, true);
    else audioEngine.toggle();
  };

  return (
    <footer class="transport">
      <div class="transport__piece">
        <div class="transport__cover">
          <span />
          <span />
          <span />
        </div>
        <div>
          <strong>{app.selectedPieceId ? appStore.selectedPiece()?.name : 'No piece selected'}</strong>
          {selected ? <ProvenanceStrip provenance={selected.provenance} /> : <small>Choose a piece to listen</small>}
        </div>
      </div>

      <div class="transport__core">
        <div class="transport__controls">
          <button
            class="icon-button icon-button--play"
            onClick={toggle}
            disabled={!selected}
            aria-label={activeIsLoaded && audio.desiredPlaying ? 'Pause' : 'Play'}
          >
            {activeIsLoaded && audio.desiredPlaying ? 'Ⅱ' : '▶'}
          </button>
          <span class="transport__time">{formatDuration(audio.currentTime)}</span>
          <input
            class="transport__seek"
            type="range"
            min="0"
            max={audio.duration || 1}
            step="0.01"
            value={Math.min(audio.currentTime, audio.duration || 0)}
            disabled={!selected}
            aria-label="Seek"
            onInput={(event) => audioEngine.seek(Number((event.currentTarget as HTMLInputElement).value))}
            style={{ '--seek': `${audio.duration > 0 ? (audio.currentTime / audio.duration) * 100 : 0}%` }}
          />
          <span class="transport__time">{formatDuration(audio.duration || selected?.duration_seconds)}</span>
        </div>
        {audio.error && <div class="transport__error">{audio.error}</div>}
      </div>

      <div class="transport__right">
        <div class={`compare-switch${canCompare ? '' : ' compare-switch--disabled'}`} aria-label="A B compare">
          <button class={compare.selected === 'a' ? 'active' : ''} onClick={() => choose('a')} disabled={!compare.a}>A</button>
          <button class={compare.selected === 'b' ? 'active' : ''} onClick={() => choose('b')} disabled={!compare.b}>B</button>
        </div>
        <span class="volume-glyph">◖</span>
        <input
          class="volume"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={audio.volume}
          aria-label="Volume"
          onInput={(event) => audioEngine.setVolume(Number((event.currentTarget as HTMLInputElement).value))}
        />
      </div>
    </footer>
  );
}

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Play, Pause, Volume2, VolumeX, Grid3x3, Activity, Upload, Trash2, MessageSquare, Check } from 'lucide-react';

// ============================================================
// THE PHRASE
// ============================================================
const WORDS = ['the', 'air', 'is', 'redolent', 'with', 'the', 'smell', 'of', 'garlic'];
const N = 9;

// Colours keyed by original bell number (1 = treble, 9 = tenor).
const BELL_COLORS = {
  1: '#B8860B',  // the (1st) — antique gold, treble
  2: '#3E6AA0',  // air — slate blue
  3: '#5E8A5A',  // is — moss
  4: '#C47536',  // redolent — amber
  5: '#7A5488',  // with — plum
  6: '#2F7D7A',  // the (2nd) — teal
  7: '#A03838',  // smell — brick red
  8: '#8A7045',  // of — umber
  9: '#5A1A24',  // garlic — wine, tenor
};

// G major peal, treble high to tenor low.
const BELL_FREQ = {
  1: 880.00, 2: 783.99, 3: 739.99, 4: 659.25, 5: 587.33,
  6: 523.25, 7: 493.88, 8: 440.00, 9: 392.00,
};

// ============================================================
// PLAIN HUNT CATERS
// ============================================================
function applyChange(row, notation) {
  const r = row.slice();
  if (notation === '9') {
    [r[0], r[1]] = [r[1], r[0]];
    [r[2], r[3]] = [r[3], r[2]];
    [r[4], r[5]] = [r[5], r[4]];
    [r[6], r[7]] = [r[7], r[6]];
  } else {
    [r[1], r[2]] = [r[2], r[1]];
    [r[3], r[4]] = [r[4], r[3]];
    [r[5], r[6]] = [r[6], r[5]];
    [r[7], r[8]] = [r[8], r[7]];
  }
  return r;
}

function buildSequence() {
  const rounds = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const seq = [rounds.slice()];
  const notations = [];
  let cur = rounds.slice();
  for (let i = 0; i < 18; i++) {
    const n = i % 2 === 0 ? '9' : '1';
    cur = applyChange(cur, n);
    seq.push(cur.slice());
    notations.push(n);
  }
  return { seq, notations };
}

// ============================================================
// COMPONENT
// ============================================================
export default function PlainHuntCaters() {
  const { seq, notations } = useMemo(() => buildSequence(), []);

  const [currentRow, setCurrentRow] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [bellInterval, setBellInterval] = useState(180);
  const [audioOn, setAudioOn] = useState(true);
  const [viewMode, setViewMode] = useState('grid');
  const [voiceMode, setVoiceMode] = useState(false);
  const [activeCol, setActiveCol] = useState(-1);
  const [recordings, setRecordings] = useState({});
  const [uploadError, setUploadError] = useState(null);
  const [showVoicePanel, setShowVoicePanel] = useState(false);

  const audioCtxRef = useRef(null);
  const timeoutsRef = useRef([]);
  const fileInputRefs = useRef({});

  const ensureAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtxRef.current = new Ctx();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  const playBellTone = useCallback((bellNum, when) => {
    const ctx = ensureAudioCtx();
    const freq = BELL_FREQ[bellNum];
    const t = when ?? ctx.currentTime;
    const duration = 0.9;

    const make = (mult, peak, decayMult) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq * mult;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.001, t + duration * decayMult);
      osc.connect(g).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + duration + 0.05);
    };
    make(1, 0.28, 1);
    make(2.4, 0.07, 0.6);
    make(2, 0.05, 0.5);
  }, [ensureAudioCtx]);

  const playVoiceSample = useCallback((bellNum, when) => {
    const rec = recordings[bellNum];
    if (!rec) return;
    const ctx = ensureAudioCtx();
    const src = ctx.createBufferSource();
    src.buffer = rec.buffer;
    src.connect(ctx.destination);
    src.start(when ?? ctx.currentTime);
  }, [recordings, ensureAudioCtx]);

  const handleFileUpload = async (bellNum, file) => {
    if (!file) return;
    setUploadError(null);
    try {
      const arrayBuf = await file.arrayBuffer();
      const ctx = ensureAudioCtx();
      const audioBuf = await ctx.decodeAudioData(arrayBuf);
      setRecordings((r) => ({
        ...r,
        [bellNum]: { buffer: audioBuf, filename: file.name }
      }));
    } catch (err) {
      console.error('decode failed', err);
      setUploadError(`Could not decode "${file.name}". Try .m4a, .mp3, .wav, or .webm.`);
    }
  };

  const clearRecording = (bellNum) => {
    setRecordings((r) => {
      const copy = { ...r };
      delete copy[bellNum];
      return copy;
    });
    if (fileInputRefs.current[bellNum]) {
      fileInputRefs.current[bellNum].value = '';
    }
  };

  const previewRecording = (bellNum) => {
    if (recordings[bellNum]) playVoiceSample(bellNum);
  };

  const allUploaded = WORDS.every((_, i) => recordings[i + 1]);

  const clearTimeouts = () => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
  };

  const playRow = useCallback((rowIdx) => {
    clearTimeouts();
    const row = seq[rowIdx];
    const ctx = audioOn ? ensureAudioCtx() : null;
    const baseTime = ctx ? ctx.currentTime + 0.01 : 0;

    row.forEach((bellNum, col) => {
      const delayMs = col * bellInterval;
      const tAudio = baseTime + delayMs / 1000;

      if (audioOn) {
        if (voiceMode && recordings[bellNum]) {
          playVoiceSample(bellNum, tAudio);
        } else {
          playBellTone(bellNum, tAudio);
        }
      }

      const to = setTimeout(() => setActiveCol(col), delayMs);
      timeoutsRef.current.push(to);
    });

    const endTo = setTimeout(() => setActiveCol(-1), row.length * bellInterval);
    timeoutsRef.current.push(endTo);
  }, [seq, audioOn, voiceMode, recordings, bellInterval, playBellTone, playVoiceSample, ensureAudioCtx]);

  useEffect(() => {
    if (!isPlaying) return;

    playRow(currentRow);

    const rowTime = N * bellInterval;
    const isBackstroke = currentRow % 2 === 1;
    const pauseAfter = isBackstroke ? bellInterval * 1.5 : 0;
    const nextDelay = rowTime + pauseAfter;

    const to = setTimeout(() => {
      if (currentRow < seq.length - 1) {
        setCurrentRow((r) => r + 1);
      } else {
        setIsPlaying(false);
      }
    }, nextDelay);
    timeoutsRef.current.push(to);

    return clearTimeouts;
  }, [isPlaying, currentRow, bellInterval, seq, playRow]);

  const handlePlayPause = () => {
    if (!isPlaying) {
      ensureAudioCtx();
      if (currentRow >= seq.length - 1) setCurrentRow(0);
      setIsPlaying(true);
    } else {
      setIsPlaying(false);
      clearTimeouts();
      setActiveCol(-1);
    }
  };

  const handleReset = () => {
    setIsPlaying(false);
    clearTimeouts();
    setCurrentRow(0);
    setActiveCol(-1);
  };

  const handleRowClick = (idx) => {
    setIsPlaying(false);
    clearTimeouts();
    setCurrentRow(idx);
    setActiveCol(-1);
    if (audioOn) playRow(idx);
  };

  useEffect(() => {
    const id = 'chrng-fonts';
    if (!document.getElementById(id)) {
      const link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      link.href =
        'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600&family=EB+Garamond:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap';
      document.head.appendChild(link);
    }
  }, []);

  return (
    <div
      style={{
        '--paper': '#f1e8d3',
        '--paper-2': '#ede2c8',
        '--ink': '#2a241e',
        '--ink-soft': '#5a4f42',
        '--rule': '#8a7e68',
        '--accent': '#8b1a1a',
        fontFamily: "'EB Garamond', Georgia, serif",
        background: 'var(--paper)',
        color: 'var(--ink)',
        minHeight: '100vh',
        padding: '2.5rem 1.5rem 4rem',
      }}
    >
      <style>{`
        .chrng-display { font-family: 'Cormorant Garamond', Georgia, serif; }
        .chrng-mono { font-family: 'JetBrains Mono', 'Courier New', monospace; }
        .chrng-btn {
          background: transparent; border: 1px solid var(--rule); color: var(--ink);
          padding: 0.5rem 0.9rem; font-family: inherit; font-size: 0.95rem;
          cursor: pointer; transition: all 0.15s ease; display: inline-flex;
          align-items: center; gap: 0.5rem; letter-spacing: 0.02em;
        }
        .chrng-btn:hover { background: var(--paper-2); border-color: var(--ink); }
        .chrng-btn.active { background: var(--ink); color: var(--paper); border-color: var(--ink); }
        .chrng-btn.accent { background: var(--accent); color: var(--paper); border-color: var(--accent); }
        .chrng-btn.accent:hover { background: #6e1414; border-color: #6e1414; }
        .chrng-row-cell {
          padding: 0.55rem 0.5rem; text-align: center; font-size: 1.05rem;
          transition: background-color 0.12s ease, transform 0.12s ease;
          border-bottom: 1px solid rgba(138, 126, 104, 0.15);
        }
        .chrng-row-highlighted { background: rgba(139, 26, 26, 0.07); }
        .chrng-col-struck { transform: scale(1.08); }
        .chrng-ornament {
          text-align: center; color: var(--rule); letter-spacing: 0.5em;
          margin: 1.2rem 0; font-size: 1.1rem;
        }
        input[type=range] { accent-color: var(--accent); }
        .chrng-upload-label {
          display: inline-flex; align-items: center; gap: 0.4rem;
          padding: 0.35rem 0.7rem; font-size: 0.85rem;
          background: transparent; border: 1px solid var(--rule);
          color: var(--ink); cursor: pointer; transition: all 0.15s ease;
          font-family: inherit;
        }
        .chrng-upload-label:hover { background: var(--paper-2); border-color: var(--ink); }
        .chrng-file-input { display: none; }
      `}</style>

      <header style={{ maxWidth: '72rem', margin: '0 auto 2rem', textAlign: 'center' }}>
        <div
          className="chrng-display"
          style={{
            fontSize: '0.85rem',
            letterSpacing: '0.4em',
            textTransform: 'uppercase',
            color: 'var(--ink-soft)',
            fontWeight: 500,
          }}
        >
          A permutation in nine voices
        </div>
        <h1
          className="chrng-display"
          style={{
            fontSize: 'clamp(1.75rem, 4vw, 2.75rem)',
            fontWeight: 400,
            fontStyle: 'italic',
            margin: '0.4rem 0 0.3rem',
            color: 'var(--accent)',
            letterSpacing: '-0.01em',
          }}
        >
          the air is redolent with the smell of garlic
        </h1>
        <div
          className="chrng-mono"
          style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', letterSpacing: '0.2em', marginTop: '0.5rem' }}
        >
          PLAIN HUNT CATERS · 18 CHANGES · G MAJOR
        </div>
        <div className="chrng-ornament">✦ ✦ ✦</div>
      </header>

      <div
        style={{
          maxWidth: '72rem',
          margin: '0 auto 2rem',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5rem',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <button className="chrng-btn accent" onClick={handlePlayPause}>
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
          {isPlaying ? 'Pause' : currentRow >= seq.length - 1 ? 'Replay' : 'Ring'}
        </button>

        <button className="chrng-btn" onClick={handleReset}>
          Reset
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: '0.5rem' }}>
          <span className="chrng-mono" style={{ fontSize: '0.75rem', color: 'var(--ink-soft)', letterSpacing: '0.1em' }}>
            TEMPO
          </span>
          <input
            type="range"
            min="90"
            max="400"
            step="10"
            value={500 - bellInterval}
            onChange={(e) => setBellInterval(500 - Number(e.target.value))}
            style={{ width: '120px' }}
          />
        </div>

        <button
          className={`chrng-btn ${audioOn ? 'active' : ''}`}
          onClick={() => setAudioOn((a) => !a)}
        >
          {audioOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
          Sound
        </button>

        <button
          className={`chrng-btn ${viewMode === 'grid' ? 'active' : ''}`}
          onClick={() => setViewMode('grid')}
        >
          <Grid3x3 size={16} />
          Grid
        </button>

        <button
          className={`chrng-btn ${viewMode === 'line' ? 'active' : ''}`}
          onClick={() => setViewMode('line')}
        >
          <Activity size={16} />
          Blue Lines
        </button>

        <button
          className={`chrng-btn ${showVoicePanel ? 'active' : ''}`}
          onClick={() => setShowVoicePanel((s) => !s)}
        >
          <Upload size={16} />
          Voice
        </button>

        {allUploaded && (
          <button
            className={`chrng-btn ${voiceMode ? 'active' : ''}`}
            onClick={() => setVoiceMode((v) => !v)}
          >
            <MessageSquare size={16} />
            {voiceMode ? 'Using your voice' : 'Play in your voice'}
          </button>
        )}
      </div>

      {showVoicePanel && (
        <div
          style={{
            maxWidth: '72rem',
            margin: '0 auto 2rem',
            padding: '1.5rem',
            background: 'var(--paper-2)',
            border: '1px solid var(--rule)',
            borderRadius: '2px',
          }}
        >
          <div
            className="chrng-display"
            style={{
              fontSize: '1.2rem',
              fontStyle: 'italic',
              marginBottom: '0.5rem',
              color: 'var(--accent)',
            }}
          >
            Upload the nine words in your own voice
          </div>
          <p
            style={{
              fontSize: '0.95rem',
              color: 'var(--ink-soft)',
              marginBottom: '1rem',
              lineHeight: 1.55,
            }}
          >
            Record each word as a separate short file — Voice Memos on the Mac or iPhone handles this cleanly: record, trim tightly, share to Files, upload here. One clean utterance per file, edges trimmed close. Any common format works: <span className="chrng-mono">.m4a</span>, <span className="chrng-mono">.mp3</span>, <span className="chrng-mono">.wav</span>, or <span className="chrng-mono">.webm</span>.
          </p>
          <p
            style={{
              fontSize: '0.9rem',
              color: 'var(--ink-soft)',
              marginBottom: '1.2rem',
              lineHeight: 1.55,
              fontStyle: 'italic',
            }}
          >
            Nothing leaves this page. Files are decoded in your browser and held in memory until you close the tab.
          </p>

          {uploadError && (
            <div
              style={{
                padding: '0.75rem 1rem',
                background: '#f8e0e0',
                border: '1px solid var(--accent)',
                color: 'var(--accent)',
                marginBottom: '1rem',
                fontSize: '0.9rem',
              }}
            >
              {uploadError}
            </div>
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '0.75rem',
            }}
          >
            {WORDS.map((word, i) => {
              const bellNum = i + 1;
              const color = BELL_COLORS[bellNum];
              const rec = recordings[bellNum];
              const inputId = `voice-upload-${bellNum}`;
              return (
                <div
                  key={i}
                  style={{
                    padding: '0.9rem',
                    background: 'var(--paper)',
                    border: `2px solid ${rec ? color : 'var(--rule)'}`,
                    borderRadius: '2px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                    }}
                  >
                    <div
                      className="chrng-display"
                      style={{
                        fontSize: '1.35rem',
                        color,
                        fontStyle: i === 0 || i === 5 ? 'italic' : 'normal',
                      }}
                    >
                      {word}
                      {(i === 0 || i === 5) && (
                        <span
                          className="chrng-mono"
                          style={{ fontSize: '0.65rem', marginLeft: '0.4rem', color: 'var(--ink-soft)', fontStyle: 'normal' }}
                        >
                          #{bellNum}
                        </span>
                      )}
                    </div>
                    {rec && <Check size={18} style={{ color }} />}
                  </div>

                  {rec && (
                    <div
                      className="chrng-mono"
                      style={{
                        fontSize: '0.7rem',
                        color: 'var(--ink-soft)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={rec.filename}
                    >
                      {rec.filename}
                    </div>
                  )}

                  <input
                    id={inputId}
                    ref={(el) => { fileInputRefs.current[bellNum] = el; }}
                    type="file"
                    accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg,.aac"
                    className="chrng-file-input"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload(bellNum, file);
                    }}
                  />

                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <label htmlFor={inputId} className="chrng-upload-label">
                      <Upload size={13} />
                      {rec ? 'Replace' : 'Upload'}
                    </label>
                    {rec && (
                      <>
                        <button
                          className="chrng-btn"
                          style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem' }}
                          onClick={() => previewRecording(bellNum)}
                          title="Preview"
                        >
                          <Play size={13} />
                        </button>
                        <button
                          className="chrng-btn"
                          style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem' }}
                          onClick={() => clearRecording(bellNum)}
                          title="Clear"
                        >
                          <Trash2 size={13} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {viewMode === 'grid' ? (
        <GridView
          seq={seq}
          notations={notations}
          currentRow={currentRow}
          activeCol={activeCol}
          onRowClick={handleRowClick}
        />
      ) : (
        <LineView seq={seq} currentRow={currentRow} />
      )}

      <footer
        style={{
          maxWidth: '72rem',
          margin: '3rem auto 0',
          paddingTop: '2rem',
          borderTop: '1px solid var(--rule)',
          fontSize: '0.85rem',
          color: 'var(--ink-soft)',
          lineHeight: 1.6,
          textAlign: 'center',
        }}
      >
        <p style={{ marginBottom: '0.5rem' }}>
          <em>Plain Hunt Caters</em>: nine bells, alternating place notations <span className="chrng-mono">9</span> and <span className="chrng-mono">1</span>,
          returning to rounds in <span className="chrng-mono">2n = 18</span> changes.
        </p>
        <p>
          Click any row to hear it. The two instances of <em>the</em> carry distinct colours so each can be tracked independently through the lattice.
        </p>
      </footer>
    </div>
  );
}

function GridView({ seq, notations, currentRow, activeCol, onRowClick }) {
  return (
    <div
      style={{
        maxWidth: '72rem',
        margin: '0 auto',
        background: 'var(--paper)',
        border: '1px solid var(--rule)',
        padding: '1.5rem 1rem',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '3rem repeat(9, 1fr) 2.5rem',
          alignItems: 'center',
          marginBottom: '0.4rem',
          paddingBottom: '0.4rem',
          borderBottom: '2px solid var(--ink)',
        }}
      >
        <div className="chrng-mono" style={{ fontSize: '0.7rem', color: 'var(--ink-soft)', letterSpacing: '0.1em' }}>
          ROW
        </div>
        {WORDS.map((w, i) => (
          <div
            key={i}
            className="chrng-display"
            style={{
              fontSize: '0.75rem',
              textAlign: 'center',
              color: 'var(--ink-soft)',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
            }}
          >
            {i + 1}
          </div>
        ))}
        <div className="chrng-mono" style={{ fontSize: '0.7rem', color: 'var(--ink-soft)', textAlign: 'right', letterSpacing: '0.1em' }}>
          P.N.
        </div>
      </div>

      {seq.map((row, rowIdx) => {
        const isCurrent = rowIdx === currentRow;
        const isPast = rowIdx < currentRow;
        const notation = rowIdx === 0 ? '—' : notations[rowIdx - 1];
        const isLast = rowIdx === seq.length - 1;
        return (
          <div
            key={rowIdx}
            className={isCurrent ? 'chrng-row-highlighted' : ''}
            style={{
              display: 'grid',
              gridTemplateColumns: '3rem repeat(9, 1fr) 2.5rem',
              alignItems: 'center',
              opacity: isPast ? 0.55 : 1,
              cursor: 'pointer',
              borderBottom: isLast ? '2px solid var(--ink)' : '1px solid rgba(138, 126, 104, 0.15)',
              fontWeight: rowIdx === 0 || isLast ? 600 : 400,
            }}
            onClick={() => onRowClick(rowIdx)}
          >
            <div
              className="chrng-mono"
              style={{
                fontSize: '0.8rem',
                color: isCurrent ? 'var(--accent)' : 'var(--ink-soft)',
                fontWeight: isCurrent ? 600 : 400,
              }}
            >
              {String(rowIdx).padStart(2, '0')}
            </div>
            {row.map((bellNum, col) => {
              const word = WORDS[bellNum - 1];
              const color = BELL_COLORS[bellNum];
              const isStruck = isCurrent && activeCol === col;
              return (
                <div
                  key={col}
                  className={`chrng-row-cell ${isStruck ? 'chrng-col-struck' : ''}`}
                  style={{
                    color,
                    fontStyle: bellNum === 1 || bellNum === 6 ? 'italic' : 'normal',
                    fontWeight: isStruck ? 700 : 500,
                    background: isStruck ? `${color}22` : 'transparent',
                  }}
                >
                  {word}
                </div>
              );
            })}
            <div
              className="chrng-mono"
              style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', textAlign: 'right' }}
            >
              {notation}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LineView({ seq, currentRow }) {
  const width = 900;
  const height = 640;
  const margin = { top: 60, right: 60, bottom: 40, left: 60 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const colX = (col) => margin.left + (col + 0.5) * (plotW / N);
  const rowY = (row) => margin.top + row * (plotH / (seq.length - 1));

  const paths = {};
  for (let bellNum = 1; bellNum <= N; bellNum++) {
    const points = [];
    seq.forEach((row, rowIdx) => {
      const col = row.indexOf(bellNum);
      points.push([colX(col), rowY(rowIdx)]);
    });
    paths[bellNum] = points;
  }

  const currentY = rowY(currentRow);

  return (
    <div
      style={{
        maxWidth: '72rem',
        margin: '0 auto',
        background: 'var(--paper)',
        border: '1px solid var(--rule)',
        padding: '1rem',
      }}
    >
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {WORDS.map((_, i) => (
          <line
            key={i}
            x1={colX(i)}
            x2={colX(i)}
            y1={margin.top - 20}
            y2={height - margin.bottom}
            stroke="var(--rule)"
            strokeOpacity="0.2"
            strokeDasharray="2 4"
          />
        ))}

        {WORDS.map((w, i) => (
          <text
            key={i}
            x={colX(i)}
            y={margin.top - 28}
            textAnchor="middle"
            fontFamily="'Cormorant Garamond', serif"
            fontSize="12"
            fill="var(--ink-soft)"
            letterSpacing="0.1em"
          >
            {i + 1}
          </text>
        ))}

        {seq.map((_, rowIdx) => (
          <text
            key={rowIdx}
            x={margin.left - 16}
            y={rowY(rowIdx) + 4}
            textAnchor="end"
            fontFamily="'JetBrains Mono', monospace"
            fontSize="9"
            fill={rowIdx === currentRow ? 'var(--accent)' : 'var(--ink-soft)'}
            fontWeight={rowIdx === currentRow ? 600 : 400}
          >
            {String(rowIdx).padStart(2, '0')}
          </text>
        ))}

        <line
          x1={margin.left - 10}
          x2={width - margin.right + 10}
          y1={currentY}
          y2={currentY}
          stroke="var(--accent)"
          strokeWidth="1"
          strokeOpacity="0.3"
        />

        {Object.entries(paths).map(([bellNum, pts]) => {
          const n = Number(bellNum);
          const color = BELL_COLORS[n];
          const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ');
          const isThe = n === 1 || n === 6;
          return (
            <g key={bellNum}>
              <path
                d={d}
                stroke={color}
                strokeWidth={isThe ? 2.5 : 1.75}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.85}
              />
              {pts.map(([x, y], i) => (
                <circle
                  key={i}
                  cx={x}
                  cy={y}
                  r={i === currentRow ? 5 : 2.5}
                  fill={color}
                  opacity={i === currentRow ? 1 : 0.7}
                />
              ))}
            </g>
          );
        })}

        {WORDS.map((w, i) => {
          const bellNum = i + 1;
          const color = BELL_COLORS[bellNum];
          return (
            <text
              key={i}
              x={colX(i)}
              y={height - margin.bottom + 22}
              textAnchor="middle"
              fontFamily="'EB Garamond', serif"
              fontSize="13"
              fontStyle={i === 0 || i === 5 ? 'italic' : 'normal'}
              fill={color}
              fontWeight={500}
            >
              {w}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react'

const BAR_COUNT = 72
/** Decoding needs the whole file in memory twice (bytes + PCM), so long files get a plain bar. */
const MAX_WAVEFORM_BYTES = 25 * 1024 * 1024

const peaksCache = new Map<string, number[] | null>()
let decodeContext: AudioContext | null = null

/** Only one chat player plays at a time. */
const PLAYING_EVENT = 'voidcast:chat-audio-play'

async function loadPeaks(src: string): Promise<number[] | null> {
  if (peaksCache.has(src)) return peaksCache.get(src) ?? null
  let peaks: number[] | null = null
  try {
    const res = await fetch(src)
    const len = Number(res.headers.get('content-length') || 0)
    if (res.ok && !(len > MAX_WAVEFORM_BYTES)) {
      const buf = await res.arrayBuffer()
      if (buf.byteLength <= MAX_WAVEFORM_BYTES) {
        decodeContext ??= new AudioContext()
        const audio = await decodeContext.decodeAudioData(buf)
        const data = audio.getChannelData(0)
        const step = Math.max(1, Math.floor(data.length / BAR_COUNT))
        const raw: number[] = []
        for (let b = 0; b < BAR_COUNT; b++) {
          let max = 0
          const end = Math.min(data.length, (b + 1) * step)
          for (let i = b * step; i < end; i += 16) {
            const v = Math.abs(data[i])
            if (v > max) max = v
          }
          raw.push(max)
        }
        const top = Math.max(...raw, 0.0001)
        peaks = raw.map((v) => Math.max(0.08, v / top))
      }
    }
  } catch {
    // Remote URLs without CORS and odd codecs end up here: the player still works without bars.
    peaks = null
  }
  peaksCache.set(src, peaks)
  return peaks
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export function ChatAudioPlayer({ src, title }: { src: string; title?: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [muted, setMuted] = useState(false)
  const [failed, setFailed] = useState(false)
  const [peaks, setPeaks] = useState<number[] | null>(() => peaksCache.get(src) ?? null)

  useEffect(() => {
    let alive = true
    setFailed(false)
    void loadPeaks(src).then((p) => {
      if (alive) setPeaks(p)
    })
    return () => {
      alive = false
    }
  }, [src])

  useEffect(() => {
    const onOtherPlay = (e: Event) => {
      if ((e as CustomEvent).detail !== audioRef.current) audioRef.current?.pause()
    }
    window.addEventListener(PLAYING_EVENT, onOtherPlay)
    return () => window.removeEventListener(PLAYING_EVENT, onOtherPlay)
  }, [])

  const toggle = useCallback(() => {
    const el = audioRef.current
    if (!el) return
    if (el.paused) void el.play().catch(() => setFailed(true))
    else el.pause()
  }, [])

  const seekTo = useCallback((clientX: number) => {
    const el = audioRef.current
    const track = trackRef.current
    if (!el || !track || !Number.isFinite(el.duration) || el.duration <= 0) return
    const rect = track.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    el.currentTime = ratio * el.duration
    setCurrent(el.currentTime)
  }, [])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    seekTo(e.clientX)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) seekTo(e.clientX)
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = audioRef.current
    if (!el || !Number.isFinite(el.duration)) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const delta = e.key === 'ArrowRight' ? 5 : -5
      el.currentTime = Math.min(el.duration, Math.max(0, el.currentTime + delta))
      setCurrent(el.currentTime)
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      toggle()
    }
  }

  const progress = duration > 0 ? Math.min(1, current / duration) : 0

  return (
    <div className={`chat-audio ${playing ? 'is-playing' : ''}`} title={title}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        muted={muted}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onPlay={(e) => {
          setPlaying(true)
          window.dispatchEvent(new CustomEvent(PLAYING_EVENT, { detail: e.currentTarget }))
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => setFailed(true)}
      />
      <button
        type="button"
        className="chat-audio-play"
        onClick={toggle}
        disabled={failed}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <rect x="3.5" y="2.5" width="3" height="11" rx="0.5" />
            <rect x="9.5" y="2.5" width="3" height="11" rx="0.5" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4.5 2.6v10.8a.5.5 0 0 0 .76.43l8.6-5.4a.5.5 0 0 0 0-.86l-8.6-5.4a.5.5 0 0 0-.76.43z" />
          </svg>
        )}
      </button>
      <div
        ref={trackRef}
        className="chat-audio-track"
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration) || 0}
        aria-valuenow={Math.round(current)}
        aria-valuetext={`${formatTime(current)} of ${formatTime(duration)}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
      >
        {peaks ? (
          <div className="chat-audio-wave">
            {peaks.map((p, i) => (
              <span
                key={i}
                className={(i + 0.5) / peaks.length <= progress ? 'is-played' : ''}
                style={{ height: `${Math.round(p * 100)}%` }}
              />
            ))}
          </div>
        ) : (
          <div className="chat-audio-bar">
            <span style={{ width: `${progress * 100}%` }} />
          </div>
        )}
      </div>
      <span className="chat-audio-time">
        {failed ? 'ERROR' : `${formatTime(current)} / ${formatTime(duration)}`}
      </span>
      <button
        type="button"
        className="chat-audio-mute"
        onClick={() => setMuted((v) => !v)}
        aria-label={muted ? 'Unmute' : 'Mute'}
        aria-pressed={muted}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" />
          {muted ? (
            <path d="M10.5 6l4 4m0-4l-4 4" fill="none" strokeWidth="1.4" strokeLinecap="round" />
          ) : (
            <path
              d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8M12.3 3.8a6 6 0 0 1 0 8.4"
              fill="none"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          )}
        </svg>
      </button>
    </div>
  )
}

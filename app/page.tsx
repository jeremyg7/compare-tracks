"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TrackCard } from "@/components/TrackCard";
import { analyzeLoudness } from "@/lib/audioAnalysis";
import { formatTime } from "@/lib/formatTime";

type TrackId = "A" | "B";

interface TrackState {
  id: TrackId;
  name: string | null;
  duration: number | null;
  sampleRate: number | null;
  size: number | null;
  loading: boolean;
  error: string | null;
  volume: number;
  hasBuffer: boolean;
  lufsIntegrated: number | null;
  peakDb: number | null;
}

const initialTrackState = (id: TrackId): TrackState => ({
  id,
  name: null,
  duration: null,
  sampleRate: null,
  size: null,
  loading: false,
  error: null,
  volume: 0.8,
  hasBuffer: false,
  lufsIntegrated: null,
  peakDb: null
});

const TRACK_KEYS: Record<TrackId, string> = {
  A: "KeyA",
  B: "KeyB"
};

const TRACK_LABEL: Record<TrackId, string> = {
  A: "Track A",
  B: "Track B"
};

export default function HomePage() {
  const [tracks, setTracks] = useState<Record<TrackId, TrackState>>({
    A: initialTrackState("A"),
    B: initialTrackState("B")
  });
  const [activeTrack, setActiveTrack] = useState<TrackId>("A");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const audioContextRef = useRef<AudioContext | null>(null);
  const buffersRef = useRef<Record<TrackId, AudioBuffer | null>>({
    A: null,
    B: null
  });
  const sourcesRef = useRef<Record<TrackId, AudioBufferSourceNode | null>>({
    A: null,
    B: null
  });
  const gainsRef = useRef<Record<TrackId, GainNode | null>>({
    A: null,
    B: null
  });
  const startTimeRef = useRef<number | null>(null);
  const pausedAtRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const playbackDurationRef = useRef<number>(0);

  const ensureAudioContext = useCallback(() => {
    if (typeof window === "undefined") return null;
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }

    return audioContextRef.current;
  }, []);

  const teardownNodes = useCallback(() => {
    (Object.keys(sourcesRef.current) as TrackId[]).forEach((id) => {
      const source = sourcesRef.current[id];
      if (source) {
        try {
          source.onended = null;
          source.stop();
        } catch (error) {
          console.warn("Source stop warning", error);
        }
        try {
          source.disconnect();
        } catch (error) {
          console.warn("Source disconnect warning", error);
        }
      }
      sourcesRef.current[id] = null;
    });

    (Object.keys(gainsRef.current) as TrackId[]).forEach((id) => {
      const gainNode = gainsRef.current[id];
      if (gainNode) {
        try {
          gainNode.disconnect();
        } catch (error) {
          console.warn("Gain disconnect warning", error);
        }
      }
      gainsRef.current[id] = null;
    });
  }, []);

  const stopPlayback = useCallback(
    (preserveOffset: boolean, durationOverride?: number) => {
      teardownNodes();
      const audioCtx = audioContextRef.current;
      const duration = durationOverride ?? playbackDurationRef.current;

      if (preserveOffset) {
        const elapsed = audioCtx && startTimeRef.current !== null
          ? audioCtx.currentTime - startTimeRef.current
          : pausedAtRef.current;
        const clamped = Math.max(0, Math.min(elapsed, duration || elapsed));
        pausedAtRef.current = clamped;
        setCurrentTime(clamped);
      } else {
        pausedAtRef.current = 0;
        setCurrentTime(0);
      }

      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }

      startTimeRef.current = null;
      setIsPlaying(false);
    },
    [teardownNodes]
  );

  const applyGain = useCallback(
    (trackId: TrackId, volume: number) => {
      const gainNode = gainsRef.current[trackId];
      const audioCtx = audioContextRef.current;
      if (!gainNode || !audioCtx) return;

      const target = trackId === activeTrack ? volume : 0;
      const now = audioCtx.currentTime;
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setTargetAtTime(target, now, 0.01);
    },
    [activeTrack]
  );

  const tick = useCallback(() => {
    const audioCtx = audioContextRef.current;
    if (!audioCtx || startTimeRef.current === null) return;

    const elapsed = audioCtx.currentTime - startTimeRef.current;
    const playbackDuration = playbackDurationRef.current;

    if (playbackDuration && elapsed >= playbackDuration) {
      setCurrentTime(playbackDuration);
      stopPlayback(false, playbackDuration);
      return;
    }

    setCurrentTime(elapsed);
    rafRef.current = requestAnimationFrame(tick);
  }, [stopPlayback]);

  const schedulePlayback = useCallback(
    async (offsetSeconds: number) => {
      const audioCtx = ensureAudioContext();
      if (!audioCtx) return;

      await audioCtx.resume();
      teardownNodes();

      const tracksWithBuffers = (Object.keys(buffersRef.current) as TrackId[]).filter(
        (id) => Boolean(buffersRef.current[id])
      );

      if (tracksWithBuffers.length === 0) {
        return;
      }

      tracksWithBuffers.forEach((trackId) => {
        const buffer = buffersRef.current[trackId];
        if (!buffer) return;

        const source = audioCtx.createBufferSource();
        const gainNode = audioCtx.createGain();

        source.buffer = buffer;
        source.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        const maxOffset = Math.max(0, buffer.duration - 0.005);
        const startOffset = Math.max(0, Math.min(offsetSeconds, maxOffset));

        gainNode.gain.value = trackId === activeTrack ? tracks[trackId].volume : 0;
        sourcesRef.current[trackId] = source;
        gainsRef.current[trackId] = gainNode;

        source.start(audioCtx.currentTime, startOffset);
      });

      startTimeRef.current = audioCtx.currentTime - offsetSeconds;
      pausedAtRef.current = 0;
      setCurrentTime(offsetSeconds);
      setIsPlaying(true);
      rafRef.current = requestAnimationFrame(tick);
    },
    [activeTrack, ensureAudioContext, teardownNodes, tick, tracks]
  );

  const handlePlayPause = useCallback(async () => {
    if (isPlaying) {
      stopPlayback(true);
      return;
    }

    const hasAudioLoaded = (Object.values(buffersRef.current) as (AudioBuffer | null)[]).some(
      (buffer) => Boolean(buffer)
    );

    if (!hasAudioLoaded) {
      return;
    }

    const offset = pausedAtRef.current || 0;
    await schedulePlayback(offset);
  }, [isPlaying, schedulePlayback, stopPlayback]);

  const handleSeek = useCallback(
    async (newTime: number) => {
      pausedAtRef.current = newTime;
      setCurrentTime(newTime);

      if (isPlaying) {
        await schedulePlayback(newTime);
      }
    },
    [isPlaying, schedulePlayback]
  );

  const handleFileSelect = useCallback(
    async (trackId: TrackId, file: File) => {
      setTracks((prev) => ({
        ...prev,
        [trackId]: {
          ...prev[trackId],
          loading: true,
          error: null
        }
      }));

      const audioCtx = ensureAudioContext();
      if (!audioCtx) return;

      try {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));

        buffersRef.current[trackId] = buffer;
        const { lufsIntegrated, peakDb } = analyzeLoudness(buffer);
        setTracks((prev) => ({
          ...prev,
          [trackId]: {
            ...prev[trackId],
            name: file.name,
            duration: buffer.duration,
            sampleRate: buffer.sampleRate,
            size: file.size,
            loading: false,
            error: null,
            hasBuffer: true,
            lufsIntegrated,
            peakDb
          }
        }));

        const duration = Math.max(buffer.duration, playbackDurationRef.current);
        playbackDurationRef.current = duration;

        stopPlayback(true, duration);
      } catch (error) {
        console.error("Failed to decode audio", error);
        buffersRef.current[trackId] = null;
        setTracks((prev) => ({
          ...prev,
          [trackId]: {
            ...prev[trackId],
            loading: false,
            error: "Unable to decode this audio file.",
            hasBuffer: false,
            lufsIntegrated: null,
            peakDb: null
          }
        }));
      }
    },
    [ensureAudioContext, stopPlayback]
  );

  const handleVolumeChange = useCallback(
    (trackId: TrackId, volume: number) => {
      setTracks((prev) => ({
        ...prev,
        [trackId]: {
          ...prev[trackId],
          volume
        }
      }));
      applyGain(trackId, volume);
    },
    [applyGain]
  );

  const toggleActiveTrack = useCallback(() => {
    setActiveTrack((prev) => (prev === "A" ? "B" : "A"));
  }, []);

  useEffect(() => {
    playbackDurationRef.current = Math.max(
      tracks.A.duration ?? 0,
      tracks.B.duration ?? 0
    );
  }, [tracks.A.duration, tracks.B.duration]);

  useEffect(() => {
    applyGain("A", tracks.A.volume);
    applyGain("B", tracks.B.volume);
  }, [activeTrack, applyGain, tracks.A.volume, tracks.B.volume]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;

      if (target) {
        if (target instanceof HTMLInputElement && target.type !== "range") {
          return;
        }

        if (target.tagName === "TEXTAREA") {
          return;
        }

        if (target.getAttribute("contenteditable") === "true") {
          return;
        }
      }

      if (event.code === "Space") {
        event.preventDefault();
        handlePlayPause();
        return;
      }

      if (event.code === TRACK_KEYS.A) {
        event.preventDefault();
        setActiveTrack("A");
        return;
      }

      if (event.code === TRACK_KEYS.B) {
        event.preventDefault();
        setActiveTrack("B");
        return;
      }

      if (event.code === "KeyT") {
        if (tracks.A.hasBuffer && tracks.B.hasBuffer) {
          event.preventDefault();
          toggleActiveTrack();
        }
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlePlayPause, toggleActiveTrack, tracks.A.hasBuffer, tracks.B.hasBuffer]);

  useEffect(() => {
    return () => {
      stopPlayback(false);
      audioContextRef.current?.close().catch((error) => {
        console.warn("AudioContext close warning", error);
      });
    };
  }, [stopPlayback]);

  const playbackDuration = useMemo(
    () => Math.max(tracks.A.duration ?? 0, tracks.B.duration ?? 0),
    [tracks.A.duration, tracks.B.duration]
  );

  const canPlay = useMemo(
    () => tracks.A.hasBuffer || tracks.B.hasBuffer,
    [tracks.A.hasBuffer, tracks.B.hasBuffer]
  );

  const canToggle = tracks.A.hasBuffer && tracks.B.hasBuffer;

  const formattedDuration = playbackDuration ? formatTime(playbackDuration) : "--:--";

  return (
    <main>
      <h1>Compare Tracks</h1>
      <p style={{ opacity: 0.75 }}>
        Load two tracks to perform synchronized A/B comparisons. Use <span className="keycap">Space</span> to play or pause,
        <span className="keycap">T</span> to toggle, and adjust levels independently to match volume.
      </p>

      <section className="track-grid">
        {(Object.keys(tracks) as TrackId[]).map((trackId) => {
          const track = tracks[trackId];
          return (
            <TrackCard
              key={track.id}
              track={track}
              isActive={activeTrack === trackId}
              onSetActive={() => setActiveTrack(trackId)}
              onFileSelect={(file) => handleFileSelect(trackId, file)}
              onVolumeChange={(volume) => handleVolumeChange(trackId, volume)}
            />
          );
        })}
      </section>

      <section className="transport" style={{ marginTop: "40px" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>Transport</h2>
          <div style={{ opacity: 0.8 }}>
            <strong>{TRACK_LABEL[activeTrack]}</strong> in focus
          </div>
        </header>

        <div style={{ marginTop: "16px" }}>
          <input
            type="range"
            min={0}
            max={playbackDuration || 1}
            step={0.01}
            value={Math.min(currentTime, playbackDuration || 0)}
            onChange={(event) => handleSeek(Number(event.target.value))}
            disabled={!playbackDuration}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem", opacity: 0.75 }}>
            <span>{formatTime(currentTime)}</span>
            <span>{formattedDuration}</span>
          </div>
        </div>

        <div className="transport-controls">
          <button type="button" onClick={handlePlayPause} disabled={!playbackDuration}>
            {isPlaying ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            onClick={toggleActiveTrack}
            disabled={!canToggle}
            className="transport-toggle"
          >
            Toggle Focus (T)
          </button>
          <button
            type="button"
            onClick={() => handleSeek(0)}
            disabled={!playbackDuration}
            className="transport-rewind"
          >
            Rewind
          </button>
        </div>

        <div className="shortcut-grid">
          <div>
            <span className="keycap">Space</span>
            Play / Pause
          </div>
          <div>
            <span className="keycap">A</span>
            Focus Track A
          </div>
          <div>
            <span className="keycap">B</span>
            Focus Track B
          </div>
          <div>
            <span className="keycap">T</span>
            Toggle focus
          </div>
        </div>
      </section>

      {!canPlay ? (
        <div className="empty-state">
          <p style={{ margin: 0 }}>Waiting for audio files. Drop in two versions to hear instant A/B switches.</p>
        </div>
      ) : null}

      <div style={{ marginTop: "48px", fontSize: "0.85rem", opacity: 0.7 }}>
        <p style={{ margin: 0 }}>
          Pro tip: keep filenames descriptive or toggle blind mode in a future update to avoid bias when comparing
          renders.
        </p>
      </div>
    </main>
  );
}

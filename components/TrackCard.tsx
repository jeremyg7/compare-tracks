"use client";

import { ChangeEvent, useId, useRef } from "react";
import { formatDb } from "@/lib/formatDb";
import { formatTime } from "@/lib/formatTime";

type TrackId = "A" | "B";

export interface TrackCardProps {
  track: {
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
  };
  isActive: boolean;
  matchOffset: number | null;
  onFileSelect: (file: File) => void;
  onSetActive: () => void;
  onVolumeChange: (volume: number) => void;
}

const LABELS: Record<TrackId, string> = {
  A: "Track A",
  B: "Track B"
};

export function TrackCard({
  track,
  isActive,
  matchOffset,
  onFileSelect,
  onSetActive,
  onVolumeChange
}: TrackCardProps) {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const setActiveDisabled = !track.hasBuffer || track.loading;
  const isLoading = track.loading;

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    onFileSelect(file);
    // reset input so selecting the same file again re-triggers change
    event.target.value = "";
  };

  const formattedSize = track.size
    ? `${(track.size / (1024 * 1024)).toFixed(2)} MB`
    : "--";
  const formattedLufs = track.lufsIntegrated === null ? "--" : `${track.lufsIntegrated.toFixed(1)} LUFS`;
  const formattedPeak = formatDb(track.peakDb, "dBFS");
  const formattedMatch = matchOffset === null
    ? "Not matched"
    : matchOffset > 0
      ? `-${matchOffset.toFixed(1)} dB`
      : "0.0 dB";

  return (
    <article className={`track-card${isActive ? " active" : ""}`}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>{LABELS[track.id]}</h3>
        {track.hasBuffer ? (
          <span className="status-badge">{isActive ? "Active" : "Standby"}</span>
        ) : null}
      </header>

      {track.hasBuffer ? (
        <div style={{ marginTop: "16px" }}>
          <p className="filename">{track.name}</p>
          <div className="track-meta">
            <span>Duration</span>
            <span>{formatTime(track.duration)}</span>
            <span>Sample Rate</span>
            <span>
              {track.sampleRate ? `${Math.round(track.sampleRate)} Hz` : "--"}
            </span>
            <span>File Size</span>
            <span>{formattedSize}</span>
            <span>LUFS-I</span>
            <span>{formattedLufs}</span>
            <span>Peak</span>
            <span>{formattedPeak}</span>
            <span>Loudness Match</span>
            <span>{formattedMatch}</span>
          </div>
        </div>
      ) : (
        <label className="upload-zone" htmlFor={inputId}>
          <div>
            <strong>Load audio file</strong>
            <p style={{ margin: "8px 0 0", opacity: 0.75 }}>
              Drag & drop or click to browse (WAV, AIFF, FLAC, MP3)
            </p>
          </div>
        </label>
      )}

      {track.error ? (
        <p style={{ color: "#fca5a5", marginTop: "12px" }}>{track.error}</p>
      ) : null}

      <div className="track-actions">
        <button
          type="button"
          onClick={onSetActive}
          disabled={setActiveDisabled}
          style={{
            flex: "0 0 auto",
            padding: "10px 16px",
            borderRadius: "999px",
            background: isActive ? "rgba(34, 211, 238, 0.2)" : "rgba(148, 163, 184, 0.15)",
            border: "1px solid rgba(148, 163, 184, 0.4)",
            color: isActive ? "#22d3ee" : "#e2e8f0",
            cursor: setActiveDisabled ? "not-allowed" : "pointer",
            opacity: setActiveDisabled ? 0.6 : 1,
            transition: "all 0.2s ease"
          }}
        >
          {isActive ? "Currently A/B focus" : "Set as active"}
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoading}
          style={{
            flex: "0 0 auto",
            padding: "10px 16px",
            borderRadius: "999px",
            background: "rgba(59, 130, 246, 0.2)",
            border: "1px solid rgba(59, 130, 246, 0.45)",
            color: "#bfdbfe",
            cursor: isLoading ? "wait" : "pointer",
            opacity: isLoading ? 0.7 : 1,
            transition: "all 0.2s ease"
          }}
        >
          Load
        </button>
      </div>

      <div className="volume-control" style={{ marginTop: "18px" }}>
        <label htmlFor={`${inputId}-volume`}>Level</label>
        <input
          id={`${inputId}-volume`}
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={track.volume}
          onChange={(event) => onVolumeChange(Number(event.target.value))}
        />
        <output>
          {(track.volume * 100).toFixed(0)}% gain
        </output>
      </div>

      <input
        id={inputId}
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      {track.loading ? (
        <p style={{ marginTop: "12px", opacity: 0.75 }}>Decoding & analyzing loudness…</p>
      ) : null}
    </article>
  );
}

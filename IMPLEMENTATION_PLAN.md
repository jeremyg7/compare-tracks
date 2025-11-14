# Incremental Implementation Plan

This document breaks down the upcoming revisions/features into discrete deliverables. After each deliverable ships, push to GitHub so Vercel can redeploy and you can verify before moving forward.

## 0. Baseline Checklist (before any work)
- [ ] `pnpm install` / `npm install` completed locally
- [ ] `npm run dev` confirms current app works
- [ ] Create a lightweight fixture folder (e.g., `debug/fixtures`) with two test files used in verification steps below

---

## 1. Accurate ITU-R BS.1770 K-Weighting
**Goal**: Align LUFS calculations with the industry-standard high-pass (60 Hz) + high-shelf (1 kHz, +4 dB) filters to produce trustworthy loudness numbers.

**Implementation Steps**
1. Update `lib/audioAnalysis.ts` to use the correct high-pass and high-shelf parameters or import baked filter coefficients for the full BS.1770 filter cascade.
2. Add in-code documentation referencing BS.1770 so future tweaks remain consistent.
3. (Optional) Unit-test `toLUFS` + filter pipeline with a known sine sweep fixture once test harness exists.

**Verification**
- Run `npm run dev`, load a reference track with known LUFS from another meter (Youlean, iZotope, etc.).
- Confirm LUFS readout in the UI matches the trusted meter within ±0.2 dB.
- Capture before/after screenshots for regression notes.

---

## 2. Non-Blocking Loudness Analysis
**Goal**: Prevent large files from freezing the UI by moving per-sample loudness work off the main thread.

**Implementation Steps**
1. Introduce a Web Worker or AudioWorklet (e.g., `workers/loudnessWorker.ts`) that receives channel data and returns metrics.
2. Refactor `analyzeLoudness` to delegate heavy loops to the worker via `postMessage`.
3. Show a spinner/"Analyzing…" indicator while awaiting worker response; handle worker errors gracefully.

**Verification**
- With DevTools performance tab open, drop a >5-minute 96 kHz file.
- Confirm main thread remains responsive (<10% blocked) and the UI still updates progress/ready states.
- Ensure repeated loads do not leak workers (watch memory graph or console logs).

---

## 3. Loudness-Match UX & dB Readout
**Goal**: Make the match button deterministic: the quieter track defines the target, the louder track gets an explicit trim, and users get separate controls for overall monitoring level vs. fine per-track offsets.

**Implementation Steps**
1. Introduce two layers of gain:
   - `globalVolume`: a single slider (0–100%, defaults to 100%) that scales both tracks equally for monitoring comfort.
   - `perTrackTrimDb`: a per-track fine-tune slider (e.g., ±6 dB range, shown in dB) that lets users bias A vs. B after matching.
2. When the user clicks Match:
   - Compute LUFS deltas exactly once, set each track’s `autoTrimDb` so louder tracks are reduced to the quietest LUFS (capped at 12 dB reduction).
   - Reset `perTrackTrimDb` to 0 so the manual fine sliders always start from the matched baseline.
3. Effective gain per track becomes `globalVolume * offsetToGain(autoTrimDb + perTrackTrimDb)`. Because `autoTrimDb` never boosts, quieter tracks can’t clip; manual fine trims are clamped so users can’t exceed 0 dB of added gain beyond the global slider.
4. Update the UI:
   - Replace the existing per-track slider with two controls: Global Volume and Per-Track Fine Trim (shown in dB with ± values).
   - Show both `autoTrimDb` (from Match) and `fineTrimDb` (user adjustments) within each card so it’s obvious what the button changed.
5. Add logic so re-clicking Match recomputes `autoTrimDb` and overwrites the previous trim values (while keeping the current global volume), ensuring users can refresh the match after tweaking.

**Verification**
- Load two tracks with different LUFS, set Global Volume to 70%, click Match; confirm the louder track shows a negative auto trim and playback level follows the new gains.
- Move Track A’s fine-trim slider by +1 dB (allowed within safety limits) and confirm only that track’s relative loudness changes.
- Click Match again; the fine trim resets to 0 while auto trim updates, demonstrating deterministic behavior.

---

## 4. Seek & Playback Stability
**Goal**: Avoid tearing down/restarting nodes on every range change and keep toggles gapless.

**Implementation Steps**
1. Debounce scrubbing: pause playback when the user starts dragging, resume once released, or throttle re-schedules.
2. Consider pointer events to know when dragging ends.
3. Reuse active sources when possible, or add short fades to hide discontinuities.

**Verification**
- While playing, drag the scrubber continuously.
- Audio should either pause cleanly during drag or continue without stutters when releasing.
- Monitor console for the absence of repeated “Failed to decode”/node errors.

---

## 5. Reliable End-of-Playback State
**Goal**: Ensure the transport resets no matter how playback stops.

**Implementation Steps**
1. Assign `source.onended = () => stopPlayback(false)` when creating each `AudioBufferSourceNode`.
2. Guard against double-calls by tracking a `hasEnded` flag.
3. Add unit test or manual scenario where Track B is shorter than Track A to ensure state sync.

**Verification**
- Play two tracks with different lengths; when the shorter ends first, ensure UI goes back to “Play,” timer stops, and toggling is still possible.
- Background the tab for 30 seconds; when returning, playback state should still be accurate.

---

## 6. Ephemeral Share Links
**Goal**: Allow the user to send a locked A/B session (embedded audio + gains) via a 24-hour link.

**Implementation Steps**
1. Add persistence layer (Supabase, Planetscale, or Vercel Postgres) to store session metadata + expiration.
2. Upload audio files to private object storage and store the resulting object keys.
3. Create API routes: `POST /api/share` (creates session, returns share URL) and `GET /api/share/[id]` (validates token, serves data + signed URLs).
4. Build `/share/[id]` page: loads stored buffers, displays transport in read-only mode, counts down to expiry.
5. Add cleanup job (CRON) to delete expired sessions & storage objects.
6. Document security limitations (streaming implies potential capture).

**Verification**
- Use the UI to create a share link; confirm DB/storage show new entries.
- Open the link in an incognito window; audio loads with locked controls.
- Attempt to access after 24h (or by manually expiring) and confirm it returns 410/expired message.
- Monitor storage logs to ensure direct downloads are blocked (only signed URLs work).

---

## How to Use This Plan
1. Pick the next unchecked section.
2. Implement + self-test locally.
3. Commit with `feat:`/`fix:` scope referencing the section number.
4. Push to GitHub; wait for Vercel preview.
5. Run the verification steps above against the preview deploy; attach findings to the PR.
6. Only once verified, move to the next section.

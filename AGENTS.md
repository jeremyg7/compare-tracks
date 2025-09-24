# AGENTS

## Project Snapshot
- **Mission**: Deliver a lightweight A/B audio comparison tool that keeps tracks perfectly in sync while allowing fast toggling and per-track gain control.
- **Target Platforms**: Start as a browser-based MVP (Next.js + Web Audio API), remain open to packaging as a desktop app (Electron/Tauri) if low-latency native routing becomes necessary.
- **Audience**: Producers, mix engineers, and audio enthusiasts who need to evaluate rendering decisions quickly.
- **Success Criteria**: Seamless switching between tracks with no timing drift, intuitive keyboard shortcuts, and minimal setup friction.

## Core Roles
- **Product**: Define comparison workflows, manage backlog, gather feedback from early adopters.
- **Design/UX**: Prototype waveform layout, toggle controls, and ensure accessible keyboard/mouse interactions.
- **Engineering**: Implement audio loading, synchronized playback engine, UI, persistence, and optional desktop packaging.
- **QA**: Validate sync accuracy, cross-browser/device behavior, regression test audio edge cases (long files, different sample rates).

## MVP Delivery Goals
1. Load two local audio files (drag-and-drop + file picker) and display basic metadata (name, duration, sample rate).
2. Shared transport controls: play/pause, seek via waveform/scrubber, keyboard shortcuts (`space`, `A`/`B`).
3. Maintain frame-accurate sync while switching focus between tracks.
4. Independent gain sliders with persistent values per session; expose numeric readout in dB.
5. Visual feedback of the active track (color, border, or label).

## Feature Backlog & Priorities
- **P0**
  - Precise transport sync using a single master clock via `AudioContext` currentTime.
  - Toggle between tracks without audible gaps (crossfade option flag).
  - Hotkeys: `,` and `.` for nudge seek; `shift+A/B` to solo preview upcoming segment.
- **P1**
  - Optional blind mode: hide filenames and randomize track labels.
  - Waveform rendering with marked loop points.
  - Project presets: save/load comparison sessions with metadata.
  - Quick A/B switching pedal mode (hold key to temporarily switch).
- **P2**
  - LUFS-based loudness matching (EBU R128) with pre-analysis caching.
  - Multi-track (>2) comparisons with group switching.
  - Reference track alignment (trim auto-detected silence). 
  - Exportable comparison reports (level offsets, notes).
- **Research/Stretch**
  - MIDI footswitch integration for hands-free switching.
  - Browser + desktop hybrid packaging.
  - Collaborative mode (shared remote session with WebRTC).

## Technical Notes & Decisions
- **Stack Recommendation**: Next.js + TypeScript + Tailwind for rapid UI iteration; leverage Web Audio API for decoding, playback, and volume control. Consider Zustand or Redux Toolkit for transport state.
- **Sync Strategy**: Use one `AudioBufferSourceNode` per track slaved to a master scheduler; maintain `offset` when pausing to avoid drift. Investigate `AudioWorklet` for finer control if drift observed.
- **File Handling**: Allow drag-and-drop of local files (use `URL.createObjectURL`) and optionally support remote file URLs in the future.
- **Testing**: Implement unit tests around transport state machine and integration tests via Playwright to assert sync + keyboard UX.
- **Accessibility**: Provide screen-reader friendly labels, focus outlines, and ensure minimum contrast on active track indicators.

## Collaboration Workflow
- **Branching**: `main` remains deployable; feature branches follow `feature/<scope>` naming. Use PR templates referencing audio QA checklist.
- **Issue Tracking**: Tag work with `audio`, `ux`, `infra`, `research` for clarity. Document tricky audio bugs in `/docs/notes`.
- **Feedback Loop**: Encourage attaching short screen captures + audio comparisons to PRs for qualitative validation.

## Open Questions
- Target max file size and preloading strategy?
- Need for cloud storage or remain local-only in MVP?
- Preferred hosting (Vercel for web, GitHub releases for desktop bundles)?
- Should blind mode randomization persist between sessions?

## Next Steps
1. Scaffold Next.js app with TypeScript, Tailwind, Vitest/Playwright.
2. Implement core transport controller with shared clock + event bus.
3. Design UI mockups showing waveform + A/B toggles.
4. Validate performance on Chrome, Safari, Edge; test large (>10 min) files.

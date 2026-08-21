# MediaDevices: getUserMedia() Audio Demo

A comprehensive demonstration of the
[`MediaDevices.getUserMedia()`](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
and
[`MediaStreamTrack.applyConstraints()`](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/applyConstraints)
APIs for audio streams. Experiment with audio processing constraints, test
WebRTC loopback pipelines, inspect real-time statistics, and visualize or record
audio.

## Live Demo

[https://henrik-and.github.io/gum-demo/](https://henrik-and.github.io/gum-demo/)

## How to Use

1.  **Select Input Source:**
    *   **Microphone:** Live physical microphone capture via `getUserMedia()`.
    *   **Audio File:** Simulated `MediaStreamTrack` using
        `HTMLMediaElement.captureStream()` on preloaded or local audio files
        without requiring microphone permissions.
2.  **Configure Audio Constraints:**
    *   Adjust audio processing constraints (`echoCancellation`,
        `autoGainControl`, `noiseSuppression`, `voiceIsolation`, and
        `channelCount`).
    *   Supports boolean (`true`/`false`), `exact`, and `ideal` constraints.
    *   Hover over the **(i)** icon next to any constraint for details on its
        behavior.
3.  **Optional WebRTC Loopback:**
    *   **PeerConnection:** Routes audio through a local two-peer connection
        (`pc1` → `pc2`) using Opus stereo.
    *   **VAD/DTX/CNG:** Injects `usedtx=1` into Opus SDP to enable Voice
        Activity Detection, Discontinuous Transmission, and Comfort Noise
        Generation.
4.  **Start the Stream:** Click **getUserMedia** to acquire the stream.
5.  **Dynamic Updates:** With an active microphone track, adjust constraints in
    the `// applyConstraints() scope` box and click **applyConstraints** to
    update track settings on the fly.
6.  **Playback & Controls:**
    *   **Track:Mute:** Toggles `track.enabled` without stopping hardware
        capture.
    *   **HTML:Play:** Plays stream via an HTML `<audio>` tag with `sinkId`
        output device routing.
    *   **WebAudio:Play:** Routes stream through Web Audio API (`AudioContext`)
        with custom `latencyHint` and `sampleRate`.
    *   **Rec / Stop:** Records an Opus WebM snippet using `MediaRecorder` with
        waveform visualization.
    *   **Save Snapshot:** Downloads a structured `gUM-snapshot.json` file
        capturing active settings, getters, and WebRTC statistics.
    *   **Copy Bookmark:** Copies a shareable URL containing your selected
        constraints.

## Key Features

*   **Input Source Selection:** Switch between physical microphone and
    pre-recorded/local audio files.
*   **Full Constraint Suite:** Test boolean, `exact`, and `ideal` configurations
    for `echoCancellation`, `autoGainControl`, `noiseSuppression`,
    `voiceIsolation`, and `channelCount`.
*   **Live Constraint Reconfiguration:** Test
    `MediaStreamTrack.applyConstraints()` on active audio tracks.
*   **MediaStreamTrack Inspection:** Real-time side-by-side display of:
    *   `getConstraints():` Requested constraint dictionary with yellow pulse
        highlights on dynamically requested changes.
    *   `getSettings():` Actual runtime pipeline state with green pulse
        highlights when constraints are successfully applied, and red pulse
        highlights when an `applyConstraints()` change is unhonored by the
        browser pipeline.
    *   `properties:` Track properties (`id`, `kind`, `label`, `enabled`,
        `muted`, `readyState`) with pulse highlights on changes.
    *   `stats:` Frame rate, delivered frames, dropped frames, and latency
        metrics via `MediaStreamTrackAudioStats`.
    *   `Lifecycle Activity Log:` Collapsible, timestamped event log recording
        real-time track events (`onmute`, `onunmute`, `onended`,
        `applyConstraints`, `devicechange`, playback transitions).
*   **RTCPeerConnection (getStats() Reports):** Real-time metrics for:
    *   `outbound-rtp (pc1):` Sent bitrate (bps), packets per second (pps),
        bytes per packet (bpp), and codec info.
    *   `inbound-rtp (pc2):` Received bitrate, packet loss, concealment, jitter
        buffer delay, and audio levels (RMS / dBov).
    *   `audio-playout (pc2):` Playout delay, synthesized/concealed glitch
        metrics, and glitch ratios.
*   **Dual Playback Modes:** Compare native `<audio>` element playback against
    Web Audio API (`AudioContext`).
*   **Opus Recording & Visualizer:** In-browser recording with multi-MIME
    support and audio level meters.
*   **System Diagnostics:** Header banner detecting browser, OS, secure context
    status, microphone permissions, CPU compute pressure (`PressureObserver`),
    live 1Hz mapped history graph (`light 25%`, `moderate 50%`, `high 75%`,
    `heavy 100%`), state simulation cycle, API support, and raw user agent.
*   **State Snapshot Export:** Single-click JSON export of all current
    configuration, system diagnostics, and performance data.

## Advanced Debugging with `chrome://webrtc-internals`

For Chromium browsers:

1.  Open a new tab and navigate to `chrome://webrtc-internals`.
2.  Start the demo with **PeerConnection** checked.
3.  Inspect `getUserMedia` constraint dictionaries, track states, and real-time
    WebRTC audio processing graphs (AEC return loss, audio levels, delay, etc.).

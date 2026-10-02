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
        without requiring microphone permissions. Controls that only apply to
        a microphone (constraints, `applyConstraints()`, 440Hz Sine and
        `getConstraints()`) are hidden in this mode.
2.  **Configure Audio Constraints:**
    *   Adjust audio processing constraints (`echoCancellation`,
        `autoGainControl`, `noiseSuppression`, `voiceIsolation`, `channelCount`,
        `latency`, `sampleRate`, and `sampleSize`).
    *   Supports boolean (`true`/`false`), direct values, `exact`, and `ideal`
        constraints.
    *   Hover over the **(i)** icon next to any constraint for details on its
        behavior.
3.  **Options** (grouped as Transport, Test signal and On start):
    *   **PeerConnection:** Routes audio through a local two-peer connection
        (`pc1` → `pc2`) using Opus stereo.
    *   **VAD/DTX/CNG:** Injects `usedtx=1` into Opus SDP to enable Voice
        Activity Detection, Discontinuous Transmission, and Comfort Noise
        Generation.
    *   **Auto-Record:** Automatically initiates `MediaRecorder` at time zero as
        soon as `getUserMedia()` acquires the track, capturing the very first
        audio buffers without UI interaction delay.
    *   **Auto-Play:** Automatically renders the audio track in loopback as
        soon as the stream is acquired. Select **HTML** (`<audio>` element) or
        **WebAudio** (`AudioContext`) next to the checkbox.
    *   **440Hz Sine:** Replaces microphone audio with a clean, continuous 440
        Hz sine tone via Web Audio while keeping physical microphone capture
        active (critical for keeping Bluetooth headsets in bidirectional
        Headset/HFP mode) to make audio glitches and buffer starvation dropouts
        immediately audible. Can be toggled on the fly. Microphone source
        only.
4.  **Start the Stream:** Click **getUserMedia** (or **captureStream** for an
    audio file). A sticky live bar appears below System Diagnostics with the
    level meter and the stream controls. It stays at the top of the window
    when you scroll.
5.  **Dynamic Updates:** With an active microphone track, adjust constraints in
    the `// applyConstraints() scope` box and click **applyConstraints** to
    update track settings on the fly.
6.  **Playback & Controls** (in the live bar):
    *   **Track:Mute:** Toggles `track.enabled` without stopping hardware
        capture.
    *   **HTML:Play:** Plays stream via an HTML `<audio>` tag with `sinkId`
        output device routing.
    *   **WebAudio:Play:** Routes stream through Web Audio API (`AudioContext`)
        with custom `latencyHint`, `sampleRate`, and W3C **Configurable Render
        Quantum** (`renderSizeHint`). Displays negotiated
        `audioContext.renderQuantumSize` (samples and ms duration), sample rate,
        and base latency in a dedicated status card and interactive badge.
    *   **Rec / Stop Rec:** Records an Opus WebM snippet using `MediaRecorder`.
        The button turns solid red while recording. Play the recording with
        the same level meter as the live stream, optionally with **Loop**, and
        download it as a WebM file.
    *   **Stop Stream:** Stops the tracks and closes the loopback connection.
    *   **Save Snapshot:** Downloads a structured `gUM-snapshot.json` file
        capturing active settings, device selections, WebAudio quantum
        parameters, track getters, and WebRTC statistics.
    *   **Copy Bookmark:** Copies a shareable URL containing your selected
        source, constraints and options.
    *   **Debug logging:** Add `?debug=1` to the URL to show verbose
        `console.log` output in DevTools. Warnings and errors are always shown.

## Key Features

*   **Input Source Selection:** Switch between physical microphone and
    pre-recorded/local audio files.
*   **440 Hz Sine Tone Injection:** Route a clean, constant 440 Hz tone through
    the WebRTC loopback pipeline while maintaining live microphone capture
    (preserving bidirectional Bluetooth Headset/HFP profile), making buffer
    starvation and glitch artifacts easily audible. Dynamically switchable on
    the fly via RTCRtpSender track replacement.
*   **Auto-Record at Time Zero:** Pre-arm recording to start immediately on
    stream acquisition to diagnose driver initialization delays or early audio
    loss.
*   **Auto-Play from Start:** Automatically begins rendering audio in loopback
    via HTML:Play or WebAudio:Play upon stream acquisition.
*   **Level Meter:** RMS level in dBFS (-60 to 0) with colour zones: green up to
    -20 dBFS, yellow to -10, orange to -3 and red above -3. Shown in the live
    bar, next to the pc2 `audioLevel`, and for recorded audio playback.
*   **Foldable Cards:** Every card can be folded; the page remembers which
    cards are open. A folded Track or RTP card shows a health dot and a badge
    that counts new changes or glitches since the card was last open.
*   **Full Constraint Suite:** Test boolean, direct, `exact`, and `ideal`
    configurations for `echoCancellation`, `autoGainControl`,
    `noiseSuppression`, `voiceIsolation`, `channelCount`, `latency`,
    `sampleRate`, and `sampleSize`.
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
        metrics, and glitch ratios. **Simulate Glitches** injects synthetic
        glitch events to show the warning states without audible distortion.
    *   **Audible glitch metrics:** Two chips in the card header row, updated
        every second and counted since the PeerConnection started. Only
        1-second intervals with audible playout count. An interval is audible
        if the received level `sqrt(ΔtotalAudioEnergy / ΔtotalSamplesDuration)`
        from `inbound-rtp` is above 0.0007.
        *   `Audible glitchy seconds ratio` (%): share of audible seconds with
            at least one glitch (`ΔsynthesizedSamplesDuration > 0`), with
            `(glitchy/audible)` seconds. Example: 10 audible seconds, 2 with a
            glitch, gives 20 %.
        *   `Audible glitch time ratio` (%): glitch time divided by playout
            time over audible seconds, with `(glitch ms/audible s)`. Example:
            one 20 ms glitch every 2 s gives 1 %.
        *   Red when the value is above 0, green when it is 0. Gray with
            `not playing` when pc2 audio is not played out (HTML:Play and
            WebAudio:Play off); these seconds are not counted. Gray with
            `silent N s` when audio is played out but the level is at or below
            0.0007 (for example a muted track).
        *   The same values are in the `audible` object of the
            `audio-playout (pc2)` pane and in `gUM-snapshot.json`.
*   **Audio Path:** The active source (microphone device or audio file
    details), the active output device and the WebAudio context.
*   **Dual Playback Modes & Configurable Render Quantum:** Compare native
    `<audio>` element playback against Web Audio API (`AudioContext`). Features
    full support for the W3C **Configurable Render Quantum** specification:
    *   **`renderSizeHint` selection:** Test exact integer quantum frame sizes
        (e.g. `64`, `128`, `256`, `480` for 10ms at 48kHz, `512`, `960`, `1024`,
        `2048`, or arbitrary integers), `"hardware"` OS buffer negotiation, and
        `"default"` (128 frames).
    *   **Runtime quantum readout:** Inspect negotiated
        `audioContext.renderQuantumSize` in real time with millisecond duration
        conversion in a dedicated status card, an interactive quantum badge,
        lifecycle logs, and `gUM-snapshot.json`.
*   **Opus Recording:** In-browser recording with multi-MIME support, level
    meter during playback, Loop and Download.
*   **System Diagnostics & CPU Compute Pressure:** Foldable card at the top of
    the page detecting
    browser, OS, secure context status, microphone permissions, hardware audio
    latency, and live CPU compute pressure via the
    [`Compute Pressure API`](https://developer.mozilla.org/en-US/docs/Web/API/Compute_Pressure_API)
    (`PressureObserver`). Includes:
    *   **Live PressureObserver & 1Hz History Graph:** Visualizes real-time CPU
        pressure states (`nominal 25%`, `fair 50%`, `serious 75%`, `critical
        100%`) with thermal factor tracking on a 1Hz rolling canvas graph.
    *   **CPU Load Emulation:** Allows testing app adaptation behavior under
        simulated processor load (manual state selection or automated 10-second
        `nominal -> critical -> nominal` cycle) without placing physical load on
        the host processor.
*   **State Snapshot Export:** Single-click JSON export of all current
    configuration, system diagnostics, and performance data.

## Advanced Debugging with `chrome://webrtc-internals`

For Chromium browsers:

1.  Open a new tab and navigate to `chrome://webrtc-internals`.
2.  Start the demo with **PeerConnection** checked.
3.  Inspect `getUserMedia` constraint dictionaries, track states, and real-time
    WebRTC audio processing graphs (AEC return loss, audio levels, delay, etc.).

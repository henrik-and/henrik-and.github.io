# MediaDevices: getUserMedia() Audio Demo

This is a demonstration of the [`MediaDevices.getUserMedia()`](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) API, focusing on audio streams. It allows you to experiment with different audio constraints, listen to and visualize the resulting audio stream.

## Live Demo

A live version of this demo is available at: [https://henrik-and.github.io/gum-demo/](https://henrik-and.github.io/gum-demo/)

## How to Use

1.  **Select Input Source:** Choose between "Microphone" and "Audio File".
    *   **Microphone:** Standard behavior using `getUserMedia()` with physical devices.
    *   **Audio File:** Mocks a `MediaStream` by capturing the output of a selected audio file using `audioElement.captureStream()`.
2.  **Select Audio Constraints:** Use the dropdown menus to select the desired audio [constraints](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints) (`echoCancellation`, `autoGainControl`, and `noiseSuppression`). These can be adjusted for both input sources.
    *   **Microphone only:** The `deviceId` constraint is used to select a specific physical input device.
    *   **Audio File only:** Select the desired track from the "Audio File" dropdown.
3.  **(Optional) Enable PeerConnection Loopback:** Click the "+ PeerConnection" button to enable the WebRTC loopback. When the stream is started, audio will be sent and received through a local PeerConnection, allowing you to inspect outbound RTP stats and listen to the effect of encoding and decoding the audio stream.
4.  **Start the Stream:** Click the "getUserMedia" button to start the audio stream.
5.  **Visualize and Control:** Once the stream is active, you can:
    *   See a live visualization of the audio and its current level.
    *   Mute/unmute the audio track.
    *   Play the audio through your speakers.
    *   Record and play back the audio while visualizing its frequency spectrum.
    *   Stop the stream.
5.  **Copy Bookmark:** The "Copy Bookmark" button creates a URL with the currently selected constraints, allowing you to save and share specific configurations for future use.

## Features

*   **Input Source Selection:** Toggle between a live microphone and an audio file.
    *   The "Audio File" mode uses the `audioElement.captureStream()` API to provide a `MediaStream` from a pre-recorded file. This is useful for testing audio processing and WebRTC behavior with consistent, repeatable input.
*   **Constraint Selection:** Easily test different audio constraints to see their effect when using a microphone.
*   **Audio Visualization:** Live audio visualizers provide feedback on the audio stream.
    * A simple level meter is added for the active audio track. This allows you to verify that the source is working as intended.
    * A more fancy visualizer is used when playing out recorded audio. The analyser performs a Fast Fourier Transform (FFT) on the audio to calculate the frequency spectrum of the rendered signal.
*   **Recording:** Record a snippet of the audio and play it back while visualizing its frequency spectrum. The recording functionality checks for browser support for MIME types in the following prioritized order: `audio/webm; codecs=pcm`, `audio/webm; codecs=opus`, `audio/webm`, `audio/ogg; codecs=opus`, and `audio/ogg`. The first format in this list that the browser supports is used. If none are supported, the browser's default format is used. Playback of recorded audio is always done on the system's default output device.
*   **Track Properties and Stats:** View detailed information about the audio track, including its settings, properties, and real-time statistics such as delivered frames per second.
*   **Active Source Display:** See the properties of the live audio source. For microphones, it shows the device's label, ID, and group ID. For audio files, it displays the filename and duration. This clarifies exactly what is providing the audio for the stream.
*   **Audio Output Selection:** Choose which speaker or output device to play audio on using the [`HTMLMediaElement.setSinkId()`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/setSinkId) method. The demo also displays the properties of the active audio output device.
*   **Bookmarkable URLs:** Share your specific constraint configurations with others.
*   **PeerConnection Loopback and Stats:**
    *   Enable the PeerConnection toggle to send the audio stream through a local `RTCPeerConnection` loopback. This allows you to visualize and listen to the audio *after* it has been processed by the WebRTC audio engine (encoding, decoding, etc.).
    *   When enabled, a new information box appears displaying `RTCOutboundRtpStreamStats`. This provides real-time metrics about the WebRTC stream, including current bitrate (bps), packets per second (pps), packet retransmissions, and the target bitrate of the encoder. This is invaluable for diagnosing audio quality issues and understanding the behavior of the WebRTC stack.
    *   Two additional panels, `RTCInboundRtpStreamStats` and `RTCAudioPlayoutStats`, also appear. These provide detailed real-time metrics about the receiving side of the WebRTC connection. You can monitor the incoming bitrate, packet loss, audio concealment events, jitter buffer delay, and the average audio level (both as a linear RMS value and in dBov). These stats are crucial for diagnosing issues related to network reception and audio playout quality.

## Advanced Debugging with `chrome://webrtc-internals`

For users of Google Chrome and other Chromium-based browsers, the `chrome://webrtc-internals` page is a great tool for advanced debugging.

1.  Open a new tab and navigate to `chrome://webrtc-internals`.
2.  Return to this demo page and start a stream by clicking "getUserMedia".

The `webrtc-internals` page will now display lots of detailed information.

*   **`getUserMedia` Requests:** You can inspect the exact constraints that were passed to the API and see the raw, detailed properties of the `MediaStreamTrack` that was returned.
*   **PeerConnection Stats:** If you have the PeerConnection loopback enabled, you can select the active connection to view a comprehensive list of real-time stats graphs. This includes everything from bitrate and packet loss to detailed audio processing metrics like echo cancellation return loss and audio input level.

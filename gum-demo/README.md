# MediaDevices: getUserMedia() Audio Demo

This is a demonstration of the [`MediaDevices.getUserMedia()`](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) API, focusing on audio streams. It allows you to experiment with different audio constraints, listen to and visualize the resulting audio stream.

## Live Demo

A live version of this demo is available at: [https://henrik-and.github.io/gum-demo/](https://henrik-and.github.io/gum-demo/)

## How to Use

1.  **Select Audio Constraints:** Use the dropdown menus to select the desired audio [constraints](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints) (`echoCancellation`, `autoGainControl`, `noiseSuppression`, and `deviceId`).
2.  **Start the Stream:** Click the "getUserMedia" button to start the audio stream recording using the selected microphone as source.
3.  **Visualize and Control:** Once the stream is active, you can:
    *   See a live visualization of the audio and its current level.
    *   Mute/unmute the audio track.
    *   Play the audio through your speakers.
    *   Record and play back the audio while visualizing its frequceny spectrum.
    *   Stop the stream.
4.  **Copy Bookmark:** The "Copy Bookmark" button creates a URL with the currently selected constraints, allowing you to save and share specific configurations for future use.

## Features

*   **Constraint Selection:** Easily test different audio constraints to see their effect.
*   **Audio Visualization:** Live audio visualizers provides feedback on the audio stream.
    * A simple level meter is added for the auactive adio track. This allows you to veify that the microphone is working as intended.
    * A more fancy visualizer is used when playing out recorded audio. The analyser performs a Fast Fourier Transform (FFT) on the audio to calculate the frequency spectrum at that exact moment.
*   **Recording:** Record a snippet of the audio and play it back while visualizing its frequency spectrum. The recording functionality checks for browser support for MIME types in the following prioritized order: `audio/webm; codecs=pcm`, `audio/webm; codecs=opus`, `audio/webm`, `audio/ogg; codecs=opus`, and `audio/ogg`. The first format in this list that the browser supports is used. If none are supported, the browser's default format is used. Playback of recorded audio is always done on the system's default output device.
*   **Track Properties and Stats:** View detailed information about the audio track, including its settings, properties, and real-time statistics.
*   **Active Device Display:** See the properties of the live audio input device. This clarifies exactly which microphone is being used by the stream, which is especially useful when the browser chooses a default device.
*   **Audio Output Selection:** Choose which speaker or output device to play audio on using the [`HTMLMediaElement.setSinkId()`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/setSinkId) method. The demo also displays the properties of the active audio output device.
*   **Bookmarkable URLs:** Share your specific constraint configurations with others.

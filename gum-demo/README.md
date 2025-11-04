# MediaDevices: getUserMedia() Audio Demo

This is a demonstration of the [`MediaDevices.getUserMedia()`](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) API, focusing on audio streams. It allows you to experiment with different audio constraints and visualize the resulting audio stream.

## Live Demo

A live version of this demo is available at: [https://henrik-and.github.io/gum-demo/](https://henrik-and.github.io/gum-demo/)

## How to Use

1.  **Select Audio Constraints:** Use the dropdown menus to select the desired audio constraints (`echoCancellation`, `autoGainControl`, `noiseSuppression`, and `deviceId`).
2.  **Start the Stream:** Click the "getUserMedia" button to start the audio stream.
3.  **Visualize and Control:** Once the stream is active, you can:
    *   See a live visualization of the audio.
    *   Mute/unmute the microphone.
    *   Play the audio through your speakers.
    *   Record and play back the audio.
    *   Stop the stream.
4.  **Copy Bookmark:** The "Copy Bookmark" button creates a URL with the currently selected constraints, allowing you to save and share specific configurations.

## Features

*   **Constraint Selection:** Easily test different audio constraints to see their effect.
*   **Audio Visualization:** A live audio visualizer provides feedback on the audio stream.
*   **Recording:** Record a snippet of the audio and play it back.
*   **Track Properties and Stats:** View detailed information about the audio track, including its settings, properties, and real-time statistics.
*   **Bookmarkable URLs:** Share your specific constraint configurations with others.

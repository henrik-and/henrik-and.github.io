# MediaDevices: getDisplayMedia() Audio Demo

A test page for the audio part of
[`navigator.mediaDevices.getDisplayMedia()`](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia).
Use it to see which options and audio constraints Chrome accepts, and what the
captured audio track reports.

## Live Demo

https://henrik-and.github.io/gdm-demo/

Related page: [getUserMedia() Audio Demo](../gum-demo/).

## How to Use

1. Optional: play audio under **Local audio sources**, so there is audio to
   capture. There are three sources, the same as in
   [echo-demo](../echo-demo/). Each one plays out in a different way, and they
   can play at the same time:
   - **&lt;audio&gt; element**: the audio element plays the file directly.
   - **Web Audio**: `createMediaElementSource()` connected to
     `AudioContext.destination`.
   - **RTCPeerConnection**: a local loopback, `createMediaElementSource()` →
     `createMediaStreamDestination()` → pc1 → pc2 (Opus, stereo) → a hidden
     audio element that plays the remote track.
2. Set the **getDisplayMedia() options**. Every control starts as `undefined`,
   which means that the member is not sent. The **Request** box shows the exact
   object that is passed to `getDisplayMedia()`.
3. Press **getDisplayMedia**. In the picker, select a screen or a tab and turn
   on audio sharing.
4. Look at the result:
   - The level meter at the top shows the level of the captured audio (RMS, dBFS).
   - **MediaStreamTrack (audio) getters & properties** shows `getConstraints()`,
     `getSettings()`, `getCapabilities()` and track properties.
   - **Lifecycle Activity Log** at the bottom lists the events, including errors
     such as a `TypeError`.
5. Optional: record the captured audio, play it back and download it.
6. Press **Stop** to end the capture.

## Options and constraints

**Top-level options:** `systemAudio`, `windowAudio`, `selfBrowserSurface`,
`surfaceSwitching`, `monitorTypeSurfaces` and `preferCurrentTab`.

**Video:** `getDisplayMedia()` always needs video, because audio-only requests
are not allowed. The page always requests video and stops the video track
directly after capture. `displaySurface` is optional and only sets the
preferred surface type in the picker.

**Audio constraints:** `restrictOwnAudio`, `suppressLocalAudioPlayback`,
`echoCancellation`, `autoGainControl`, `noiseSuppression`, `channelCount`,
`sampleRate` and `sampleSize`. Each one can be:

- `undefined`: not sent.
- A plain value: the same as `ideal`.
- `ideal`: a hint.
- `exact`: not allowed for `getDisplayMedia()`. The call fails with a
  `TypeError`. This is useful to test the error path.

If all audio constraints are `undefined`, the page sends `audio: true`.

## Copy Bookmark

**Copy Bookmark** copies a link with the current selections as URL parameters,
for example:

```
https://henrik-and.github.io/gdm-demo/?systemAudio=include&restrictOwnAudio=ideal:true&audioFile=harvard.wav
```

The files of the three local audio sources are stored as `audioFile`,
`webAudioFile` and `pcAudioFile`, but only when they differ from the default.

When you open the link, the page applies the parameters. Unknown parameters and
values are ignored. The selections are also saved in the browser, so the page
remembers them the next time.

## Notes

- **System audio** is only offered for a full screen on Windows and ChromeOS.
  Tab audio is offered for a browser tab.
- A level of about **−96 dBFS** without any playback usually comes from Windows
  audio enhancements or spatial sound on the output device. Turn them off to get
  −∞ (true silence).
- **System Diagnostics** at the top shows the browser, the OS, the audio
  hardware, the permission state and `getSupportedConstraints()`.

## Advanced Debugging with `chrome://webrtc-internals`

Open `chrome://webrtc-internals` in another tab before you press
**getDisplayMedia**. It shows the `getDisplayMedia()` call, the constraints and
the resulting tracks.

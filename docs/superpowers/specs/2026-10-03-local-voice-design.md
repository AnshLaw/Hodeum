# Local voice (sub-project 4)

Date: 2026-10-03. Goal: spoken goal → guidance → action → verification (Gate 6), barge-in, all on this PC, CPU-first (the GPU is the vision model's).

## Stack

One native dependency, `sherpa-onnx` (official Rust crate, `shared` feature so its DLLs sit beside the exe and avoid the static-CRT link clash). Audio I/O through `rodio` (playback) and its `cpal` (microphone).

| Role | Model (in `models/voice/`, gitignored) | Notes |
| --- | --- | --- |
| Voice activity | Silero VAD (0.6 MB) | Always on while the mic is on; drives barge-in |
| Speech → text | NVIDIA Nemotron 3.5 ASR streaming 0.6B int8 (475 MB) | Streaming: live partial text; 40 locales incl. Hindi (P1) |
| Text → speech | Supertonic 3 int8 (129 MB) | 44.1 kHz, preset voices, Hindi included |
| Fallbacks | Windows voices (TTS); typed input (ASR) | MagpieTTS has no CPU path (slower than real time), so it's not in the local chain |

`scripts/setup-local-ai.ps1` downloads and unpacks them. Missing models: the mic shows why, and speech uses Windows voices.

## Native (`src-tauri/src/voice/`)

- **Listener thread.** Microphone (default device config) → mono → 16 kHz (`LinearResampler`) → VAD in 512-sample windows.
  - On speech start: emit `voice:speech-start` (barge-in) and open an ASR stream, primed with ~0.3 s of pre-roll.
  - While speaking: decode and emit `voice:transcript {text, final:false}` when the text changes.
  - On speech end: finish the stream and emit `{final:true}`.
  - If the microphone delivers only silence for 4 s after starting, emit `voice:error` with a learner-readable message (known cpal / headset issue).
- **Commands:** `voice_status`, `voice_start`, `voice_stop`. Status is `missing | idle | listening`, plus a detail.
- **Speaker thread.** `tts_speak {id, text, voice, speed}` synthesizes sentence by sentence and plays through rodio. `tts_stop` cancels synthesis (progress callback returns false) and clears the player immediately. `tts:done {id}` fires when playback ends or is stopped.
- **Segments (`tts:segment {id, index, text}`).** Each chunk of a spoken line (a sentence, or a long first sentence's opening clause; prepared phrases too) is announced as it starts playing: `index` counts from 0 and `id` is the line's `tts_speak` id. A watcher thread per line (`voice/playhead.rs`) checks the player every 20 ms: of the chunks appended so far, those the player no longer holds have played out and the first one it still holds is playing. Segments therefore trail the voice by well under 50 ms. There are none for lines that are only prepared, and none once `tts_stop` has returned. In TypeScript, `TTSProvider.onSegment` gives `{index, text}` for the line the voice is saying: `NativeTTSProvider` keeps only its own lines that are still running (not stopped, done or failed), and `RoutedTTS` and `CloudFirstTTS` pass the local voice's segments on only while it is saying their line. ElevenLabs and Windows voices have no segments. The overlay will use them to emphasise the highlight Hodey is talking about.
- Threads: ASR 2, TTS 2, VAD 1. Nothing is written to disk: no audio, no transcripts.

## TypeScript

- `NativeSpeechInput` implements `SpeechInput` over those events. The orange privacy dot is on while listening.
- `NativeTTSProvider` implements `TTSProvider`. `RoutedTTS` uses Supertonic when its model is present and Windows voices otherwise, falling back per utterance on error.
- `connectVoice` (done) routes final transcripts through `routeUtterance` (done) and calls `runtime.interruptSpeech()` on speech start.
- Notch:
  - while listening, the bar reads "Hodey is listening…" with the live partial transcript;
  - **Tap-to-talk** (changed after testing in a real room): the mic button or Ctrl+Alt+Space listens for one utterance and stops by itself, or gives up after 8 s of no speech. Always-on listening acted on room audio.
  - Tapping interrupts Hodey at once. While Hodey is speaking, its own voice coming back through the speakers is recognised and ignored (word overlap with what it is saying).
- Settings: Supertonic voices are listed first ("Hodey voices, on this PC"), then Windows voices.

## Testing

- Rust: VAD/ASR state machine on synthetic frames, sentence splitting, resampling and mixing helpers, and model-path discovery.
- TS: the speech input and TTS adapters with a fake bridge, and RoutedTTS fallback.
- Native: Gate 4 (a short English command transcribed) and Gate 5 (TTS starts, then stops when speech starts). Run with the real models.

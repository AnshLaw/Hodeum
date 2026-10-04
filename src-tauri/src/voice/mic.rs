//! The microphone Hodey listens on. Every mode (tap, hold, conversation, hands-free) uses the same
//! device (devices::listening_mic); long sessions use Windows' echo-cancelled stream on it when the PC
//! has one. A microphone stays open briefly between sessions so the next one (the conversation after a
//! tap, the request after a wake word) starts at once: the echo-cancelled stream takes 0.35-2.6 s to
//! open. Audio is only ever held in memory.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread;
use std::time::{Duration, Instant};

use rodio::cpal::traits::{DeviceTrait, StreamTrait};
use rodio::cpal::{self, SampleFormat};
use sherpa_onnx::LinearResampler;

use super::devices::{self, ListeningMic};
use super::echo_mic::{self, EchoCancelledMic};
use super::listen::SAMPLE_RATE;
use super::segment::downmix;

/// How long an open microphone waits for the next session before it's closed.
pub(crate) const WARM_MIC_GRACE: Duration = Duration::from_secs(3);
/// Audio kept from just before a reused microphone's session starts (as the segmenter's preroll).
const WARM_KEEP_SECS: f32 = 0.6;
/// The echo-cancelled stream opening in the background: the longest a session waits for it.
const PENDING_WAIT: Duration = Duration::from_secs(3);
const NO_MIC: &str = "No microphone found. Plug one in or enable it in Windows sound settings.";

/// The microphone, delivering mono f32 chunks at the device's own rate.
pub(crate) struct Mic {
    _source: MicSource,
    pub(crate) rate: u32,
}

enum MicSource {
    // Held only to keep the microphone running; dropping either stops it.
    EchoCancelled { _mic: EchoCancelledMic },
    Plain { _stream: cpal::Stream },
}

static PLAIN_MIC_LOGGED: AtomicBool = AtomicBool::new(false);

/// The listening microphone. With `cancel_echo`, Windows' echo cancellation when this PC has it
/// (Hodey's voice from the speakers is removed), for long sessions where Hodey talks while the mic is
/// open. Otherwise (or without it) the plain stream of the same device.
fn open_mic(tx: Sender<Vec<f32>>, cancel_echo: bool, mic: &ListeningMic) -> Result<Mic, String> {
    if cancel_echo {
        match echo_mic::open(tx.clone(), Some(mic.id.clone())) {
            Ok(echo) => return Ok(echo_cancelled(echo)),
            Err(reason) if !PLAIN_MIC_LOGGED.swap(true, Ordering::SeqCst) => eprintln!("using the plain microphone: {reason}"),
            Err(_) => {}
        }
    }
    open_plain_mic(tx, mic)
}

fn echo_cancelled(echo: EchoCancelledMic) -> Mic {
    Mic { _source: MicSource::EchoCancelled { _mic: echo }, rate: SAMPLE_RATE as u32 }
}

fn open_plain_mic(tx: Sender<Vec<f32>>, mic: &ListeningMic) -> Result<Mic, String> {
    let device = devices::cpal_input(mic).or_else(devices::input_device).ok_or(NO_MIC)?;
    let supported = device.default_input_config().map_err(|e| format!("Couldn't read the microphone's settings: {e}"))?;
    let channels = usize::from(supported.channels());
    let rate = supported.sample_rate();
    let config = supported.config();
    let report = |e: cpal::StreamError| eprintln!("microphone stream error: {e}");
    let stream = match supported.sample_format() {
        SampleFormat::F32 => device.build_input_stream(&config, move |d: &[f32], _: &_| { let _ = tx.send(downmix(d, channels)); }, report, None),
        SampleFormat::I16 => device.build_input_stream(
            &config,
            move |d: &[i16], _: &_| { let _ = tx.send(downmix(&d.iter().map(|&s| f32::from(s) / 32_768.0).collect::<Vec<_>>(), channels)); },
            report,
            None,
        ),
        other => return Err(format!("This microphone uses an unsupported sample format ({other:?}).")),
    }
    .map_err(|e| format!("Couldn't open the microphone: {e}"))?;
    stream.play().map_err(|e| format!("Couldn't start the microphone: {e}"))?;
    Ok(Mic { _source: MicSource::Plain { _stream: stream }, rate })
}

/// An open microphone with its audio and the resampler to 16 kHz. Dropping it stops the microphone.
pub(crate) struct Input {
    mic: Mic,
    audio: Receiver<Vec<f32>>,
    /// Audio from just before this session (a reused microphone), heard first.
    backlog: VecDeque<Vec<f32>>,
    pub(crate) resampler: LinearResampler,
    pub(crate) name: String,
}

impl Input {
    fn new(mic: Mic, audio: Receiver<Vec<f32>>, name: String) -> Result<Self, String> {
        let resampler = LinearResampler::create(mic.rate as i32, SAMPLE_RATE).ok_or("Couldn't set up audio resampling.")?;
        Ok(Self { mic, audio, backlog: VecDeque::new(), resampler, name })
    }

    /// Whether Windows cancels Hodey's voice on this stream.
    pub(crate) fn echo_cancelled(&self) -> bool {
        matches!(self.mic._source, MicSource::EchoCancelled { .. })
    }

    /// The next chunk of audio at the device's rate.
    pub(crate) fn next(&mut self, timeout: Duration) -> Result<Vec<f32>, RecvTimeoutError> {
        match self.backlog.pop_front() {
            Some(chunk) => Ok(chunk),
            None => self.audio.recv_timeout(timeout),
        }
    }

    /// Reusing an open microphone: drops what it heard between sessions except the last moment.
    fn freshen(&mut self) {
        let waiting: Vec<Vec<f32>> = self.audio.try_iter().collect();
        let keep = (WARM_KEEP_SECS * self.mic.rate as f32) as usize;
        self.backlog = keep_recent(waiting, keep).into();
    }
}

/// The newest chunks holding at most `keep` samples, oldest first.
pub(crate) fn keep_recent(chunks: Vec<Vec<f32>>, keep: usize) -> Vec<Vec<f32>> {
    let mut total = 0;
    let mut kept: Vec<Vec<f32>> = chunks.into_iter().rev().take_while(|chunk| {
        total += chunk.len();
        total <= keep
    }).collect();
    kept.reverse();
    kept
}

/// Opens the listening microphone, echo-cancelled when asked and available.
pub(crate) fn open_input(cancel_echo: bool) -> Result<Input, String> {
    let listening = devices::listening_mic()?;
    let (tx, audio) = mpsc::channel::<Vec<f32>>();
    let mic = open_mic(tx, cancel_echo, &listening)?;
    Input::new(mic, audio, listening.name)
}

type PendingEcho = Receiver<Result<(EchoCancelledMic, Receiver<Vec<f32>>, String), String>>;

/// A microphone kept open between sessions, and the echo-cancelled one opening in the background.
#[derive(Default)]
pub(crate) struct WarmMic {
    ready: Option<(Input, Instant)>,
    pending: Option<(PendingEcho, Instant)>,
}

impl WarmMic {
    /// The microphone for a session: the open one when it suits (an echo-cancelled one suits every
    /// mode), the one opening in the background, else a newly opened one.
    pub(crate) fn take(&mut self, want_echo: bool) -> Result<Input, String> {
        if let Some((mut input, _)) = self.ready.take() {
            if input.echo_cancelled() || !want_echo {
                self.pending = None;
                input.freshen();
                return Ok(input);
            }
        }
        if want_echo {
            if let Some(input) = self.pending.take().and_then(|(pending, _)| finish_pending(pending)) {
                return Ok(input);
            }
        }
        open_input(want_echo)
    }

    /// Keeps `input` open for the next session (closed after WARM_MIC_GRACE).
    pub(crate) fn park(&mut self, input: Input) {
        self.ready = Some((input, Instant::now()));
    }

    /// Starts opening the echo-cancelled stream in the background, unless one is open or opening.
    pub(crate) fn prepare_echo(&mut self) {
        let have_echo = self.ready.as_ref().is_some_and(|(input, _)| input.echo_cancelled());
        if have_echo || self.pending.is_some() {
            return;
        }
        let (done_tx, done_rx) = mpsc::channel();
        thread::spawn(move || {
            let opened = devices::listening_mic().and_then(|mic| {
                let (tx, audio) = mpsc::channel();
                echo_mic::open(tx, Some(mic.id)).map(|echo| (echo, audio, mic.name))
            });
            // A session that no longer wants it has dropped the receiver: the stream closes here.
            let _ = done_tx.send(opened);
        });
        self.pending = Some((done_rx, Instant::now()));
    }

    /// When the open microphone should be closed; None: nothing is open.
    pub(crate) fn closes_at(&self) -> Option<Instant> {
        let parked = self.ready.as_ref().map(|(_, at)| *at);
        let opening = self.pending.as_ref().map(|(_, at)| *at);
        parked.max(opening).map(|at| at + WARM_MIC_GRACE)
    }

    pub(crate) fn is_open(&self) -> bool {
        self.ready.is_some() || self.pending.is_some()
    }

    /// Closes everything (another microphone was picked, or nobody came back in time).
    pub(crate) fn close(&mut self) {
        self.ready = None;
        self.pending = None;
    }
}

fn finish_pending(pending: PendingEcho) -> Option<Input> {
    match pending.recv_timeout(PENDING_WAIT) {
        Ok(Ok((echo, audio, name))) => {
            let mut input = Input::new(echo_cancelled(echo), audio, name).inspect_err(|e| eprintln!("{e}")).ok()?;
            input.freshen();
            Some(input)
        }
        Ok(Err(reason)) => {
            eprintln!("the echo-cancelled microphone didn't open in the background: {reason}");
            None
        }
        Err(_) => {
            eprintln!("the echo-cancelled microphone took too long to open in the background");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_reused_microphone_keeps_only_the_last_moment() {
        let chunks = vec![vec![1.0; 4], vec![2.0; 4], vec![3.0; 4]];
        assert_eq!(keep_recent(chunks.clone(), 8), vec![vec![2.0; 4], vec![3.0; 4]]);
        assert_eq!(keep_recent(chunks.clone(), 7), vec![vec![3.0; 4]], "whole chunks only");
        assert_eq!(keep_recent(chunks, 0), Vec::<Vec<f32>>::new());
        assert_eq!(keep_recent(Vec::new(), 10), Vec::<Vec<f32>>::new());
    }

    #[test]
    fn nothing_is_held_open_by_default() {
        let warm = WarmMic::default();
        assert!(!warm.is_open());
        assert_eq!(warm.closes_at(), None);
    }

    /// Needs a microphone: times opening the listening microphone and the echo-cancelled stream, and
    /// how fast a parked one is reused. Nothing is saved.
    /// `cargo test --lib -- --ignored warm_mic_report --nocapture`.
    #[test]
    #[ignore]
    fn warm_mic_report() {
        println!("listening mic: {:?}", devices::listening_mic());
        let mut warm = WarmMic::default();
        let started = Instant::now();
        let plain = warm.take(false).unwrap();
        println!("plain open: {:?} (echo cancelled: {})", started.elapsed(), plain.echo_cancelled());
        warm.prepare_echo();
        warm.park(plain);
        thread::sleep(Duration::from_millis(500));
        let started = Instant::now();
        let echo = warm.take(true).unwrap();
        println!("echo-cancelled take after a background open: {:?} (echo cancelled: {})", started.elapsed(), echo.echo_cancelled());
        warm.park(echo);
        let started = Instant::now();
        let mut again = warm.take(false).unwrap();
        println!("reuse of the parked stream: {:?}, backlog {} chunks", started.elapsed(), again.backlog.len());
        assert!(again.next(Duration::from_secs(2)).is_ok(), "audio flows");
    }
}

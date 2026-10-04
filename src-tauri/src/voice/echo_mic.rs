//! The microphone with Windows' acoustic echo cancellation: a communications-category WASAPI stream,
//! so Hodey's own voice from the speakers is removed before speech recognition (Windows 11 Voice
//! Clarity, or the sound driver's own canceller). Used only when Windows confirms echo cancellation is
//! on; otherwise the plain microphone is used and the frontend's transcript echo check does the work.
//! Windows converts the audio to 16 kHz mono f32 itself. Uses the microphone and speakers picked in
//! Settings while they're plugged in, else the Windows defaults.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use windows::core::{GUID, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
use windows::Win32::Media::Audio::{
    eCapture, eCommunications, eConsole, eRender, AudioCategory_Communications, AudioClientProperties, IAcousticEchoCancellationControl, IAudioCaptureClient,
    IAudioClient2, IAudioClientDuckingControl, IAudioEffectsManager, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, AUDCLNT_STREAMFLAGS_EVENTCALLBACK, AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, AUDCLNT_STREAMOPTIONS_NONE, AUDIO_DUCKING_OPTIONS_DO_NOT_DUCK_OTHER_STREAMS,
    AUDIO_EFFECT, AUDIO_EFFECT_STATE_ON, WAVEFORMATEX,
};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED};
use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject};

use super::devices::{active_endpoint, chosen_input, chosen_output};
use super::listen::SAMPLE_RATE;

/// `AUDIO_EFFECT_TYPE_ACOUSTIC_ECHO_CANCELLATION` (ksmedia.h).
const ECHO_CANCELLATION: GUID = GUID::from_u128(0x6f64adbe_8211_11e2_8c70_2c27d7f001fa);
const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
const BYTES_PER_SAMPLE: u16 = 4;
const BITS_PER_SAMPLE: u16 = 32;
/// The shared-mode buffer, in 100 ns units (200 ms).
const BUFFER_DURATION: i64 = 2_000_000;
/// How long to wait for audio before checking whether capture should stop.
const PACKET_WAIT_MS: u32 = 200;
const OPEN_TIMEOUT: Duration = Duration::from_secs(3);

/// A running echo-cancelled capture; dropping it stops the microphone.
pub struct EchoCancelledMic {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Drop for EchoCancelledMic {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            if thread.join().is_err() {
                eprintln!("the echo-cancelled microphone thread panicked");
            }
        }
    }
}

/// Opens the communications microphone, sending 16 kHz mono chunks to `tx`. Err (with the reason) when
/// Windows can't cancel echo on this PC, so the caller can use the plain microphone instead.
pub fn open(tx: Sender<Vec<f32>>) -> Result<EchoCancelledMic, String> {
    let (ready_tx, ready_rx) = mpsc::channel();
    let stop = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&stop);
    // COM objects can't move between threads, so the whole capture lives on its own thread.
    let thread = thread::spawn(move || capture(&tx, &flag, &ready_tx));
    let mic = EchoCancelledMic { stop, thread: Some(thread) };
    match ready_rx.recv_timeout(OPEN_TIMEOUT) {
        Ok(Ok(())) => Ok(mic),
        Ok(Err(reason)) => Err(reason),
        Err(_) => Err("the communications microphone didn't start in time".into()),
    }
}

fn capture(tx: &Sender<Vec<f32>>, stop: &AtomicBool, ready: &Sender<Result<(), String>>) {
    // SAFETY: COM is initialised for this thread and torn down after every COM object below is dropped.
    if let Err(error) = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.ok() {
        let _ = ready.send(Err(format!("COM didn't start: {error}")));
        return;
    }
    // SAFETY: plain WASAPI calls on objects created and used only on this thread.
    match unsafe { Stream::open() } {
        Ok(stream) => {
            let _ = ready.send(Ok(()));
            if let Err(error) = unsafe { stream.pump(tx, stop) } {
                eprintln!("echo-cancelled microphone stopped: {error}");
            }
        }
        Err(error) => {
            let _ = ready.send(Err(error.to_string()));
        }
    }
    unsafe { CoUninitialize() };
}

struct Stream {
    client: IAudioClient2,
    capture: IAudioCaptureClient,
    event: HANDLE,
}

impl Drop for Stream {
    fn drop(&mut self) {
        // SAFETY: the event was created by this stream and nothing else closes it.
        if let Err(error) = unsafe { CloseHandle(self.event) } {
            eprintln!("couldn't close the microphone event: {error}");
        }
    }
}

impl Stream {
    unsafe fn open() -> windows::core::Result<Self> {
        let devices: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let client: IAudioClient2 = microphone(&devices)?.Activate(CLSCTX_ALL, None)?;
        let properties = AudioClientProperties {
            cbSize: size_of::<AudioClientProperties>() as u32,
            bIsOffload: false.into(),
            eCategory: AudioCategory_Communications,
            Options: AUDCLNT_STREAMOPTIONS_NONE,
        };
        client.SetClientProperties(&properties)?;
        let flags = AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
        client.Initialize(AUDCLNT_SHAREMODE_SHARED, flags, BUFFER_DURATION, 0, &mono_16k(), None)?;
        dont_duck_others(&client);
        aim_at_speakers(&client, &devices);
        if !echo_cancellation_on(&client)? {
            return Err(windows::core::Error::new(windows::core::HRESULT(-1), "Windows has no echo cancellation for this microphone"));
        }
        let event = CreateEventW(None, false, false, None)?;
        client.SetEventHandle(event)?;
        let capture: IAudioCaptureClient = client.GetService()?;
        client.Start()?;
        Ok(Self { client, capture, event })
    }

    unsafe fn pump(&self, tx: &Sender<Vec<f32>>, stop: &AtomicBool) -> windows::core::Result<()> {
        while !stop.load(Ordering::SeqCst) {
            if WaitForSingleObject(self.event, PACKET_WAIT_MS) != WAIT_OBJECT_0 {
                continue;
            }
            while self.capture.GetNextPacketSize()? > 0 {
                if tx.send(self.read_packet()?).is_err() {
                    return self.client.Stop();
                }
            }
        }
        self.client.Stop()
    }

    unsafe fn read_packet(&self) -> windows::core::Result<Vec<f32>> {
        let (mut data, mut frames, mut flags) = (std::ptr::null_mut(), 0u32, 0u32);
        self.capture.GetBuffer(&mut data, &mut frames, &mut flags, None, None)?;
        let samples = if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 || data.is_null() {
            vec![0.0; frames as usize]
        } else {
            std::slice::from_raw_parts(data.cast::<f32>(), frames as usize).to_vec()
        };
        self.capture.ReleaseBuffer(frames)?;
        Ok(samples)
    }
}

fn mono_16k() -> WAVEFORMATEX {
    WAVEFORMATEX {
        wFormatTag: WAVE_FORMAT_IEEE_FLOAT,
        nChannels: 1,
        nSamplesPerSec: SAMPLE_RATE as u32,
        nAvgBytesPerSec: SAMPLE_RATE as u32 * u32::from(BYTES_PER_SAMPLE),
        nBlockAlign: BYTES_PER_SAMPLE,
        wBitsPerSample: BITS_PER_SAMPLE,
        cbSize: 0,
    }
}

/// The chosen microphone while it's plugged in, else the default communications microphone.
unsafe fn microphone(devices: &IMMDeviceEnumerator) -> windows::core::Result<IMMDevice> {
    match chosen_input().and_then(|id| active_endpoint(devices, &id, "microphone")) {
        Some(device) => Ok(device),
        None => devices.GetDefaultAudioEndpoint(eCapture, eCommunications),
    }
}

/// A communications stream makes Windows turn other sounds down, Hodey's voice included; opt out.
unsafe fn dont_duck_others(client: &IAudioClient2) {
    let result = client.GetService::<IAudioClientDuckingControl>().and_then(|c| c.SetDuckingOptionsForCurrentStream(AUDIO_DUCKING_OPTIONS_DO_NOT_DUCK_OTHER_STREAMS));
    if let Err(error) = result {
        eprintln!("couldn't stop Windows lowering other sounds while listening: {error}");
    }
}

/// Points the canceller at the speakers Hodey talks through (the chosen ones, else the default output).
/// Optional: without it Windows uses the default output anyway.
unsafe fn aim_at_speakers(client: &IAudioClient2, devices: &IMMDeviceEnumerator) {
    let result = (|| {
        let speakers = match chosen_output().and_then(|id| active_endpoint(devices, &id, "speaker")) {
            Some(device) => device,
            None => devices.GetDefaultAudioEndpoint(eRender, eConsole)?,
        };
        let id = speakers.GetId()?;
        let aimed = client.GetService::<IAcousticEchoCancellationControl>().and_then(|c| c.SetEchoCancellationRenderEndpoint(PCWSTR(id.0)));
        CoTaskMemFree(Some(id.0 as *const _));
        aimed
    })();
    if let Err(error) = result {
        eprintln!("couldn't aim echo cancellation at the speakers (using the default): {error}");
    }
}

/// Whether an acoustic echo canceller is actually running on this stream.
unsafe fn echo_cancellation_on(client: &IAudioClient2) -> windows::core::Result<bool> {
    let effects: IAudioEffectsManager = client.GetService()?;
    let (mut list, mut count): (*mut AUDIO_EFFECT, u32) = (std::ptr::null_mut(), 0);
    effects.GetAudioEffects(&mut list, &mut count)?;
    let on = !list.is_null() && std::slice::from_raw_parts(list, count as usize).iter().any(|e| e.id == ECHO_CANCELLATION && e.state == AUDIO_EFFECT_STATE_ON);
    CoTaskMemFree(Some(list as *const _));
    Ok(on)
}

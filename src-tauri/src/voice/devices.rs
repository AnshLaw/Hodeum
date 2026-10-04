//! Which microphone and speakers Hodey uses (Settings > Voice). Devices are named by their Windows
//! audio endpoint id, which both cpal (the plain microphone, Hodey's speaker) and the echo-cancelled
//! microphone understand. A chosen device that has gone away falls back to the Windows default.

use std::sync::Mutex;
use std::thread;

use rodio::cpal::traits::HostTrait;
use rodio::cpal::{self, DeviceId, HostId};
use serde::Serialize;
use tauri::State;
use windows::core::HSTRING;
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Media::Audio::{eCapture, eConsole, eRender, EDataFlow, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE};
use windows::Win32::System::Com::StructuredStorage::{PropVariantClear, PropVariantToStringAlloc};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ};

use super::listen::ListenCommand;
use super::speak::SpeakerCommand;
use super::{send_listen, Voice};

/// Shown when Windows has no name for an endpoint.
const UNNAMED_DEVICE: &str = "Unnamed audio device";

/// Mirrors `AudioDevice` in the frontend.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct AudioDevices {
    pub inputs: Vec<AudioDevice>,
    pub outputs: Vec<AudioDevice>,
}

/// The learner's picks; None is the Windows default.
#[derive(Debug, Clone, Default, PartialEq)]
struct Choice {
    input: Option<String>,
    output: Option<String>,
}

/// What a new choice changes: the microphone (a new speaker re-aims echo cancellation too) and the speaker.
#[derive(Debug, PartialEq)]
struct Changed {
    mic: bool,
    speaker: bool,
}

static CHOICE: Mutex<Choice> = Mutex::new(Choice { input: None, output: None });

/// An empty id from the frontend means "the default", like None.
fn normalize(id: Option<String>) -> Option<String> {
    id.map(|id| id.trim().to_string()).filter(|id| !id.is_empty())
}

fn changes(old: &Choice, new: &Choice) -> Changed {
    let speaker = old.output != new.output;
    Changed { mic: speaker || old.input != new.input, speaker }
}

fn choice() -> Choice {
    CHOICE.lock().map(|c| c.clone()).unwrap_or_else(|e| {
        eprintln!("audio device choice lock poisoned, using the defaults: {e}");
        Choice::default()
    })
}

/// The chosen microphone's endpoint id; None: the Windows default.
pub(crate) fn chosen_input() -> Option<String> {
    choice().input
}

/// The chosen speakers' endpoint id; None: the Windows default.
pub(crate) fn chosen_output() -> Option<String> {
    choice().output
}

/// The chosen cpal device for `id`, or None (logged) when it's gone, so the caller uses the default.
fn cpal_device(id: &str, kind: &str) -> Option<cpal::Device> {
    let device = cpal::default_host().device_by_id(&DeviceId(HostId::Wasapi, id.to_string()));
    if device.is_none() {
        eprintln!("the chosen {kind} is no longer available; using the Windows default");
    }
    device
}

/// The plain microphone: the chosen one while it's plugged in, else the default.
pub(crate) fn input_device() -> Option<cpal::Device> {
    chosen_input().and_then(|id| cpal_device(&id, "microphone")).or_else(|| cpal::default_host().default_input_device())
}

/// The chosen speakers while they're plugged in; None means the default.
pub(crate) fn chosen_output_device() -> Option<cpal::Device> {
    chosen_output().and_then(|id| cpal_device(&id, "speaker"))
}

/// The active endpoint with this id, or None (logged) when it's unplugged or disabled.
///
/// # Safety
/// COM must be initialised on the calling thread.
pub(crate) unsafe fn active_endpoint(devices: &IMMDeviceEnumerator, id: &str, kind: &str) -> Option<IMMDevice> {
    let found = devices.GetDevice(&HSTRING::from(id)).and_then(|device| Ok((device.GetState()? == DEVICE_STATE_ACTIVE).then_some(device)));
    match found {
        Ok(Some(device)) => Some(device),
        Ok(None) => {
            eprintln!("the chosen {kind} is unplugged or disabled; using the Windows default");
            None
        }
        Err(error) => {
            eprintln!("the chosen {kind} is no longer available ({error}); using the Windows default");
            None
        }
    }
}

/// # Safety
/// `text` must be a COM-allocated string, or null; it's freed here.
unsafe fn take_com_string(text: windows::core::PWSTR) -> Result<String, String> {
    let converted = text.to_string().map_err(|e| e.to_string());
    CoTaskMemFree(Some(text.0 as *const _));
    converted
}

unsafe fn endpoint_id(device: &IMMDevice) -> Result<String, String> {
    take_com_string(device.GetId().map_err(|e| e.to_string())?)
}

unsafe fn friendly_name(device: &IMMDevice) -> Result<String, String> {
    let store = device.OpenPropertyStore(STGM_READ).map_err(|e| e.to_string())?;
    let mut value = store.GetValue(&PKEY_Device_FriendlyName).map_err(|e| e.to_string())?;
    let text = PropVariantToStringAlloc(&value).map_err(|e| e.to_string());
    if let Err(error) = PropVariantClear(&mut value) {
        eprintln!("couldn't free an audio device's name: {error}");
    }
    take_com_string(text?)
}

unsafe fn default_id(devices: &IMMDeviceEnumerator, flow: EDataFlow) -> Option<String> {
    // No default (nothing plugged in) is normal; any other failure is worth a line in the log.
    let device = devices.GetDefaultAudioEndpoint(flow, eConsole).ok()?;
    endpoint_id(&device).inspect_err(|e| eprintln!("couldn't read the default audio device: {e}")).ok()
}

unsafe fn list(devices: &IMMDeviceEnumerator, flow: EDataFlow) -> Result<Vec<AudioDevice>, String> {
    let default = default_id(devices, flow);
    let collection = devices.EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE).map_err(|e| e.to_string())?;
    let mut found = Vec::new();
    for index in 0..collection.GetCount().map_err(|e| e.to_string())? {
        let device = collection.Item(index).map_err(|e| e.to_string())?;
        let id = endpoint_id(&device)?;
        let name = friendly_name(&device).unwrap_or_else(|e| {
            eprintln!("couldn't read an audio device's name: {e}");
            UNNAMED_DEVICE.to_string()
        });
        found.push(AudioDevice { is_default: default.as_deref() == Some(id.as_str()), id, name });
    }
    Ok(found)
}

unsafe fn enumerate() -> Result<AudioDevices, String> {
    let devices: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| e.to_string())?;
    Ok(AudioDevices { inputs: list(&devices, eCapture)?, outputs: list(&devices, eRender)? })
}

/// Settings > Voice: the plugged-in microphones and speakers.
#[tauri::command]
pub fn audio_devices() -> Result<AudioDevices, String> {
    // Commands may run on the UI thread, whose COM apartment is already set: list on a fresh thread.
    let worker = thread::spawn(|| {
        // SAFETY: COM is initialised for this thread and torn down after every COM object is dropped.
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.ok().map_err(|e| format!("COM didn't start: {e}"))?;
        // SAFETY: plain endpoint enumeration on objects created and used only on this thread.
        let listed = unsafe { enumerate() };
        unsafe { CoUninitialize() };
        listed
    });
    worker.join().map_err(|_| "listing audio devices crashed".to_string())?.map_err(|e| format!("Couldn't list audio devices: {e}"))
}

/// Settings > Voice: use these devices (None or empty: the Windows default). An open microphone and
/// Hodey's speaker switch over right away.
#[tauri::command]
pub fn set_audio_devices(input: Option<String>, output: Option<String>, voice: State<'_, Voice>) -> Result<(), String> {
    let new = Choice { input: normalize(input), output: normalize(output) };
    let changed = {
        let mut current = CHOICE.lock().map_err(|e| e.to_string())?;
        let changed = changes(&current, &new);
        *current = new;
        changed
    };
    if changed.speaker {
        voice.speak.lock().map_err(|e| e.to_string())?.send(SpeakerCommand::SwitchOutput).map_err(|_| "Hodey's voice has stopped; restart Hodeum.".to_string())?;
    }
    if changed.mic {
        send_listen(&voice, ListenCommand::DevicesChanged)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pick(input: Option<&str>, output: Option<&str>) -> Choice {
        Choice { input: input.map(String::from), output: output.map(String::from) }
    }

    #[test]
    fn an_empty_id_means_the_default() {
        assert_eq!(normalize(Some("  ".into())), None);
        assert_eq!(normalize(None), None);
        assert_eq!(normalize(Some("{0.0.1.00000000}.{abc}".into())), Some("{0.0.1.00000000}.{abc}".into()));
    }

    #[test]
    fn only_what_changed_is_reopened() {
        let old = pick(Some("mic"), None);
        assert_eq!(changes(&old, &old), Changed { mic: false, speaker: false });
        assert_eq!(changes(&old, &pick(Some("headset"), None)), Changed { mic: true, speaker: false });
        assert_eq!(changes(&old, &pick(Some("mic"), Some("speakers"))), Changed { mic: true, speaker: true }, "echo cancellation follows the speaker");
    }

    #[test]
    fn devices_serialize_the_way_the_frontend_reads_them() {
        let device = AudioDevice { id: "x".into(), name: "Headset".into(), is_default: true };
        assert_eq!(serde_json::to_string(&device).unwrap(), r#"{"id":"x","name":"Headset","isDefault":true}"#);
    }
}

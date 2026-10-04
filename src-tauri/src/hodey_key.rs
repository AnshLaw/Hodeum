//! The Hodey key (Right Ctrl by default): hold it to talk, or press it with one letter for a command.
//! A key apps almost never use on its own, so nothing needs three-key chords and nothing clashes with
//! app shortcuts (Hodey swallows its own letter presses).

use std::sync::mpsc::{self, Sender};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::{AppHandle, Emitter};

/// Holding this long, without pressing anything else, starts talking.
pub const HOLD: Duration = Duration::from_millis(300);
const TICK: Duration = Duration::from_millis(25);
const VK_RCONTROL: u32 = 0xA3;
const VK_RMENU: u32 = 0xA5;
const VK_A: u32 = 0x41;
const VK_Z: u32 = 0x5A;

/// Letters that do something with the Hodey key. Every other key passes through untouched.
pub const POINT_AND_ASK: char = 'P';
pub const SHOW_HIDE: char = 'H';
pub const OPEN_APP: char = 'A';
const BOUND: [char; 3] = [POINT_AND_ASK, SHOW_HIDE, OPEN_APP];

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum HodeyKey {
    RightCtrl,
    RightAlt,
}

impl HodeyKey {
    fn vk(self) -> u32 {
        match self {
            HodeyKey::RightCtrl => VK_RCONTROL,
            HodeyKey::RightAlt => VK_RMENU,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Action {
    TalkStart,
    TalkEnd,
    Command(char),
}

/// Pure gesture state: fed key events and clock ticks, it says what to do and what to swallow.
pub struct Gesture {
    key: HodeyKey,
    down_since: Option<Instant>,
    /// Another key was pressed during this hold, so it isn't a talk gesture.
    chorded: bool,
    talking: bool,
    swallowed: Option<u32>,
}

impl Gesture {
    pub fn new(key: HodeyKey) -> Self {
        Self { key, down_since: None, chorded: false, talking: false, swallowed: None }
    }

    pub fn set_key(&mut self, key: HodeyKey) {
        *self = Self::new(key);
    }

    /// One key event. Returns the actions, and whether to hide this event from other apps.
    pub fn on_key(&mut self, vk: u32, down: bool, now: Instant) -> (Option<Action>, bool) {
        if vk == self.key.vk() {
            return (self.on_hodey_key(down, now), false);
        }
        if !down {
            let swallow = self.swallowed == Some(vk);
            if swallow {
                self.swallowed = None;
            }
            return (None, swallow);
        }
        if self.down_since.is_none() || self.talking {
            return (None, false);
        }
        self.chorded = true;
        let letter = (VK_A..=VK_Z).contains(&vk).then(|| char::from_u32(vk)).flatten();
        match letter.filter(|c| BOUND.contains(c)) {
            Some(command) => {
                self.swallowed = Some(vk);
                (Some(Action::Command(command)), true)
            }
            None => (None, false),
        }
    }

    fn on_hodey_key(&mut self, down: bool, now: Instant) -> Option<Action> {
        if down {
            // Auto-repeat sends more key-downs while held; only the first one starts the clock.
            if self.down_since.is_none() {
                self.down_since = Some(now);
                self.chorded = false;
            }
            return None;
        }
        let was_talking = self.talking;
        self.down_since = None;
        self.talking = false;
        was_talking.then_some(Action::TalkEnd)
    }

    /// Time passing: a long enough solo hold starts talking.
    pub fn on_tick(&mut self, now: Instant) -> Option<Action> {
        let held = self.down_since.is_some_and(|since| now.duration_since(since) >= HOLD);
        if held && !self.chorded && !self.talking {
            self.talking = true;
            return Some(Action::TalkStart);
        }
        None
    }
}

static GESTURE: OnceLock<Mutex<Gesture>> = OnceLock::new();
static ACTIONS: OnceLock<Sender<Action>> = OnceLock::new();

fn gesture() -> &'static Mutex<Gesture> {
    GESTURE.get_or_init(|| Mutex::new(Gesture::new(HodeyKey::RightCtrl)))
}

fn send(action: Option<Action>) {
    if let (Some(action), Some(sender)) = (action, ACTIONS.get()) {
        // Fails only at shutdown, when the dispatcher thread is gone.
        let _ = sender.send(action);
    }
}

/// Called from the low-level keyboard hook; must return quickly. True means swallow the event.
pub fn on_key(vk: u32, down: bool) -> bool {
    let Ok(mut state) = gesture().lock() else { return false };
    let (action, swallow) = state.on_key(vk, down, Instant::now());
    drop(state);
    send(action);
    swallow
}

fn dispatch(app: &AppHandle, action: Action) {
    let result = match action {
        Action::TalkStart => crate::voice::hold_start(app),
        Action::TalkEnd => crate::voice::hold_end(app),
        Action::Command(SHOW_HIDE) => Ok(crate::tray::emit_command(app, "toggle-visibility")),
        Action::Command(POINT_AND_ASK) => app.emit(crate::ANNOTATE_EVENT, serde_json::json!({})).map_err(|e| e.to_string()),
        Action::Command(OPEN_APP) => crate::app_window::show(app, None),
        Action::Command(other) => Err(format!("no command for Hodey key + {other}")),
    };
    if let Err(reason) = result {
        eprintln!("Hodey key: {reason}");
    }
}

/// Starts the clock (for hold detection) and the dispatcher that turns gestures into actions.
pub fn spawn(app: AppHandle) -> Result<(), String> {
    let (sender, actions) = mpsc::channel();
    ACTIONS.set(sender).map_err(|_| "the Hodey key is already running".to_string())?;
    thread::spawn(move || {
        for action in actions {
            dispatch(&app, action);
        }
    });
    thread::spawn(|| loop {
        thread::sleep(TICK);
        let action = match gesture().lock() {
            Ok(mut state) => state.on_tick(Instant::now()),
            Err(e) => return eprintln!("Hodey key state poisoned: {e}"),
        };
        send(action);
    });
    Ok(())
}

/// Which key is the Hodey key, from Settings.
#[tauri::command]
pub fn set_hodey_key(key: HodeyKey) -> Result<(), String> {
    gesture().lock().map_err(|e| e.to_string())?.set_key(key);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const H: u32 = 0x48;
    const C: u32 = 0x43;

    fn later(start: Instant, ms: u64) -> Instant {
        start + Duration::from_millis(ms)
    }

    #[test]
    fn holding_alone_talks_until_release() {
        let mut g = Gesture::new(HodeyKey::RightCtrl);
        let t = Instant::now();
        assert_eq!(g.on_key(VK_RCONTROL, true, t), (None, false));
        assert_eq!(g.on_tick(later(t, 100)), None);
        assert_eq!(g.on_key(VK_RCONTROL, true, later(t, 200)), (None, false), "auto-repeat doesn't restart the clock");
        assert_eq!(g.on_tick(later(t, 320)), Some(Action::TalkStart));
        assert_eq!(g.on_tick(later(t, 400)), None);
        assert_eq!(g.on_key(VK_RCONTROL, false, later(t, 2000)), (Some(Action::TalkEnd), false));
    }

    #[test]
    fn a_quick_tap_does_nothing() {
        let mut g = Gesture::new(HodeyKey::RightCtrl);
        let t = Instant::now();
        g.on_key(VK_RCONTROL, true, t);
        assert_eq!(g.on_key(VK_RCONTROL, false, later(t, 120)), (None, false));
        assert_eq!(g.on_tick(later(t, 500)), None);
    }

    #[test]
    fn hodey_key_plus_a_bound_letter_runs_a_command_and_hides_it_from_the_app() {
        let mut g = Gesture::new(HodeyKey::RightCtrl);
        let t = Instant::now();
        g.on_key(VK_RCONTROL, true, t);
        assert_eq!(g.on_key(H, true, later(t, 80)), (Some(Action::Command('H')), true));
        assert_eq!(g.on_key(H, false, later(t, 120)), (None, true));
        assert_eq!(g.on_tick(later(t, 600)), None, "a chord never turns into talking");
    }

    #[test]
    fn other_shortcuts_pass_through_untouched() {
        let mut g = Gesture::new(HodeyKey::RightCtrl);
        let t = Instant::now();
        g.on_key(VK_RCONTROL, true, t);
        assert_eq!(g.on_key(C, true, later(t, 80)), (None, false), "Right Ctrl + C still copies");
        g.on_key(VK_RCONTROL, false, later(t, 150));
        assert_eq!(g.on_key(H, true, later(t, 200)), (None, false), "letters without the Hodey key are untouched");
    }

    #[test]
    fn the_key_can_be_changed() {
        let mut g = Gesture::new(HodeyKey::RightCtrl);
        g.set_key(HodeyKey::RightAlt);
        let t = Instant::now();
        g.on_key(VK_RMENU, true, t);
        assert_eq!(g.on_tick(later(t, 400)), Some(Action::TalkStart));
    }
}

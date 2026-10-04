//! Keeps the notch and the guidance overlay above every app window, like a real screen notch.
//!
//! Both start topmost (tauri.conf.json), but that alone is lost whenever another topmost or borderless
//! fullscreen window is raised over them. A keeper thread puts them back at the top of the topmost band
//! (overlay first, then the notch above it, so the notch stays clickable) whenever the foreground window
//! changes, whenever the learner's window changes, moves, resizes or goes fullscreen, and from a cheap
//! backstop that does so only when another window has actually come over them. It never activates,
//! shows or hides them.
//!
//! Out of scope: exclusive-fullscreen DirectX games own the display while they run, so nothing can be
//! drawn over them. Borderless fullscreen apps are ordinary windows and are covered.

mod zorder;

#[cfg(test)]
mod test_windows;

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Manager};
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
use windows::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, GetMessageW, KillTimer, PeekMessageW, PostThreadMessageW, SetTimer, EVENT_SYSTEM_FOREGROUND, MSG, PM_NOREMOVE,
    WINEVENT_OUTOFCONTEXT, WM_APP, WM_TIMER,
};

use crate::dock::geometry::PxRect;
use crate::perception::model::RectDto;
use crate::surfaces::{NOTCH, OVERLAY};

/// How often the backstop looks for a window that has come over the surfaces.
const BACKSTOP: Duration = Duration::from_millis(1500);
/// Thread message: put the surfaces back on top now (the foreground window changed).
const REASSERT: u32 = WM_APP + 0x70;
/// Thread message: put them back only if something covers them (the learner's window changed, the
/// notch was shown again).
const CHECK: u32 = WM_APP + 0x71;
/// A Win32 error arrives inside an HRESULT; the code is its low word.
const WIN32_CODE_MASK: u32 = 0xFFFF;

/// The keeper thread's id once its message queue exists; 0 before that.
static KEEPER_THREAD: AtomicU32 = AtomicU32::new(0);
/// At most one message of each kind waits, so a burst of foreground changes is one re-assert.
static REASSERT_QUEUED: AtomicBool = AtomicBool::new(false);
static CHECK_QUEUED: AtomicBool = AtomicBool::new(false);

/// The two always-on-top surfaces, as raw handles (read once on the main thread).
#[derive(Debug, Clone, Copy, PartialEq)]
struct Surfaces {
    overlay: isize,
    notch: isize,
}

impl Surfaces {
    /// On the main thread a window's handle is read directly, not fetched through the event loop.
    fn read(app: &AppHandle) -> Result<Self, String> {
        let handle = |label: &str| -> Result<isize, String> {
            let window = app.get_webview_window(label).ok_or_else(|| format!("window `{label}` is missing"))?;
            Ok(window.hwnd().map_err(|e| e.to_string())?.0 as isize)
        };
        Ok(Self { overlay: handle(OVERLAY)?, notch: handle(NOTCH)? })
    }

    fn overlay(&self) -> HWND {
        HWND(self.overlay as *mut _)
    }

    fn notch(&self) -> HWND {
        HWND(self.notch as *mut _)
    }

    /// Bottom to top: the overlay first, so the notch ends up above it and stays clickable.
    fn bottom_up(&self) -> [(&'static str, HWND); 2] {
        [("overlay", self.overlay()), ("notch", self.notch())]
    }
}

/// A window's bounds in whole physical px.
fn px_rect(bounds: &RectDto) -> PxRect {
    PxRect {
        x: bounds.x.round() as i32,
        y: bounds.y.round() as i32,
        width: bounds.width.max(0.0).round() as u32,
        height: bounds.height.max(0.0).round() as u32,
    }
}

/// "Win32 error 1400: Invalid window handle."
fn win32_error(error: &windows::core::Error) -> String {
    format!("Win32 error {}: {}", error.code().0 as u32 & WIN32_CODE_MASK, error.message())
}

/// Re-asserts and checks the z-order on the keeper thread.
struct Keeper {
    surfaces: Surfaces,
    /// Windows a re-assert couldn't get above (Start, the touch keyboard, Magnifier: higher z-bands).
    /// They aren't retried until they stop covering the surfaces.
    unbeatable: Vec<isize>,
    /// The last failure logged, so one that repeats on every check is logged once.
    last_failure: Option<String>,
}

impl Keeper {
    fn new(surfaces: Surfaces) -> Self {
        Self { surfaces, unbeatable: Vec::new(), last_failure: None }
    }

    /// Puts both surfaces back on top, bottom-up.
    fn reassert(&mut self) {
        let failures: Vec<String> = self
            .surfaces
            .bottom_up()
            .into_iter()
            .filter_map(|(label, hwnd)| zorder::raise(hwnd).err().map(|error| format!("the {label} ({})", win32_error(&error))))
            .collect();
        let failure = (!failures.is_empty()).then(|| format!("SetWindowPos couldn't put {} back on top", failures.join(" or ")));
        if let Some(message) = fresh_failure(&mut self.last_failure, failure) {
            log::warn!("{message}");
        }
    }

    /// Puts them back on top only if something now covers them (or they left the topmost band).
    fn check(&mut self) {
        let survey = zorder::survey(self.surfaces.overlay(), self.surfaces.notch());
        if !zorder::worth_reasserting(&survey, &self.unbeatable) {
            if survey.coverers.is_empty() {
                self.unbeatable.clear();
            }
            return;
        }
        self.reassert();
        // Whatever is still above sits in a higher band (or raised itself straight back): leave it be.
        self.unbeatable = zorder::survey(self.surfaces.overlay(), self.surfaces.notch()).coverers;
    }

    fn handle(&mut self, message: &MSG) {
        match message.message {
            REASSERT => {
                REASSERT_QUEUED.store(false, Ordering::SeqCst);
                self.reassert();
            }
            CHECK => {
                CHECK_QUEUED.store(false, Ordering::SeqCst);
                self.check();
            }
            WM_TIMER => self.check(),
            _ => {
                // SAFETY: a message this thread just received.
                unsafe { DispatchMessageW(message) };
            }
        }
    }
}

/// What to log for `failure` (None when every surface was put back): only a failure that differs from
/// the last one, so a window that can't be raised doesn't flood the log every backstop tick.
fn fresh_failure(last: &mut Option<String>, failure: Option<String>) -> Option<String> {
    let fresh = failure.as_ref().filter(|message| last.as_ref() != Some(*message)).cloned();
    *last = failure;
    fresh
}

/// Queues `message` for the keeper unless one is already waiting. Never blocks.
fn post(message: u32, queued: &AtomicBool) {
    if queued.swap(true, Ordering::SeqCst) {
        return;
    }
    let thread = KEEPER_THREAD.load(Ordering::SeqCst);
    if thread == 0 {
        // Not running: it re-asserts as it starts, and a keeper that failed to start was logged then.
        queued.store(false, Ordering::SeqCst);
        return;
    }
    // SAFETY: posting to a thread's queue has no preconditions; a thread that has gone simply fails.
    if let Err(error) = unsafe { PostThreadMessageW(thread, message, WPARAM(0), LPARAM(0)) } {
        queued.store(false, Ordering::SeqCst);
        log::warn!("couldn't reach the thread keeping the notch and overlay on top: {}", win32_error(&error));
    }
}

/// The foreground window changed: whatever came forward may now be above the surfaces. Runs on the
/// keeper thread (an out-of-context hook), so it only queues the work for the message loop.
unsafe extern "system" fn on_foreground(_hook: HWINEVENTHOOK, _event: u32, _hwnd: HWND, _object: i32, _child: i32, _thread: u32, _time: u32) {
    post(REASSERT, &REASSERT_QUEUED);
}

/// Makes Windows create this thread's message queue, so messages can be posted to it.
fn create_queue() {
    let mut message = MSG::default();
    // SAFETY: peeks into a valid MSG without removing anything; the result only says whether one waited.
    let _ = unsafe { PeekMessageW(&mut message, None, WM_APP, WM_APP, PM_NOREMOVE) };
}

fn hook_foreground() -> Result<HWINEVENTHOOK, String> {
    // SAFETY: an out-of-context hook: Windows calls `on_foreground` on this thread as it pumps messages.
    let hook = unsafe { SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, None, Some(on_foreground), 0, 0, WINEVENT_OUTOFCONTEXT) };
    if hook.is_invalid() {
        return Err(format!("couldn't watch for foreground changes ({})", win32_error(&windows::core::Error::from_thread())));
    }
    Ok(hook)
}

fn start_backstop() -> Result<usize, String> {
    // SAFETY: a thread timer: WM_TIMER arrives in this thread's queue.
    let timer = unsafe { SetTimer(None, 0, BACKSTOP.as_millis() as u32, None) };
    if timer == 0 {
        return Err(format!("couldn't start the backstop check ({})", win32_error(&windows::core::Error::from_thread())));
    }
    Ok(timer)
}

fn pump(keeper: &mut Keeper) -> Result<(), String> {
    let mut message = MSG::default();
    loop {
        // SAFETY: a valid MSG, filled from this thread's own queue.
        match unsafe { GetMessageW(&mut message, None, 0, 0) }.0 {
            -1 => return Err(win32_error(&windows::core::Error::from_thread())),
            0 => return Ok(()),
            _ => keeper.handle(&message),
        }
    }
}

fn release(hook: Option<HWINEVENTHOOK>, timer: Option<usize>) {
    // SAFETY: the hook and the timer were created by this thread.
    unsafe {
        if hook.is_some_and(|hook| !UnhookWinEvent(hook).as_bool()) {
            log::warn!("couldn't remove the foreground hook");
        }
        if let Some(Err(error)) = timer.map(|timer| KillTimer(None, timer)) {
            log::warn!("couldn't stop the backstop timer: {}", win32_error(&error));
        }
    }
}

/// The keeper thread: hooks foreground changes, runs the backstop and handles requests.
fn run(surfaces: Surfaces) {
    create_queue();
    // SAFETY: GetCurrentThreadId has no preconditions.
    KEEPER_THREAD.store(unsafe { GetCurrentThreadId() }, Ordering::SeqCst);
    let hook = hook_foreground().inspect_err(|error| log::warn!("{error}; the backstop still runs")).ok();
    let timer = start_backstop().inspect_err(|error| log::warn!("{error}")).ok();
    log::info!("keeping the notch and overlay above other windows (on foreground changes, and checked every {} ms)", BACKSTOP.as_millis());
    let mut keeper = Keeper::new(surfaces);
    keeper.reassert();
    if let Err(error) = pump(&mut keeper) {
        log::error!("stopped keeping the notch and overlay on top: {error}");
    }
    KEEPER_THREAD.store(0, Ordering::SeqCst);
    release(hook, timer);
}

/// Starts keeping the notch and overlay on top. Call on the main thread once both are shown.
pub fn start(app: &AppHandle) -> Result<(), String> {
    let surfaces = Surfaces::read(app)?;
    thread::Builder::new()
        .name("hodeum-topmost".into())
        .spawn(move || run(surfaces))
        .map(|_| ())
        .map_err(|error| format!("couldn't start the thread keeping the notch and overlay on top: {error}"))
}

/// Asks the keeper to put the surfaces back on top if anything covers them; returns at once.
pub fn request_check() {
    post(CHECK, &CHECK_QUEUED);
}

#[cfg(test)]
mod tests {
    use super::*;
    use test_windows::{patch, TestWindow};
    use windows::Win32::UI::WindowsAndMessaging::IsWindowVisible;

    fn surfaces_of(overlay: &TestWindow, notch: &TestWindow) -> Surfaces {
        Surfaces { overlay: overlay.id(), notch: notch.id() }
    }

    #[test]
    fn reasserts_the_overlay_first_so_the_notch_ends_on_top() {
        let surfaces = Surfaces { overlay: 1, notch: 2 };
        let order: Vec<&str> = surfaces.bottom_up().iter().map(|(label, _)| *label).collect();
        assert_eq!(order, ["overlay", "notch"]);
        assert_eq!(surfaces.bottom_up()[0].1, surfaces.overlay());
        assert_eq!(surfaces.bottom_up()[1].1, surfaces.notch());
    }

    #[test]
    fn a_check_puts_covered_surfaces_back_on_top_in_order() {
        let overlay = TestWindow::new(patch(6, 0, 0, 1000, 600), None).show();
        let notch = TestWindow::new(patch(6, 300, 0, 400, 200), None).show();
        let rival = TestWindow::new(patch(6, 100, 50, 600, 400), None).show();
        zorder::raise(rival.0).expect("raise the rival");
        let mut keeper = Keeper::new(surfaces_of(&overlay, &notch));

        keeper.check();

        assert_eq!(zorder::survey(overlay.0, notch.0), zorder::Survey::default());
        assert!(keeper.unbeatable.is_empty(), "a plain topmost window is beaten");
        assert_eq!(keeper.last_failure, None);
    }

    #[test]
    fn a_reassert_leaves_a_hidden_notch_hidden() {
        let overlay = TestWindow::new(patch(7, 0, 0, 1000, 600), None).show();
        let notch = TestWindow::new(patch(7, 300, 0, 400, 200), None);
        let mut keeper = Keeper::new(surfaces_of(&overlay, &notch));

        keeper.reassert();

        // SAFETY: IsWindowVisible tolerates any handle.
        assert!(!unsafe { IsWindowVisible(notch.0) }.as_bool());
        assert!(zorder::windows_above(overlay.0).contains(&notch.0));
    }

    #[test]
    fn a_failed_reassert_names_the_surface_and_the_win32_error() {
        let gone = TestWindow::new(patch(8, 0, 0, 100, 100), None);
        let stale = gone.id();
        drop(gone);
        let mut keeper = Keeper::new(Surfaces { overlay: stale, notch: stale });

        keeper.reassert();

        let failure = keeper.last_failure.expect("the failure is kept");
        assert!(failure.contains("overlay") && failure.contains("notch"), "{failure}");
        assert!(failure.contains("Win32 error 1400"), "invalid window handle: {failure}");
    }

    #[test]
    fn rounds_a_windows_bounds_to_whole_pixels() {
        let bounds = RectDto { x: -2000.4, y: 10.6, width: 1199.5, height: 800.2 };
        assert_eq!(px_rect(&bounds), PxRect { x: -2000, y: 11, width: 1200, height: 800 });
        let collapsed = RectDto { x: 0.0, y: 0.0, width: -3.0, height: 0.0 };
        assert_eq!(px_rect(&collapsed), PxRect { x: 0, y: 0, width: 0, height: 0 });
    }

    #[test]
    fn a_repeated_failure_is_logged_once_and_again_after_a_success() {
        let mut last = None;
        assert_eq!(fresh_failure(&mut last, Some("stuck".into())), Some("stuck".into()));
        assert_eq!(fresh_failure(&mut last, Some("stuck".into())), None);
        assert_eq!(fresh_failure(&mut last, Some("other".into())), Some("other".into()));
        assert_eq!(fresh_failure(&mut last, None), None);
        assert_eq!(fresh_failure(&mut last, Some("other".into())), Some("other".into()));
    }
}

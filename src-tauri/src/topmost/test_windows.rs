//! Real top-level windows for tests: invisible (alpha 0), click-through, never activated and far
//! off-screen, so a test run never shows anything or takes focus. Each test keeps to its own patch of
//! the desktop (`patch`), so tests running side by side never overlap each other's windows.

use std::sync::OnceLock;

use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::HiDpi::{SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, RegisterClassW, SetLayeredWindowAttributes, ShowWindow, LWA_ALPHA,
    SW_SHOWNOACTIVATE, WNDCLASSW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_TRANSPARENT, WS_POPUP,
};

use crate::dock::geometry::PxRect;

const CLASS: PCWSTR = w!("HodeumTopmostTestWindow");
/// Left of and above any real monitor (and clear of minimized windows, parked at -32000).
const OFF_SCREEN_X: i32 = -30_000;
const OFF_SCREEN_Y: i32 = -30_000;
/// Width of one test's patch of the desktop.
const PATCH_STEP: i32 = 2_000;
/// Fully transparent.
const INVISIBLE: u8 = 0;

/// A rect in test patch `index`, at (x, y) within it.
pub fn patch(index: i32, x: i32, y: i32, width: u32, height: u32) -> PxRect {
    PxRect { x: OFF_SCREEN_X + index * PATCH_STEP + x, y: OFF_SCREEN_Y + y, width, height }
}

unsafe extern "system" fn window_proc(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    // SAFETY: forwards exactly what Windows passed in.
    unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
}

fn instance() -> HINSTANCE {
    // SAFETY: GetModuleHandleW(None) returns this executable's own module.
    unsafe { GetModuleHandleW(None) }.expect("the test executable's module").into()
}

fn register_class() {
    static REGISTERED: OnceLock<u16> = OnceLock::new();
    REGISTERED.get_or_init(|| {
        let class = WNDCLASSW { lpfnWndProc: Some(window_proc), hInstance: instance(), lpszClassName: CLASS, ..Default::default() };
        // SAFETY: `class` is fully initialised and its strings are 'static.
        let atom = unsafe { RegisterClassW(&class) };
        assert_ne!(atom, 0, "couldn't register the test window class: {}", windows::core::Error::from_thread());
        atom
    });
}

/// A test window, destroyed when dropped.
pub struct TestWindow(pub HWND);

impl TestWindow {
    /// A hidden topmost window at `rect` in physical px; `owner` makes it a popup owned by that window.
    pub fn new(rect: PxRect, owner: Option<HWND>) -> Self {
        register_class();
        // SAFETY: plain thread-scoped calls; the class is registered above and every argument is valid.
        unsafe {
            // Physical px like the app's own (per-monitor aware) windows, whatever the scale here.
            let previous = SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
            assert!(!previous.0.is_null(), "couldn't make the test thread per-monitor DPI aware");
            let style = WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_LAYERED | WS_EX_TRANSPARENT;
            let (width, height) = (rect.width as i32, rect.height as i32);
            let hwnd = CreateWindowExW(style, CLASS, w!(""), WS_POPUP, rect.x, rect.y, width, height, owner, None, Some(instance()), None)
                .expect("couldn't create a test window");
            SetLayeredWindowAttributes(hwnd, COLORREF(0), INVISIBLE, LWA_ALPHA).expect("couldn't make a test window invisible");
            Self(hwnd)
        }
    }

    /// Shows it without activating it.
    pub fn show(self) -> Self {
        // SAFETY: a window this thread created. The result is the previous visibility, not an error.
        let _ = unsafe { ShowWindow(self.0, SW_SHOWNOACTIVATE) };
        self
    }

    pub fn id(&self) -> isize {
        self.0 .0 as isize
    }
}

impl Drop for TestWindow {
    fn drop(&mut self) {
        // SAFETY: a window this thread created.
        if let Err(error) = unsafe { DestroyWindow(self.0) } {
            eprintln!("couldn't destroy a test window: {error}");
        }
    }
}

// Hodeum is a windowed app in every build: no console opens beside it (closing one would quit it),
// even for a debug exe started from a shortcut. Logs go to %LOCALAPPDATA%\com.hodeum.app\logs\hodeum.log,
// and `tauri dev` still shows them because the child inherits its terminal's output handles.
#![windows_subsystem = "windows"]

fn main() {
    hodeum_lib::run();
}

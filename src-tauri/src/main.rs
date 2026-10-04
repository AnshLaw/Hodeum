// Release builds are a windowed app: no console opens beside Hodeum, so closing one can't quit it.
// Debug builds keep the console for logs during development.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    hodeum_lib::run();
}

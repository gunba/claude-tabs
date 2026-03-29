const COMMANDS: &[&str] = &[
    "spawn", "write", "read", "resize", "kill", "exitstatus", "destroy", "get_child_pid",
    "drain_output", "start_pty_recording", "stop_pty_recording",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}

use std::fs;
use std::process::Command;

const EXAMPLE: &str = include_str!("../../../examples/orders-payments/workspace.dsl");

fn temp_file(name: &str, contents: &str) -> String {
    let path = std::env::temp_dir().join(format!("kontur-{}-{name}.dsl", std::process::id()));
    fs::write(&path, contents).unwrap();
    path.to_string_lossy().into_owned()
}

fn invoke(args: &[&str]) -> (i32, serde_json::Value) {
    let output = Command::new(env!("CARGO_BIN_EXE_kontur"))
        .args(args)
        .output()
        .unwrap();
    (
        output.status.code().unwrap_or(128),
        serde_json::from_slice(&output.stdout).expect("one JSON document on stdout"),
    )
}

#[test]
fn successful_view_emits_versioned_renderer_neutral_json() {
    let path = temp_file("success", EXAMPLE);
    let (status, json) = invoke(&["view", &path, "--view", "orders-payments"]);
    let _ = fs::remove_file(path);
    assert_eq!(status, 0);
    assert_eq!(json["schemaVersion"], 1);
    assert_eq!(json["status"], "ok");
    assert_eq!(json["view"]["elements"].as_array().unwrap().len(), 6);
    assert_eq!(json["view"]["boundaries"].as_array().unwrap().len(), 2);
    assert_eq!(json["view"]["relationships"].as_array().unwrap().len(), 8);
    assert!(json["view"]["elements"][0]["source"]["line"].is_number());
}

#[test]
fn invalid_source_exits_nonzero_with_diagnostic_without_partial_view() {
    let path = temp_file("invalid", "workspace \"broken");
    let (status, json) = invoke(&["view", &path, "--view", "orders-payments"]);
    let _ = fs::remove_file(path);
    assert_ne!(status, 0);
    assert_eq!(json["status"], "error");
    assert!(json["view"].is_null());
    assert_eq!(json["diagnostics"][0]["code"], "syntax");
    assert!(json["diagnostics"][0]["location"]["line"].is_number());
}

#[test]
fn host_and_argument_errors_are_json_and_have_no_fabricated_location() {
    let (status, missing) = invoke(&["view", "/definitely/not/a/kontur-file.dsl", "--view", "x"]);
    assert_ne!(status, 0);
    assert_eq!(missing["diagnostics"][0]["code"], "host");
    assert!(missing["diagnostics"][0]["location"].is_null());

    let (status, arguments) = invoke(&[]);
    assert_ne!(status, 0);
    assert_eq!(arguments["status"], "error");
    assert_eq!(arguments["diagnostics"][0]["code"], "host");
}

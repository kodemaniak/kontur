use std::fs;
use std::io::{ErrorKind, Write};
use std::process::{Command, Output, Stdio};

use serde_json::{Value, json};

fn dsl(label: &str) -> String {
    format!(
        r#"workspace "Δ workspace" {{
    !impliedRelationships false
    model {{
        user = person "User"
        system = softwareSystem "System" "System description" {{
            app = container "Application"
        }}
        relationship_id = user -> app "{label}"
    }}
    views {{ container system "main" {{ include user app }} }}
}}"#
    )
}

fn frame(revision: u64, document_uri: &str, text: &str) -> Vec<u8> {
    json_frame(json!({
        "schemaVersion": 1,
        "revision": revision,
        "documentUri": document_uri,
        "text": text,
    }))
}

fn json_frame(value: Value) -> Vec<u8> {
    let mut frame = serde_json::to_vec(&value).unwrap();
    frame.push(b'\n');
    frame
}

fn protocol_request() -> Value {
    json!({
        "schemaVersion": 1,
        "revision": 1,
        "documentUri": "file:///test.dsl",
        "text": dsl("test"),
    })
}

fn run_service(frames: &[Vec<u8>], split_first_frame: bool) -> (Output, Option<ErrorKind>) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_kontur"))
        .arg("preview-service")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let mut input_error = None;
    for (index, frame) in frames.iter().enumerate() {
        let chunks: Vec<&[u8]> = if split_first_frame && index == 0 {
            frame.chunks(1).collect()
        } else {
            vec![frame]
        };
        for chunk in chunks {
            if let Err(error) = stdin.write_all(chunk).and_then(|()| stdin.flush()) {
                input_error = Some(error.kind());
                break;
            }
        }
        if input_error.is_some() {
            break;
        }
    }
    drop(stdin);
    let output = child.wait_with_output().unwrap();
    (output, input_error)
}

fn responses(output: &Output) -> Vec<Value> {
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|line| serde_json::from_str(line).expect("one JSON response per line"))
        .collect()
}

fn expect_protocol_failure(frame: &[u8]) {
    let (output, _) = run_service(&[frame.to_vec()], false);
    assert!(
        !output.status.success(),
        "invalid protocol frame was accepted"
    );
    assert!(
        output.stdout.is_empty(),
        "protocol failure fabricated a response"
    );
    assert!(
        !output.stderr.is_empty(),
        "protocol failure needs an operational diagnostic"
    );
}

#[test]
fn preview_service_compiles_chunked_snapshots_without_reading_or_changing_the_file() {
    let path =
        std::env::temp_dir().join(format!("kontur-preview-service-{}.dsl", std::process::id()));
    let uri = format!("file://{}", path.display());
    let saved_text = dsl("saved label");
    let buffer_text = dsl("unsaved Δ label");
    fs::write(&path, &saved_text).unwrap();
    let missing_uri = format!("file:///kontur-missing-{}.dsl", std::process::id());
    let requests = [
        frame(1, &uri, &buffer_text),
        frame(2, &missing_uri, &dsl("nonexistent source")),
    ];

    let (output, input_error) = run_service(&requests, true);
    let unchanged_file = fs::read_to_string(&path).unwrap();
    let _ = fs::remove_file(path);
    assert!(
        output.status.success(),
        "service should accept snapshots: {}",
        String::from_utf8_lossy(&output.stdout)
    );
    assert_eq!(
        input_error, None,
        "service closed stdin before all frames arrived"
    );
    assert_eq!(
        unchanged_file, saved_text,
        "service must not modify the saved file"
    );

    let responses = responses(&output);
    assert_eq!(responses.len(), 2);
    assert_eq!(responses[0]["revision"], 1);
    assert_eq!(responses[0]["documentUri"], uri);
    assert_eq!(responses[0]["result"]["status"], "ok", "{}", responses[0]);
    assert_eq!(
        responses[0]["result"]["view"]["relationships"][0]["id"],
        "relationship_id"
    );
    assert_eq!(
        responses[0]["result"]["view"]["relationships"][0]["label"],
        "unsaved Δ label"
    );
    assert_eq!(
        responses[0]["result"]["view"]["relationships"][0]["source"]["file"],
        uri
    );
    assert_eq!(
        responses[0]["result"]["view"]["relationships"][0]["source"]["line"],
        8
    );
    assert_eq!(
        responses[0]["result"]["view"]["relationships"][0]["source"]["column"],
        9
    );
    assert_eq!(
        responses[0]["result"]["view"]["relationships"][0]["source"]["endColumn"],
        buffer_text.lines().nth(7).unwrap().chars().count() + 1
    );
    assert_eq!(responses[1]["revision"], 2);
    assert_eq!(responses[1]["documentUri"], missing_uri);
    assert_eq!(responses[1]["result"]["status"], "ok");
    assert_eq!(
        responses[1]["result"]["view"]["relationships"][0]["source"]["file"],
        missing_uri
    );
}

#[test]
fn preview_service_recovers_after_a_source_error_without_restarting() {
    let uri = format!("file:///kontur-recovery-{}.dsl", std::process::id());
    let valid = dsl("before");
    let invalid = valid.replace(
        "!impliedRelationships false",
        "!impliedRelationships false\n    !unsupportedDirective",
    );
    let corrected = dsl("after");
    let requests = [
        frame(1, &uri, &valid),
        frame(2, &uri, &invalid),
        frame(3, &uri, &corrected),
    ];

    let (output, input_error) = run_service(&requests, false);
    assert!(
        output.status.success(),
        "source errors should not stop the service: {}",
        String::from_utf8_lossy(&output.stdout)
    );
    assert_eq!(
        input_error, None,
        "service closed stdin before all frames arrived"
    );
    let responses = responses(&output);
    assert_eq!(responses.len(), 3);
    assert_eq!(responses[0]["result"]["status"], "ok");
    assert_eq!(responses[1]["result"]["status"], "error");
    assert_eq!(
        responses[1]["result"]["diagnostics"][0]["code"],
        "unsupported-feature"
    );
    assert_eq!(
        responses[1]["result"]["diagnostics"][0]["location"]["file"],
        uri
    );
    assert_eq!(
        responses[1]["result"]["diagnostics"][0]["location"]["line"],
        3
    );
    assert!(responses[1]["result"].get("view").is_none());
    assert_eq!(responses[2]["result"]["status"], "ok");
    assert_eq!(responses[2]["revision"], 3);
    assert_eq!(
        responses[2]["result"]["view"]["relationships"][0]["label"],
        "after"
    );
}

#[test]
fn preview_service_rejects_malformed_and_truncated_frames_but_accepts_clean_eof() {
    expect_protocol_failure(b"{\n");
    let truncated = frame(1, "file:///truncated.dsl", &dsl("incomplete"));
    expect_protocol_failure(&truncated[..truncated.len() - 1]);

    let (output, _) = run_service(&[], false);
    assert!(output.status.success());
    assert!(output.stdout.is_empty());
}

#[test]
fn preview_service_rejects_unknown_schema_versions() {
    let mut request = protocol_request();
    request["schemaVersion"] = json!(2);
    expect_protocol_failure(&json_frame(request));
}

#[test]
fn preview_service_rejects_unknown_envelope_fields() {
    let mut request = protocol_request();
    request["unexpected"] = json!(true);
    expect_protocol_failure(&json_frame(request));
}

#[test]
fn preview_service_rejects_zero_or_unsafe_revisions_and_empty_uris() {
    for (field, value) in [
        ("revision", json!(0)),
        ("revision", json!(9_007_199_254_740_992_u64)),
        ("documentUri", json!("")),
    ] {
        let mut request = protocol_request();
        request[field] = value;
        expect_protocol_failure(&json_frame(request));
    }
}

#[test]
fn preview_service_rejects_wrong_field_types_and_missing_fields() {
    let mut wrong_type = protocol_request();
    wrong_type["revision"] = json!("1");
    expect_protocol_failure(&json_frame(wrong_type));

    let mut missing = protocol_request();
    missing.as_object_mut().unwrap().remove("text");
    expect_protocol_failure(&json_frame(missing));
}

#[test]
fn preview_service_rejects_oversized_input_frames() {
    let oversized_text = "x".repeat(5 * 1024 * 1024);
    expect_protocol_failure(&frame(1, "file:///large-input.dsl", &oversized_text));
}

#[test]
fn preview_service_rejects_oversized_result_frames() {
    let large_uri = format!("file://{}", "u".repeat(1_100_000));
    let oversized_result = frame(1, &large_uri, &dsl("large output"));
    let (output, _) = run_service(&[oversized_result], false);
    assert!(
        !output.status.success(),
        "oversized result frame was written"
    );
    assert!(
        output.stdout.is_empty(),
        "oversized result was partially written"
    );
    assert!(
        !output.stderr.is_empty(),
        "oversized result needs an operational diagnostic"
    );
}

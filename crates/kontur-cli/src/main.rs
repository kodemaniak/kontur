mod protocol;

use std::fs;
use std::io::{self, BufRead, Write};

use kontur_core::diagnostic::{Diagnostic, DiagnosticCode};
use kontur_core::model::ViewKey;
use kontur_core::source::SourceFile;
use kontur_core::{compile_single_view, compile_view};
use protocol::{PreviewRequest, PreviewResponse, PreviewResult};

const MAX_FRAME_BYTES: usize = 5 * 1024 * 1024;
const MAX_SAFE_REVISION: u64 = 9_007_199_254_740_991;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.as_slice() == ["preview-service"] {
        if let Err(error) = preview_service() {
            eprintln!("kontur preview-service: {error}");
            std::process::exit(2);
        }
        return;
    }

    let (status, result) = run(&args);
    let stdout = io::stdout();
    let mut output = stdout.lock();
    serde_json::to_writer(&mut output, &result).expect("serializing the CLI result cannot fail");
    writeln!(output).expect("writing the CLI result cannot fail");
    if status != 0 {
        std::process::exit(status);
    }
}

fn preview_service() -> Result<(), String> {
    let stdin = io::stdin();
    let mut input = stdin.lock();
    let stdout = io::stdout();
    let mut output = stdout.lock();

    loop {
        let Some(frame) = read_frame(&mut input)? else {
            return Ok(());
        };

        let request: PreviewRequest =
            serde_json::from_slice(&frame).map_err(|_| "invalid request envelope")?;
        if request.schema_version != 1 {
            return Err("unsupported request schema version".into());
        }
        if request.revision == 0 || request.revision > MAX_SAFE_REVISION {
            return Err("request revision must be a positive JavaScript-safe integer".into());
        }
        if request.document_uri.is_empty() {
            return Err("request documentUri must be nonempty".into());
        }
        let source = SourceFile::new(
            request.document_uri.clone(),
            request.document_uri.clone(),
            request.text,
        );
        let result = match compile_single_view(&source) {
            Ok(view) => PreviewResult::success(&view, &source),
            Err(diagnostics) => PreviewResult::failure(&diagnostics, Some(&source)),
        };
        let response = PreviewResponse {
            schema_version: 1,
            revision: request.revision,
            document_uri: request.document_uri,
            result,
        };
        write_response(&mut output, &response)?;
    }
}

fn read_frame(input: &mut impl BufRead) -> Result<Option<Vec<u8>>, String> {
    let mut frame = Vec::new();
    loop {
        let (count, complete) = {
            let available = input
                .fill_buf()
                .map_err(|_| "could not read request frame")?;
            if available.is_empty() {
                return if frame.is_empty() {
                    Ok(None)
                } else {
                    Err("incomplete request frame".into())
                };
            }
            let newline = available.iter().position(|byte| *byte == b'\n');
            let count = newline.map_or(available.len(), |index| index + 1);
            if frame.len().saturating_add(count) > MAX_FRAME_BYTES {
                return Err("request frame exceeds 5 MiB".into());
            }
            frame.extend_from_slice(&available[..count]);
            (count, newline.is_some())
        };
        input.consume(count);
        if complete {
            frame.pop();
            return Ok(Some(frame));
        }
    }
}

fn write_response(output: &mut impl Write, response: &PreviewResponse) -> Result<(), String> {
    let mut frame = BoundedFrame::new(MAX_FRAME_BYTES);
    if let Err(error) = serde_json::to_writer(&mut frame, response) {
        return Err(if frame.exceeded {
            "response frame exceeds 5 MiB".into()
        } else {
            error.to_string()
        });
    }
    if frame.write_all(b"\n").is_err() {
        return Err("response frame exceeds 5 MiB".into());
    }
    output
        .write_all(&frame.bytes)
        .map_err(|_| "could not write response frame")?;
    output
        .flush()
        .map_err(|_| "could not flush response frame")?;
    Ok(())
}

struct BoundedFrame {
    bytes: Vec<u8>,
    limit: usize,
    exceeded: bool,
}

impl BoundedFrame {
    fn new(limit: usize) -> Self {
        Self {
            bytes: Vec::new(),
            limit,
            exceeded: false,
        }
    }
}

impl Write for BoundedFrame {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self.bytes.len().saturating_add(bytes.len()) > self.limit {
            self.exceeded = true;
            return Err(io::Error::other("frame exceeds its limit"));
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn run(args: &[String]) -> (i32, PreviewResult) {
    if args.len() != 4 || args[0] != "view" || args[2] != "--view" {
        return (
            2,
            PreviewResult::failure(
                &[Diagnostic::error(
                    DiagnosticCode::Host,
                    "Usage: kontur view <file.dsl> --view <key>",
                    None,
                )],
                None,
            ),
        );
    }

    let path = &args[1];
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) => {
            return (
                1,
                PreviewResult::failure(
                    &[Diagnostic::error(
                        DiagnosticCode::Host,
                        format!("Could not read `{path}`: {error}"),
                        None,
                    )],
                    None,
                ),
            );
        }
    };
    let source = SourceFile::new(path.clone(), path, text);
    match compile_view(&source, &ViewKey(args[3].clone())) {
        Ok(view) => (0, PreviewResult::success(&view, &source)),
        Err(diagnostics) => (1, PreviewResult::failure(&diagnostics, Some(&source))),
    }
}

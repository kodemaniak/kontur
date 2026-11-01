mod protocol;

use std::fs;
use std::io::{self, Write};

use kontur_core::compile_view;
use kontur_core::diagnostic::{Diagnostic, DiagnosticCode};
use kontur_core::model::ViewKey;
use kontur_core::source::SourceFile;
use protocol::PreviewResult;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (status, result) = run(&args);
    let stdout = io::stdout();
    let mut output = stdout.lock();
    serde_json::to_writer(&mut output, &result).expect("serializing the CLI result cannot fail");
    writeln!(output).expect("writing the CLI result cannot fail");
    if status != 0 {
        std::process::exit(status);
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

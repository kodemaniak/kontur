pub mod protocol;

use kontur_core::{compile_single_view, source::SourceFile};
use protocol::PreviewResult;

pub fn compile_preview(source: &SourceFile) -> PreviewResult {
    match compile_single_view(source) {
        Ok(view) => PreviewResult::success(&view, source),
        Err(diagnostics) => PreviewResult::failure(&diagnostics, Some(source)),
    }
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use super::*;
    use std::{cell::RefCell, ptr, str};

    const MAX_INPUT_BYTES: usize = 5 * 1024 * 1024;

    // The browser copies in UTF-8, calls compile, then copies out JSON synchronously.
    // Pointers are valid until the next operation that changes the buffer.
    thread_local! {
        static BUFFER: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    }

    #[unsafe(no_mangle)]
    extern "C" fn preview_input(len: usize) -> *mut u8 {
        if len > MAX_INPUT_BYTES {
            return ptr::null_mut();
        }
        BUFFER.with_borrow_mut(|buffer| {
            buffer.resize(len, 0);
            buffer.as_mut_ptr()
        })
    }

    #[unsafe(no_mangle)]
    extern "C" fn preview_compile() -> usize {
        BUFFER.with_borrow_mut(|buffer| {
            let Ok(text) = str::from_utf8(buffer) else {
                return 0;
            };
            let result = compile_preview(&SourceFile::new("workspace.dsl", "workspace.dsl", text));
            match serde_json::to_vec(&result) {
                Ok(json) => {
                    *buffer = json;
                    buffer.len()
                }
                Err(_) => 0,
            }
        })
    }

    #[unsafe(no_mangle)]
    extern "C" fn preview_output() -> *const u8 {
        BUFFER.with_borrow(|buffer| buffer.as_ptr())
    }
}

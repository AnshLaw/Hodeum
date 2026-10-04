//! Reading a search service's or a page's answer without trusting its size: the body is read chunk by
//! chunk up to a cap, and refused at once when its declared length is already over it, so a huge or
//! endlessly inflating (gzip) answer can't fill memory.

use reqwest::header::CONTENT_TYPE;

use super::source::SourceError;

/// A search service's answer: five results with their highlights or answer bodies come to well under
/// 100 KB, so anything near this isn't an answer.
pub const MAX_ANSWER_BYTES: usize = 1_000_000;
/// What a help page may be served as.
const HTML_TYPES: [&str; 2] = ["text/html", "application/xhtml+xml"];

/// Collects a body's chunks, refusing it as soon as it passes `cap` bytes.
#[derive(Debug)]
pub struct Capped {
    cap: usize,
    bytes: Vec<u8>,
}

impl Capped {
    /// Refuses at once a body whose declared length is already over the cap.
    pub fn new(cap: usize, declared: Option<u64>) -> Result<Self, SourceError> {
        if declared.is_some_and(|length| length > cap as u64) {
            return Err(SourceError::TooLarge(cap));
        }
        Ok(Self { cap, bytes: Vec::new() })
    }

    /// Adds the next chunk; a server that understated its length is cut off here too.
    pub fn push(&mut self, chunk: &[u8]) -> Result<(), SourceError> {
        if self.bytes.len() + chunk.len() > self.cap {
            return Err(SourceError::TooLarge(self.cap));
        }
        self.bytes.extend_from_slice(chunk);
        Ok(())
    }

    /// The body as text; bytes that aren't UTF-8 are replaced rather than refused.
    pub fn text(self) -> String {
        String::from_utf8(self.bytes).unwrap_or_else(|error| String::from_utf8_lossy(error.as_bytes()).into_owned())
    }
}

/// The response body as text, read chunk by chunk and refused past `cap` bytes.
pub async fn read_capped(mut response: reqwest::Response, cap: usize) -> Result<String, SourceError> {
    let mut body = Capped::new(cap, response.content_length())?;
    while let Some(chunk) = response.chunk().await.map_err(SourceError::from_reqwest)? {
        body.push(&chunk)?;
    }
    Ok(body.text())
}

/// The response's `Content-Type`, if it has a readable one.
pub fn content_type(response: &reqwest::Response) -> Option<&str> {
    response.headers().get(CONTENT_TYPE).and_then(|value| value.to_str().ok())
}

/// Whether a `Content-Type` names an HTML page; parameters such as the charset don't matter.
pub fn is_html(content_type: Option<&str>) -> bool {
    let Some(value) = content_type else { return false };
    let media = value.split(';').next().unwrap_or_default().trim();
    HTML_TYPES.iter().any(|html| media.eq_ignore_ascii_case(html))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::async_runtime;

    const CAP: usize = 10;

    /// A body arriving in `chunks`, as `read_capped` collects it.
    fn collect(declared: Option<u64>, chunks: &[&str]) -> Result<String, SourceError> {
        let mut body = Capped::new(CAP, declared)?;
        for chunk in chunks {
            body.push(chunk.as_bytes())?;
        }
        Ok(body.text())
    }

    fn response(body: &'static str) -> reqwest::Response {
        reqwest::Response::from(tauri::http::Response::new(body))
    }

    #[test]
    fn reads_a_body_up_to_the_cap_chunk_by_chunk() {
        assert_eq!(collect(Some(9), &["hello ", "cap"]), Ok("hello cap".into()));
        assert_eq!(collect(None, &["01234", "56789"]), Ok("0123456789".into()));
    }

    #[test]
    fn refuses_a_declared_length_over_the_cap_before_reading() {
        assert_eq!(Capped::new(CAP, Some(CAP as u64 + 1)).unwrap_err(), SourceError::TooLarge(CAP));
    }

    #[test]
    fn cuts_off_a_body_that_grows_past_the_cap() {
        // An inflating gzip body declares no length; the stream itself is cut off.
        assert_eq!(collect(None, &["0123456789", "x"]), Err(SourceError::TooLarge(CAP)));
        // So is one whose server understated its length.
        assert_eq!(collect(Some(2), &["0123", "4567", "89ab"]), Err(SourceError::TooLarge(CAP)));
    }

    #[test]
    fn keeps_text_that_is_not_quite_utf8() {
        let mut body = Capped::new(CAP, None).unwrap();
        body.push(&[b'o', b'k', 0xff]).unwrap();
        assert_eq!(body.text(), "ok\u{fffd}");
    }

    #[test]
    fn reads_a_whole_response_within_the_cap_and_refuses_a_bigger_one() {
        assert_eq!(async_runtime::block_on(read_capped(response("0123456789"), CAP)), Ok("0123456789".into()));
        assert_eq!(async_runtime::block_on(read_capped(response("0123456789x"), CAP)), Err(SourceError::TooLarge(CAP)));
    }

    #[test]
    fn reads_only_html_pages() {
        for html in ["text/html", "text/html; charset=utf-8", "TEXT/HTML;charset=UTF-8", "application/xhtml+xml"] {
            assert!(is_html(Some(html)), "{html}");
        }
        for other in ["application/pdf", "application/octet-stream", "image/svg+xml", "text/plain", "text/htmlx", ""] {
            assert!(!is_html(Some(other)), "{other}");
        }
        assert!(!is_html(None));
    }
}

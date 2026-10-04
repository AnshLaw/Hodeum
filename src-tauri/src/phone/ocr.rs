use serde::Serialize;
use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::{OcrEngine, OcrWord};
use windows::Storage::Streams::DataWriter;
use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

/// A gap wider than this many text heights splits a line: home-screen labels share a baseline.
const SPLIT_GAP_HEIGHTS: f64 = 1.2;

/// One piece of on-screen text in frame pixels. Mirrors `OcrSegment` in `src/features/phone/phone-perception.ts`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct OcrSegment {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Word {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

fn merge(words: &[Word]) -> OcrSegment {
    let left = words.iter().map(|w| w.x).fold(f64::INFINITY, f64::min);
    let top = words.iter().map(|w| w.y).fold(f64::INFINITY, f64::min);
    let right = words.iter().map(|w| w.x + w.width).fold(f64::NEG_INFINITY, f64::max);
    let bottom = words.iter().map(|w| w.y + w.height).fold(f64::NEG_INFINITY, f64::max);
    let text = words.iter().map(|w| w.text.as_str()).collect::<Vec<_>>().join(" ");
    OcrSegment { text, x: left, y: top, width: right - left, height: bottom - top }
}

/// Splits one OCR line wherever words sit far apart, so separate labels become separate elements.
pub fn segments(line: &[Word]) -> Vec<OcrSegment> {
    let mut out = Vec::new();
    let mut start = 0;
    for i in 1..line.len() {
        let previous = &line[i - 1];
        let gap = line[i].x - (previous.x + previous.width);
        if gap > previous.height.max(line[i].height) * SPLIT_GAP_HEIGHTS {
            out.push(merge(&line[start..i]));
            start = i;
        }
    }
    if start < line.len() {
        out.push(merge(&line[start..]));
    }
    out
}

fn winrt<T>(result: windows::core::Result<T>, what: &str) -> Result<T, String> {
    result.map_err(|e| format!("Windows OCR failed ({what}): {e}"))
}

fn word_of(word: &OcrWord) -> Result<Word, String> {
    let rect = winrt(word.BoundingRect(), "word box")?;
    let text = winrt(word.Text(), "word text")?.to_string();
    Ok(Word { text, x: f64::from(rect.X), y: f64::from(rect.Y), width: f64::from(rect.Width), height: f64::from(rect.Height) })
}

/// WinRT needs COM on this worker thread; a thread already in another apartment still works.
fn ensure_com() -> Result<(), String> {
    // SAFETY: called once per blocking worker thread before any WinRT use.
    let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    if hr.is_err() && hr != RPC_E_CHANGED_MODE {
        return Err(format!("couldn't start COM for OCR: {hr:?}"));
    }
    Ok(())
}

fn bitmap_of(png: &[u8]) -> Result<SoftwareBitmap, String> {
    let image = xcap::image::load_from_memory(png).map_err(|e| format!("couldn't decode the phone frame: {e}"))?.to_rgba8();
    let (width, height) = image.dimensions();
    let mut bgra = image.into_raw();
    bgra.chunks_exact_mut(4).for_each(|px| px.swap(0, 2));
    let writer = winrt(DataWriter::new(), "buffer")?;
    winrt(writer.WriteBytes(&bgra), "buffer")?;
    let buffer = winrt(writer.DetachBuffer(), "buffer")?;
    winrt(SoftwareBitmap::CreateCopyFromBuffer(&buffer, BitmapPixelFormat::Bgra8, width as i32, height as i32), "bitmap")
}

/// Reads every text line on a phone frame, in memory only. Blocking.
pub fn recognize(png: &[u8]) -> Result<Vec<OcrSegment>, String> {
    ensure_com()?;
    let engine = winrt(OcrEngine::TryCreateFromUserProfileLanguages(), "no OCR language is installed")?;
    let bitmap = bitmap_of(png)?;
    let result = winrt(winrt(engine.RecognizeAsync(&bitmap), "start")?.join(), "recognize")?;
    let mut out = Vec::new();
    for line in winrt(result.Lines(), "lines")? {
        let words = winrt(line.Words(), "words")?.into_iter().map(|w| word_of(&w)).collect::<Result<Vec<_>, _>>()?;
        out.extend(segments(&words));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::{segments, Word};

    fn word(text: &str, x: f64, width: f64) -> Word {
        Word { text: text.into(), x, y: 100.0, width, height: 20.0 }
    }

    #[test]
    fn joins_words_of_one_label() {
        let line = [word("Display", 10.0, 70.0), word("&", 86.0, 10.0), word("Brightness", 102.0, 100.0)];
        let out = segments(&line);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].text, "Display & Brightness");
        assert_eq!((out[0].x, out[0].width), (10.0, 192.0));
    }

    #[test]
    fn splits_a_line_at_wide_gaps() {
        let line = [word("Clock", 10.0, 50.0), word("Settings", 110.0, 70.0), word("Maps", 230.0, 45.0)];
        let names: Vec<String> = segments(&line).into_iter().map(|s| s.text).collect();
        assert_eq!(names, ["Clock", "Settings", "Maps"]);
    }

    /// Real Windows OCR on a screenshot of the primary monitor (needs a desktop session).
    #[test]
    #[ignore]
    fn recognizes_text_on_the_current_screen() {
        use std::io::Cursor;
        let monitor = xcap::Monitor::all().unwrap().into_iter().next().expect("a monitor");
        let mut png = Cursor::new(Vec::new());
        monitor.capture_image().unwrap().write_to(&mut png, xcap::image::ImageFormat::Png).unwrap();
        let started = std::time::Instant::now();
        let found = super::recognize(png.get_ref()).expect("OCR runs");
        println!("{} segments in {:?}, e.g. {:?}", found.len(), started.elapsed(), found.iter().take(5).map(|s| &s.text).collect::<Vec<_>>());
        assert!(!found.is_empty());
    }

    #[test]
    fn empty_line_gives_nothing() {
        assert!(segments(&[]).is_empty());
    }
}

use image::codecs::jpeg::JpegEncoder;
use xcap::image::{imageops, imageops::FilterType, DynamicImage, RgbaImage};

use super::model::RectDto;

/// Routine VLM input size from the PRD (§12): longest side about 1280 px.
pub const MAX_CAPTURE_SIDE: u32 = 1280;
/// JPEG quality for the vision model: text stays legible, and the image is far smaller than a PNG.
pub const JPEG_QUALITY: u8 = 85;
pub const CAPTURE_MIME: &str = "image/jpeg";

pub fn downscaled_size(width: u32, height: u32, max_side: u32) -> (u32, u32) {
    let longest = width.max(height);
    if longest <= max_side {
        return (width, height);
    }
    let scale = f64::from(max_side) / f64::from(longest);
    let fit = |v: u32| ((f64::from(v) * scale).round() as u32).max(1);
    (fit(width), fit(height))
}

/// A downscaled window capture and where that window sits on screen (physical px).
pub struct Capture {
    /// JPEG bytes (`CAPTURE_MIME`).
    pub jpeg: Vec<u8>,
    pub rect: RectDto,
}

/// JPEG has no alpha channel, so the window's pixels are flattened to RGB first.
pub fn encode_jpeg(image: RgbaImage) -> Result<Vec<u8>, String> {
    let rgb = DynamicImage::ImageRgba8(image).into_rgb8();
    let mut bytes = Vec::new();
    JpegEncoder::new_with_quality(&mut bytes, JPEG_QUALITY).encode_image(&rgb).map_err(|e| e.to_string())?;
    Ok(bytes)
}

/// Captures one window to JPEG bytes in memory. Nothing is written to disk.
pub fn capture_jpeg(hwnd: isize) -> Result<Capture, String> {
    let window = xcap::Window::all()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|w| w.id().ok() == Some(hwnd as u32))
        .ok_or_else(|| "The app window to capture is no longer open.".to_string())?;
    let err = |e: xcap::XCapError| e.to_string();
    let rect = RectDto {
        x: f64::from(window.x().map_err(err)?),
        y: f64::from(window.y().map_err(err)?),
        width: f64::from(window.width().map_err(err)?),
        height: f64::from(window.height().map_err(err)?),
    };
    let image = window.capture_image().map_err(|e| e.to_string())?;
    let (width, height) = downscaled_size(image.width(), image.height(), MAX_CAPTURE_SIDE);
    let image = if (width, height) == image.dimensions() {
        image
    } else {
        imageops::resize(&image, width, height, FilterType::Triangle)
    };
    Ok(Capture { jpeg: encode_jpeg(image)?, rect })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_small_images_and_shrinks_large_ones_proportionally() {
        assert_eq!(downscaled_size(800, 600, 1280), (800, 600));
        assert_eq!(downscaled_size(2560, 1440, 1280), (1280, 720));
        assert_eq!(downscaled_size(1000, 3000, 1280), (427, 1280));
    }

    /// Live: `cargo test --lib perception::capture::tests::captures_the_front_app -- --ignored --nocapture`.
    #[test]
    #[ignore = "captures a window on this PC"]
    fn captures_the_front_app() {
        let hwnd = crate::chat_context::app_windows().unwrap().into_iter().next().expect("no app window is open");
        let started = std::time::Instant::now();
        let capture = capture_jpeg(hwnd.0 as isize).unwrap();
        println!("{} KB JPEG of {:?} in {} ms", capture.jpeg.len() / 1024, capture.rect, started.elapsed().as_millis());
        assert_eq!(&capture.jpeg[..2], &[0xFF, 0xD8]);
    }

    #[test]
    fn encodes_a_jpeg() {
        let image = RgbaImage::from_fn(64, 32, |x, y| xcap::image::Rgba([x as u8 * 4, y as u8 * 8, 128, 255]));
        let jpeg = encode_jpeg(image).unwrap();
        // SOI marker, and the JFIF/EXIF segment marker that follows it.
        assert_eq!(&jpeg[..3], &[0xFF, 0xD8, 0xFF]);
        assert_eq!(&jpeg[jpeg.len() - 2..], &[0xFF, 0xD9]);
    }
}

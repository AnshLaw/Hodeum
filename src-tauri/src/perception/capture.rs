use std::io::Cursor;

use xcap::image::{imageops, imageops::FilterType, ImageFormat};

/// Routine VLM input size from the PRD (§12): longest side about 1280 px.
pub const MAX_CAPTURE_SIDE: u32 = 1280;

pub fn downscaled_size(width: u32, height: u32, max_side: u32) -> (u32, u32) {
    let longest = width.max(height);
    if longest <= max_side {
        return (width, height);
    }
    let scale = f64::from(max_side) / f64::from(longest);
    let fit = |v: u32| ((f64::from(v) * scale).round() as u32).max(1);
    (fit(width), fit(height))
}

/// Captures one window to PNG bytes in memory. Nothing is written to disk.
pub fn capture_png(hwnd: isize) -> Result<Vec<u8>, String> {
    let window = xcap::Window::all()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|w| w.id().ok() == Some(hwnd as u32))
        .ok_or_else(|| "The app window to capture is no longer open.".to_string())?;
    let image = window.capture_image().map_err(|e| e.to_string())?;
    let (width, height) = downscaled_size(image.width(), image.height(), MAX_CAPTURE_SIDE);
    let image = if (width, height) == image.dimensions() {
        image
    } else {
        imageops::resize(&image, width, height, FilterType::Triangle)
    };
    let mut bytes = Cursor::new(Vec::new());
    image.write_to(&mut bytes, ImageFormat::Png).map_err(|e| e.to_string())?;
    Ok(bytes.into_inner())
}

#[cfg(test)]
mod tests {
    use super::downscaled_size;

    #[test]
    fn keeps_small_images_and_shrinks_large_ones_proportionally() {
        assert_eq!(downscaled_size(800, 600, 1280), (800, 600));
        assert_eq!(downscaled_size(2560, 1440, 1280), (1280, 720));
        assert_eq!(downscaled_size(1000, 3000, 1280), (427, 1280));
    }
}

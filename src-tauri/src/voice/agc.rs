//! Automatic gain in front of the voice activity detector only: Silero misses quiet speech (about
//! -55 dBFS) entirely, so each window is brought up toward a steady level before the detector judges
//! it. Speech recognition still gets the raw audio: amplifying its noise made noisy speech worse.
//! Measured on Kokoro clips: quiet WER 0.34 -> 0.05 with no empty results; clean and noisy unchanged.

/// Where speech peaks are brought to.
const TARGET_PEAK: f32 = 0.5;
/// The most the detector's input is amplified (+29.5 dB).
pub(crate) const MAX_GAIN: f32 = 30.0;
/// Below this envelope the room counts as silent; it keeps the gain finite.
const FLOOR: f32 = 1e-4;
/// Peak envelope per 32 ms window: follows a louder peak by half the gap, decays over ~1.5 s.
const ATTACK: f32 = 0.5;
const RELEASE: f32 = 0.015;
/// Gain moves toward its target slowly when rising (a pause doesn't pump up noise at once) and fast
/// when falling (a loud word right after quiet isn't blown out).
const GAIN_RISE: f32 = 0.05;
const GAIN_FALL: f32 = 0.5;
/// No window leaves the gain stage louder than this, so a loud burst after quiet never clips.
const OUTPUT_LIMIT: f32 = 0.9;
/// Gain this close to the cap counts as "at the cap".
const NEAR_MAX: f32 = 0.9 * MAX_GAIN;
/// Speech heard only at (near) full gain for this long: the microphone is too quiet.
const QUIET_WARN_SECS: f32 = 3.0;

/// The detector's gain stage, one per listener; reset between sessions.
pub(crate) struct VadGain {
    env: f32,
    gain: f32,
}

impl Default for VadGain {
    fn default() -> Self {
        Self { env: 0.0, gain: 1.0 }
    }
}

impl VadGain {
    /// One window in, the same window at the detector's level out.
    pub(crate) fn process(&mut self, window: &[f32]) -> Vec<f32> {
        let peak = window.iter().fold(0.0_f32, |m, s| m.max(s.abs()));
        let follow = if peak > self.env { ATTACK } else { RELEASE };
        self.env += (peak - self.env) * follow;
        let want = (TARGET_PEAK / self.env.max(FLOOR)).clamp(1.0, MAX_GAIN);
        self.gain += (want - self.gain) * if want < self.gain { GAIN_FALL } else { GAIN_RISE };
        // Limited per window, but never below 1: audio already louder than the limit is left as it is.
        let applied = if peak > 0.0 { self.gain.min((OUTPUT_LIMIT / peak).max(1.0)) } else { self.gain };
        window.iter().map(|s| s * applied).collect()
    }

    #[cfg(test)]
    pub(crate) fn gain(&self) -> f32 {
        self.gain
    }

    pub(crate) fn near_max(&self) -> bool {
        self.gain >= NEAR_MAX
    }
}

/// Watches for speech that is only ever heard at full gain, and says so once.
#[derive(Default)]
pub(crate) struct QuietMic {
    secs: f32,
    warned: bool,
}

impl QuietMic {
    /// One window of `secs`; true exactly once, when quiet speech has added up past the limit.
    pub(crate) fn observe(&mut self, quiet_speech: bool, secs: f32) -> bool {
        if quiet_speech {
            self.secs += secs;
        }
        if self.warned || self.secs <= QUIET_WARN_SECS {
            return false;
        }
        self.warned = true;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const WINDOW: usize = 512;
    const RATE: f32 = 16_000.0;
    const WINDOW_SECS: f32 = WINDOW as f32 / RATE;
    const TONE_HZ: f32 = 440.0;

    fn sine(amplitude: f32, windows: usize) -> Vec<Vec<f32>> {
        let samples: Vec<f32> = (0..WINDOW * windows).map(|i| amplitude * (std::f32::consts::TAU * TONE_HZ * i as f32 / RATE).sin()).collect();
        samples.chunks(WINDOW).map(<[f32]>::to_vec).collect()
    }

    fn peak(window: &[f32]) -> f32 {
        window.iter().fold(0.0, |m, s| m.max(s.abs()))
    }

    #[test]
    fn quiet_speech_is_brought_up_for_the_detector_within_a_second() {
        let mut gain = VadGain::default();
        let one_second = (1.0 / WINDOW_SECS) as usize;
        let out: Vec<Vec<f32>> = sine(0.01, one_second).iter().map(|w| gain.process(w)).collect();
        assert!(peak(out.last().unwrap()) >= 0.2, "peak {}", peak(out.last().unwrap()));
    }

    #[test]
    fn gain_never_passes_the_cap() {
        let mut gain = VadGain::default();
        for window in sine(1e-6, 400) {
            gain.process(&window);
            assert!(gain.gain() <= MAX_GAIN);
        }
        assert!(gain.near_max(), "near-silence ends up at the cap");
    }

    #[test]
    fn a_loud_word_after_quiet_does_not_clip_and_the_gain_falls_fast() {
        let mut gain = VadGain::default();
        sine(0.001, 200).iter().for_each(|w| drop(gain.process(w)));
        assert!(gain.near_max());
        let loud = sine(0.8, 8);
        for (i, window) in loud.iter().enumerate() {
            let out = gain.process(window);
            assert!(peak(&out) <= OUTPUT_LIMIT + 1e-4, "window {i} peaked at {}", peak(&out));
        }
        assert!(gain.gain() < 1.25, "gain {}", gain.gain());
    }

    #[test]
    fn normal_speech_is_left_about_as_it_is() {
        let mut gain = VadGain::default();
        let out: Vec<Vec<f32>> = sine(0.5, 30).iter().map(|w| gain.process(w)).collect();
        assert!((peak(out.last().unwrap()) - 0.5).abs() < 0.05);
    }

    #[test]
    fn warns_once_after_three_seconds_of_speech_at_full_gain() {
        let mut quiet = QuietMic::default();
        let windows_in_3s = (QUIET_WARN_SECS / WINDOW_SECS) as usize;
        assert!((0..windows_in_3s).all(|_| !quiet.observe(true, WINDOW_SECS)));
        assert!((0..1000).all(|_| !quiet.observe(false, WINDOW_SECS)), "silence doesn't add up");
        assert!(quiet.observe(true, WINDOW_SECS) || quiet.observe(true, WINDOW_SECS));
        assert!(!quiet.observe(true, WINDOW_SECS), "only once");
    }
}

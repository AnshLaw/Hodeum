//! The build stamp ("<git short sha>[-dirty] <UTC time>"), shared by build.rs (which bakes it in as
//! HODEUM_BUILD) and the unit tests, so an old copy of Hodeum is obvious in the log and the tray.

const SECONDS_PER_MINUTE: u64 = 60;
const SECONDS_PER_HOUR: u64 = 3_600;
const SECONDS_PER_DAY: u64 = 86_400;
/// Days from 0000-03-01 to 1970-01-01 in the proleptic Gregorian calendar.
const EPOCH_SHIFT_DAYS: i64 = 719_468;
const DAYS_PER_ERA: i64 = 146_097;
/// Used when git can't say which commit this is (a source copy without .git).
pub const UNKNOWN_COMMIT: &str = "nogit";

/// (year, month, day) for a count of days since 1970-01-01 (Howard Hinnant's civil_from_days).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + EPOCH_SHIFT_DAYS;
    let era = z.div_euclid(DAYS_PER_ERA);
    let day_of_era = z.rem_euclid(DAYS_PER_ERA);
    let year_of_era = (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_index + 2) / 5 + 1) as u32;
    let month = if month_index < 10 { month_index + 3 } else { month_index - 9 } as u32;
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// "2026-10-04 06:31 UTC" for seconds since the Unix epoch.
pub fn utc_minute(unix_seconds: u64) -> String {
    let (year, month, day) = civil_from_days((unix_seconds / SECONDS_PER_DAY) as i64);
    let hour = unix_seconds % SECONDS_PER_DAY / SECONDS_PER_HOUR;
    let minute = unix_seconds % SECONDS_PER_HOUR / SECONDS_PER_MINUTE;
    format!("{year:04}-{month:02}-{day:02} {hour:02}:{minute:02} UTC")
}

/// "<sha>[-dirty] <time>"; a missing sha reads as `UNKNOWN_COMMIT`.
pub fn stamp(short_sha: Option<&str>, dirty: bool, unix_seconds: u64) -> String {
    let sha = short_sha.map(str::trim).filter(|sha| !sha.is_empty()).unwrap_or(UNKNOWN_COMMIT);
    let dirty = if dirty { "-dirty" } else { "" };
    format!("{sha}{dirty} {}", utc_minute(unix_seconds))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_utc_minutes() {
        assert_eq!(utc_minute(0), "1970-01-01 00:00 UTC");
        assert_eq!(utc_minute(1_791_095_460), "2026-10-04 06:31 UTC");
        assert_eq!(utc_minute(951_782_400), "2000-02-29 00:00 UTC", "leap day");
        assert_eq!(utc_minute(1_735_689_599), "2024-12-31 23:59 UTC");
    }

    #[test]
    fn stamps_the_commit_and_whether_it_had_local_changes() {
        assert_eq!(stamp(Some("0fe9357\n"), false, 0), "0fe9357 1970-01-01 00:00 UTC");
        assert_eq!(stamp(Some("0fe9357"), true, 0), "0fe9357-dirty 1970-01-01 00:00 UTC");
        assert_eq!(stamp(None, false, 0), "nogit 1970-01-01 00:00 UTC");
        assert_eq!(stamp(Some("  "), true, 0), "nogit-dirty 1970-01-01 00:00 UTC");
    }
}

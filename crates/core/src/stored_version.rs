//! The one rule every stored format asks before reading what it holds (ah-aguu).
//!
//! A newer build may have changed what stored values mean, not only added to them (ah-m6pw moved
//! every turn), so a store written by a newer build is never read: the desktop's game database and
//! a backup file both ask [`refuse_newer`]. The browser's IndexedDB refuses the same thing itself,
//! with a `VersionError`, before any code of ours can see the version.

/// A stored version above what this build supports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NewerThanBuild {
    /// The stored version, `u32::MAX` when it does not fit in one.
    pub actual: u32,
    pub max_supported: u32,
}

/// `stored` as a `u32` when this build supports it, or the refusal when it is newer.
///
/// Compared as `u64` before narrowing, so a version too large for `u32` is still judged newer
/// rather than wrapping round to one this build knows.
pub fn refuse_newer(stored: u64, supported: u32) -> Result<u32, NewerThanBuild> {
    if stored > u64::from(supported) {
        return Err(NewerThanBuild {
            actual: u32::try_from(stored).unwrap_or(u32::MAX),
            max_supported: supported,
        });
    }
    // Fits: it has just been shown to be `<= supported`.
    Ok(u32::try_from(stored).unwrap_or(supported))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_supported_version_and_older_ones_are_read() {
        assert_eq!(refuse_newer(15, 15), Ok(15));
        assert_eq!(refuse_newer(0, 15), Ok(0));
    }

    #[test]
    fn one_above_the_supported_version_is_refused() {
        assert_eq!(
            refuse_newer(16, 15),
            Err(NewerThanBuild {
                actual: 16,
                max_supported: 15
            })
        );
    }

    #[test]
    fn a_version_too_large_for_u32_is_refused_rather_than_wrapped() {
        assert_eq!(
            refuse_newer(u64::from(u32::MAX) + 3, 2),
            Err(NewerThanBuild {
                actual: u32::MAX,
                max_supported: 2
            })
        );
    }
}

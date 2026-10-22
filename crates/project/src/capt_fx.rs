use serde::{Deserialize, Serialize};
use specta::Type;

use crate::Color;

/// Five color stops from black to white that the lens maps luminance onto.
/// Thermal through Paper are the ff-tracking palettes (MIT, Mustafa Saraç).
#[derive(Type, Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LensPalette {
    #[default]
    None,
    Thermal,
    Phosphor,
    Amber,
    Neon,
    Mono,
    Navy,
    Paper,
    Crimson,
}

impl LensPalette {
    pub fn stops(self) -> Option<[[f32; 3]; 5]> {
        let c = |hex: u32| {
            [
                ((hex >> 16) & 0xff) as f32 / 255.0,
                ((hex >> 8) & 0xff) as f32 / 255.0,
                (hex & 0xff) as f32 / 255.0,
            ]
        };
        let s = |a, b, cc, d, e| Some([c(a), c(b), c(cc), c(d), c(e)]);
        match self {
            LensPalette::None => None,
            LensPalette::Thermal => s(0x050310, 0x3a0b6b, 0xb3306a, 0xf6862a, 0xfcf6b4),
            LensPalette::Phosphor => s(0x010604, 0x05361b, 0x13a85a, 0x7dffb4, 0xeafff3),
            LensPalette::Amber => s(0x070300, 0x3d1a02, 0xb35a09, 0xffae3d, 0xfff3d6),
            LensPalette::Neon => s(0x000502, 0x003d1e, 0x00c46a, 0x5dffae, 0xf0fff6),
            LensPalette::Mono => s(0x050506, 0x2b2c2e, 0x8a8c90, 0xd9dadc, 0xffffff),
            LensPalette::Navy => s(0x071451, 0x0d2a8c, 0x4a63d6, 0xb8c4ff, 0xf4f6ff),
            LensPalette::Paper => s(0xecebe6, 0xc9c8c2, 0x77766f, 0x2a2a28, 0x0c0c0c),
            LensPalette::Crimson => s(0x050001, 0x3a0206, 0x8f0a12, 0xe3262d, 0xffe0db),
        }
    }
}

/// The ff-tracking lens as a post pass over the composed frame. Strengths are
/// 0..1; everything at zero with no palette skips the pass entirely.
#[derive(Type, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LensConfiguration {
    pub palette: LensPalette,
    pub bloom: f32,
    pub aberration: f32,
    pub led_grid: f32,
    pub grain: f32,
    pub depth_of_field: f32,
    pub vignette: f32,
    pub scanlines: f32,
}

impl Default for LensConfiguration {
    fn default() -> Self {
        Self {
            palette: LensPalette::None,
            bloom: 0.0,
            aberration: 0.0,
            led_grid: 0.0,
            grain: 0.0,
            depth_of_field: 0.0,
            vignette: 0.0,
            scanlines: 0.0,
        }
    }
}

impl LensConfiguration {
    pub fn clamped(&self) -> Self {
        let c = |v: f32| {
            if v.is_finite() {
                v.clamp(0.0, 1.0)
            } else {
                0.0
            }
        };
        Self {
            palette: self.palette,
            bloom: c(self.bloom),
            aberration: c(self.aberration),
            led_grid: c(self.led_grid),
            grain: c(self.grain),
            depth_of_field: c(self.depth_of_field),
            vignette: c(self.vignette),
            scanlines: c(self.scanlines),
        }
    }

    pub fn is_active(&self) -> bool {
        let c = self.clamped();
        c.palette != LensPalette::None
            || c.bloom > 0.0
            || c.aberration > 0.0
            || c.led_grid > 0.0
            || c.grain > 0.0
            || c.depth_of_field > 0.0
            || c.vignette > 0.0
            || c.scanlines > 0.0
    }
}

/// A computer-vision style box that follows the recorded cursor and locks on
/// at every click. Recordings carry no glyph data, so the cursor and its
/// clicks are what gets tracked.
#[derive(Type, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct TrackerConfiguration {
    pub enabled: bool,
    pub color: Color,
    pub lock_color: Color,
    pub size: f32,
    pub hatch: bool,
    pub labels: bool,
    pub lock_duration: f32,
}

impl Default for TrackerConfiguration {
    fn default() -> Self {
        Self {
            enabled: false,
            color: [236, 235, 230],
            lock_color: [255, 33, 25],
            size: Self::DEFAULT_SIZE,
            hatch: true,
            labels: true,
            lock_duration: Self::DEFAULT_LOCK_DURATION,
        }
    }
}

impl TrackerConfiguration {
    pub const DEFAULT_SIZE: f32 = 1.0;
    pub const DEFAULT_LOCK_DURATION: f32 = 0.7;
    pub const SIZE_RANGE: (f32, f32) = (0.4, 3.0);
    pub const LOCK_DURATION_RANGE: (f32, f32) = (0.2, 2.0);

    pub fn size_clamped(&self) -> f32 {
        if self.size.is_finite() {
            self.size.clamp(Self::SIZE_RANGE.0, Self::SIZE_RANGE.1)
        } else {
            Self::DEFAULT_SIZE
        }
    }

    pub fn lock_duration_clamped(&self) -> f32 {
        if self.lock_duration.is_finite() {
            self.lock_duration
                .clamp(Self::LOCK_DURATION_RANGE.0, Self::LOCK_DURATION_RANGE.1)
        } else {
            Self::DEFAULT_LOCK_DURATION
        }
    }
}

/// Ordered patterns drawn over a gradient background for stylized screenshots.
#[derive(Type, Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BackgroundPattern {
    #[default]
    None,
    Dither,
    Halftone,
    Ascii,
}

impl BackgroundPattern {
    pub fn shader_index(self) -> f32 {
        match self {
            BackgroundPattern::None => 0.0,
            BackgroundPattern::Dither => 1.0,
            BackgroundPattern::Halftone => 2.0,
            BackgroundPattern::Ascii => 3.0,
        }
    }
}

#[derive(Type, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct BackgroundPatternConfiguration {
    pub kind: BackgroundPattern,
    /// Cell size in px at 1080p output.
    pub scale: f32,
    pub strength: f32,
}

impl Default for BackgroundPatternConfiguration {
    fn default() -> Self {
        Self {
            kind: BackgroundPattern::None,
            scale: Self::DEFAULT_SCALE,
            strength: 1.0,
        }
    }
}

impl BackgroundPatternConfiguration {
    pub const DEFAULT_SCALE: f32 = 6.0;
    pub const SCALE_RANGE: (f32, f32) = (2.0, 32.0);

    pub fn scale_clamped(&self) -> f32 {
        if self.scale.is_finite() {
            self.scale.clamp(Self::SCALE_RANGE.0, Self::SCALE_RANGE.1)
        } else {
            Self::DEFAULT_SCALE
        }
    }

    pub fn strength_clamped(&self) -> f32 {
        if self.strength.is_finite() {
            self.strength.clamp(0.0, 1.0)
        } else {
            1.0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lens_defaults_are_inactive() {
        assert!(!LensConfiguration::default().is_active());
    }

    #[test]
    fn lens_ignores_non_finite_strengths() {
        let lens = LensConfiguration {
            bloom: f32::NAN,
            ..Default::default()
        };
        assert!(!lens.is_active());
    }

    #[test]
    fn every_palette_but_none_has_stops() {
        for p in [
            LensPalette::Thermal,
            LensPalette::Phosphor,
            LensPalette::Amber,
            LensPalette::Neon,
            LensPalette::Mono,
            LensPalette::Navy,
            LensPalette::Paper,
            LensPalette::Crimson,
        ] {
            assert!(p.stops().is_some());
        }
        assert!(LensPalette::None.stops().is_none());
    }
}

import Foundation

/// One usable point on a position's wear curve: an odometer reading plus the
/// minimum groove depth measured at that odometer.
struct WearSample: Equatable {
    var odometer: Int
    var depth32: Double

    init(odometer: Int, depth32: Double) {
        self.odometer = odometer
        self.depth32 = depth32
    }
}

/// Wear arithmetic for the unit history screen, kept out of the views so it can be tested.
enum WearRate {
    /// Rates are quoted per 10,000 km, which is roughly a month of highway work.
    static let referenceKM: Double = 10_000

    /// 32nds worn per 10,000 km, measured between the first and last samples.
    ///
    /// Samples are expected in chronological order and to already have both an
    /// odometer and a depth. Returns nil when there is nothing to measure across
    /// (fewer than two samples, or the odometer did not advance), so callers never
    /// divide by zero.
    static func per10kKM(_ samples: [WearSample]) -> Double? {
        guard let first = samples.first, let last = samples.last, samples.count >= 2 else { return nil }
        let distance = Double(last.odometer - first.odometer)
        guard distance > 0 else { return nil }
        return (first.depth32 - last.depth32) / distance * referenceKM
    }

    /// Kilometres left before the current depth reaches the legal minimum.
    /// Nil unless the tire is actually wearing down; clamped at zero when already at or below the minimum.
    static func projectedKM(currentDepth32: Double, minimum32: Int, ratePer10kKM: Double) -> Double? {
        guard ratePer10kKM > 0 else { return nil }
        let remaining = currentDepth32 - Double(minimum32)
        return max(0, remaining / ratePer10kKM * referenceKM)
    }
}

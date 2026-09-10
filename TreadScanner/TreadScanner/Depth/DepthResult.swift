import Foundation

/// A single groove-depth measurement.
struct DepthResult: Equatable {
    var depthMM: Double
    /// ± one standard deviation across frames, in mm.
    var uncertaintyMM: Double
    var frameCount: Int
    var pointCount: Int
    var method: ReadingMethod

    var depth32: Double { Units.thirtySeconds(fromMM: depthMM) }
    var uncertainty32: Double { Units.thirtySeconds(fromMM: uncertaintyMM) }

    /// Above this band the UI asks for a rescan or manual entry.
    static let acceptableUncertainty32 = ScanSettings.acceptableUncertainty32
    var isConfident: Bool { uncertainty32 <= DepthResult.acceptableUncertainty32 }
}

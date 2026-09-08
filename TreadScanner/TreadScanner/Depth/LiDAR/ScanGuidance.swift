import Foundation

/// Live feedback state for the scan overlay. The scan only accumulates frames while
/// `isReady` is true so bad captures are refused rather than averaged in.
struct ScanGuidance: Equatable {
    static let minDistanceM = 0.12
    static let maxDistanceM = 0.30
    static let maxTiltDegrees = 10.0
    static let maxMotionMPerS = 0.05

    var distanceM: Double?
    var tiltDegrees: Double?
    var motionMPerS: Double = 0
    var highConfidenceFraction: Double = 0

    enum Hint: String {
        case searching = "Point at the tread"
        case tooClose = "Move back"
        case tooFar = "Move closer"
        case tilted = "Hold the phone flat to the tire"
        case moving = "Hold still"
        case lowConfidence = "Clean, dry tread reads best"
        case ready = "Hold…"
    }

    var hint: Hint {
        guard let distanceM, let tiltDegrees else { return .searching }
        if distanceM < ScanGuidance.minDistanceM { return .tooClose }
        if distanceM > ScanGuidance.maxDistanceM { return .tooFar }
        if tiltDegrees > ScanGuidance.maxTiltDegrees { return .tilted }
        if motionMPerS > ScanGuidance.maxMotionMPerS { return .moving }
        if highConfidenceFraction < 0.5 { return .lowConfidence }
        return .ready
    }

    var isReady: Bool { hint == .ready }
}

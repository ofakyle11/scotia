import Foundation

/// Every number that controls how fast a scan runs and what it accepts, in one place.
///
/// These are the knobs the accuracy program tunes. Change them here, not where they are used.
/// Times assume ARKit delivers depth at about `depthFrameRateHz`; frame counts are what the
/// code actually enforces, the seconds are for reading.
enum ScanSettings {

    // MARK: Timing

    /// Depth frames per second ARKit delivers on a LiDAR iPhone. Used only to turn frame
    /// counts into the seconds quoted in comments and on screen.
    static let depthFrameRateHz = 30.0

    /// Frames averaged into one tread reading. 45 frames ≈ 1.5 s of steady hold.
    /// More frames = lower noise, longer hold. Below ~20 the ± band gets wide.
    static let scanFrames = 45

    /// Frames written by Record raw LiDAR capture. 150 frames ≈ 5 s, enough to sweep the
    /// phone from 10 cm out to 30 cm at `captureSweepSpeedCmPerS`.
    static let captureFrames = 150

    /// Recommended hand speed during a raw capture sweep. 4 cm/s covers 20 cm in 5 s.
    static let captureSweepSpeedCmPerS = 4.0

    static var scanSeconds: Double { Double(scanFrames) / depthFrameRateHz }
    static var captureSeconds: Double { Double(captureFrames) / depthFrameRateHz }

    // MARK: Pose gate (a normal scan accumulates frames only while all of these pass)

    /// Camera-to-tread distance window, metres. The lower bound is an estimate of where
    /// iPhone LiDAR stops reading reliably; the `pose` analysis sets it from real captures.
    static let minDistanceM = 0.12
    static let maxDistanceM = 0.30

    /// Phone tilt relative to the tread surface, degrees.
    static let maxTiltDegrees = 10.0

    /// Camera speed above which frames are refused as motion-blurred, metres per second.
    /// 0.05 m/s = 5 cm/s, a deliberately steady hold.
    static let maxMotionMPerS = 0.05

    /// Share of depth points that must be high-confidence. Dirt and water lower this.
    static let minHighConfidenceFraction = 0.5

    // MARK: Result acceptance

    /// ± band (in 32nds) above which a reading shows amber and asks for a rescan or a gauge.
    static let acceptableUncertainty32 = 1.5
}

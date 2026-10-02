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
    /// phone from 10 cm out to 40 cm at `captureSweepSpeedCmPerS`, so the `pose` analysis sees
    /// both sides of the gate and can set both bounds from real captures.
    static let captureFrames = 150

    /// Recommended hand speed during a raw capture sweep. 6 cm/s covers 30 cm in 5 s.
    static let captureSweepSpeedCmPerS = 6.0

    static var scanSeconds: Double { Double(scanFrames) / depthFrameRateHz }
    static var captureSeconds: Double { Double(captureFrames) / depthFrameRateHz }

    // MARK: Scan region

    /// Fraction of the depth map's width and height used as the region of interest, centred.
    /// The extractor (LiDARSession) and the on-screen reticle (ScanOverlay) both read this one
    /// value, so what the technician frames is what gets measured.
    static let roiFraction = 0.35

    /// The camera image ARKit delivers is 4:3 in sensor (landscape) orientation, 1920 × 1440 on
    /// every LiDAR iPhone; the 256 × 192 depth map shares that aspect and field of view.
    static let cameraImageAspect = 4.0 / 3.0

    /// On-screen size, in points, of the region of interest when the camera image is shown
    /// portrait and aspect-filled in a view of `viewSize`, which is what ARView does. Portrait
    /// turns the sensor's 4:3 into 3:4; aspect fill scales it until both axes cover the view and
    /// crops the sides. The ROI is `roiFraction` of that shown image on each axis.
    static func roiSizeOnScreen(viewSize: CGSize, roiFraction: Double = ScanSettings.roiFraction) -> CGSize {
        let imageW = 1.0, imageH = cameraImageAspect
        let scale = max(Double(viewSize.width) / imageW, Double(viewSize.height) / imageH)
        return CGSize(width: imageW * scale * roiFraction, height: imageH * scale * roiFraction)
    }

    // MARK: Pose gate (a normal scan accumulates frames only while all of these pass)

    /// Camera-to-tread distance window, metres. Published static noise of the ARKit depth map
    /// on an iPhone 13 Pro (Tondo, Riley, Morgenthal, Sensors 2023, doi:10.3390/s23187832,
    /// Table 1): sigma 6.5 mm at 12 cm, 1.0 mm at 20 cm, 0.5 mm at 30 cm, 0.3 mm at 40 cm;
    /// authors' usable range starts at 30 cm. Below 20 cm the per-pixel noise is wider than a
    /// 2/32 groove, so the gate opens at 20 cm until the `pose` analysis of real captures from
    /// the shop's own phones says otherwise.
    static let minDistanceM = 0.20
    static let maxDistanceM = 0.30

    /// Inside the gate but closer than this, low depth confidence is read as "too close" rather
    /// than "dirty tread". The same measurements put the noise knee between 20 and 30 cm.
    static let closeRangeM = 0.25

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

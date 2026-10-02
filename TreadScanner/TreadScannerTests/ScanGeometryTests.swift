import XCTest
@testable import TreadScanner

/// The reticle must outline what LiDARSession.extract measures: `roiFraction` of the depth map,
/// centred, with the 4:3 sensor image shown portrait and aspect-filled by ARView.
final class ScanGeometryTests: XCTestCase {
    func testReticleMatchesExtractorRegionOnPortraitPhone() {
        // iPhone 15 Pro Max, 430 × 932 pt. The 1440 × 1920 portrait image fills the height:
        // 699 × 932 pt on screen, so the 35% ROI is 244.7 × 326.2 pt, not a 180 pt square.
        let s = ScanSettings.roiSizeOnScreen(viewSize: CGSize(width: 430, height: 932))
        XCTAssertEqual(Double(s.width), 932 * 0.75 * ScanSettings.roiFraction, accuracy: 0.01)
        XCTAssertEqual(Double(s.height), 932 * ScanSettings.roiFraction, accuracy: 0.01)
    }

    func testReticleWhenViewIsWiderThanTheImage() {
        // Width-limited fill (iPad-like): the image's width matches the view, height overflows.
        let s = ScanSettings.roiSizeOnScreen(viewSize: CGSize(width: 1000, height: 500))
        XCTAssertEqual(Double(s.width), 1000 * ScanSettings.roiFraction, accuracy: 0.01)
        XCTAssertEqual(Double(s.height), 1000 / 0.75 * ScanSettings.roiFraction, accuracy: 0.01)
    }

    func testRoiFractionIsSharedByOverlayAndExtractor() {
        // One number, read by both. A reticle that lies is worse than no reticle.
        XCTAssertEqual(ScanSettings.roiFraction, 0.35)
        XCTAssertGreaterThan(ScanSettings.roiFraction, 0)
        XCTAssertLessThan(ScanSettings.roiFraction, 1)
    }
}

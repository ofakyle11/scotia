import XCTest
@testable import TreadScanner

final class ScanGuidanceTests: XCTestCase {
    private func guidance(distance: Double?, tilt: Double? = 2, motion: Double = 0, quality: Double = 0.9) -> ScanGuidance {
        ScanGuidance(distanceM: distance, tiltDegrees: tilt, motionMPerS: motion, highConfidenceFraction: quality)
    }

    func testNoDepthYetIsSearching() {
        XCTAssertEqual(guidance(distance: nil).hint, .searching)
        XCTAssertFalse(guidance(distance: nil).isReady)
    }

    func testDistanceGateComesFirst() {
        XCTAssertEqual(guidance(distance: ScanSettings.minDistanceM - 0.01, quality: 0.1).hint, .tooClose)
        XCTAssertEqual(guidance(distance: ScanSettings.maxDistanceM + 0.01, quality: 0.1).hint, .tooFar)
    }

    func testGoodPoseIsReady() {
        let g = guidance(distance: 0.25)
        XCTAssertEqual(g.hint, .ready)
        XCTAssertTrue(g.isReady)
    }

    func testMovingAndTiltedRefuse() {
        XCTAssertEqual(guidance(distance: 0.25, tilt: ScanSettings.maxTiltDegrees + 1).hint, .tilted)
        XCTAssertEqual(guidance(distance: 0.25, motion: ScanSettings.maxMotionMPerS + 0.01).hint, .moving)
    }

    func testLowQualityInsideGateButCloseSaysMoveBack() {
        // Between the gate's lower bound and closeRangeM, poor confidence is treated as range.
        let close = guidance(distance: (ScanSettings.minDistanceM + ScanSettings.closeRangeM) / 2, quality: 0.2)
        XCTAssertEqual(close.hint, .lowConfidenceClose)
        XCTAssertFalse(close.isReady)
    }

    func testLowQualityAtWorkingRangeSaysCleanTread() {
        let far = guidance(distance: (ScanSettings.closeRangeM + ScanSettings.maxDistanceM) / 2, quality: 0.2)
        XCTAssertEqual(far.hint, .lowConfidence)
        XCTAssertFalse(far.isReady)
    }

    func testCloseRangeSitsInsideTheGate() {
        XCTAssertGreaterThan(ScanSettings.closeRangeM, ScanSettings.minDistanceM)
        XCTAssertLessThan(ScanSettings.closeRangeM, ScanSettings.maxDistanceM)
    }
}

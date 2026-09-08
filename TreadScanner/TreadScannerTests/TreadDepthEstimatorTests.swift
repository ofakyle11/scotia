import XCTest
import simd
@testable import TreadScanner

final class TreadDepthEstimatorTests: XCTestCase {
    /// Synthetic tread patch: a flat surface at 20 cm with three grooves of known depth,
    /// plus Gaussian noise on every point. Camera looks down -z.
    private func synthetic(depthMM: Double, noiseMM: Double, tiltDegrees: Double = 0, seed: UInt64 = 1) -> [SIMD3<Double>] {
        var rng = SplitMix64(seed: seed)
        func gaussian() -> Double {
            let u1 = max(1e-12, Double(rng.next() % 1_000_000) / 1_000_000)
            let u2 = Double(rng.next() % 1_000_000) / 1_000_000
            return (-2 * log(u1)).squareRoot() * cos(2 * .pi * u2)
        }
        let tilt = tiltDegrees * .pi / 180
        var pts: [SIMD3<Double>] = []
        // 60 x 60 grid over 6 cm x 6 cm at 0.20 m
        for iy in 0..<60 {
            for ix in 0..<60 {
                let x = (Double(ix) - 30) * 0.001
                let y = (Double(iy) - 30) * 0.001
                // Grooves: 8 mm wide every 20 mm in x
                let inGroove = (ix % 20) < 8
                var z = -0.20 + x * tan(tilt)
                if inGroove { z -= depthMM / 1000 }
                z += gaussian() * noiseMM / 1000
                pts.append(SIMD3(x, y, z))
            }
        }
        return pts
    }

    func testRecoversKnownDepthOnCleanData() {
        let est = TreadDepthEstimator()
        let frame = est.estimateFrame(points: synthetic(depthMM: 5.0, noiseMM: 0.05))
        XCTAssertNotNil(frame)
        XCTAssertEqual(frame!.depthMM, 5.0, accuracy: 0.15)
    }

    func testRecoversDepthWithTiltedSurface() {
        let est = TreadDepthEstimator()
        let frame = est.estimateFrame(points: synthetic(depthMM: 8.0, noiseMM: 0.1, tiltDegrees: 8))
        XCTAssertNotNil(frame)
        // Groove depth is measured along the plane normal; with 8° tilt the projection is cos(8°)
        XCTAssertEqual(frame!.depthMM, 8.0 * cos(8 * .pi / 180), accuracy: 0.3)
    }

    func testMultiFrameAveragingBeatsSingleFrameNoise() {
        let est = TreadDepthEstimator()
        var frames: [TreadDepthEstimator.FrameEstimate] = []
        for i in 0..<40 {
            // 0.5 mm is the per-point noise expected after the 5x5 smoothing in LiDARSession.
            if let f = est.estimateFrame(points: synthetic(depthMM: 3.2, noiseMM: 0.5, seed: UInt64(i + 10))) {
                frames.append(f)
            }
        }
        XCTAssertGreaterThan(frames.count, 25, "most frames should produce an estimate")
        let result = est.combine(frames)!
        // 3.2 mm is the steer legal minimum (4/32). We must land within ~1/32 of it.
        XCTAssertEqual(result.depthMM, 3.2, accuracy: 0.4)
        XCTAssertEqual(result.method, .scan)
        XCTAssertEqual(result.frameCount, frames.count)
    }

    func testNoGroovesReturnsNil() {
        let est = TreadDepthEstimator()
        // depth 0 = flat plane, no groove points below threshold
        XCTAssertNil(est.estimateFrame(points: synthetic(depthMM: 0, noiseMM: 0.05)))
    }

    func testTooFewPointsReturnsNil() {
        let est = TreadDepthEstimator()
        XCTAssertNil(est.estimateFrame(points: Array(synthetic(depthMM: 5, noiseMM: 0.05).prefix(20))))
    }

    func testPlaneFitNormalPointsTowardCamera() {
        let est = TreadDepthEstimator()
        let plane = est.fitPlane(synthetic(depthMM: 0, noiseMM: 0.01))!
        XCTAssertGreaterThan(plane.normal.z, 0.99)
    }

    func testCombineEmptyIsNil() {
        XCTAssertNil(TreadDepthEstimator().combine([]))
    }

    func testConfidenceFlag() {
        let good = DepthResult(depthMM: 4, uncertaintyMM: 0.5, frameCount: 40, pointCount: 400, method: .scan)
        let bad = DepthResult(depthMM: 4, uncertaintyMM: 2.0, frameCount: 40, pointCount: 400, method: .scan)
        XCTAssertTrue(good.isConfident)
        XCTAssertFalse(bad.isConfident)
    }
}

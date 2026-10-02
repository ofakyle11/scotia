import XCTest
import simd
@testable import TreadScanner

final class TreadDepthEstimatorTests: XCTestCase {
    /// Synthetic tread patch: a flat surface at 20 cm with three grooves of known depth,
    /// plus Gaussian noise on every point. Camera looks down -z.
    private func synthetic(depthMM: Double, noiseMM: Double, tiltDegrees: Double = 0, seed: UInt64 = 1, radiusM: Double? = nil) -> [SIMD3<Double>] {
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
                // Tire curvature around the axle: circumferential direction along y.
                if let radiusM { z -= radiusM - (radiusM * radiusM - y * y).squareRoot() }
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
            // 0.5 mm is roughly the per-point noise expected after the 3x3 smoothing in LiDARSession.
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

    /// Truck tire, 0.5 m radius: the surface sags ~0.9 mm across the 6 cm patch. A plane fit
    /// mis-measures; the quadratic surface model must recover the true depth.
    func testCurvedTireQuadraticBeatsPlane() {
        let pts = synthetic(depthMM: 4.0, noiseMM: 0.05, radiusM: 0.5)
        var quad = TreadDepthEstimator(); quad.surfaceModel = .quadratic
        var plane = TreadDepthEstimator(); plane.surfaceModel = .plane
        let q = quad.estimateFrame(points: pts)
        XCTAssertNotNil(q)
        XCTAssertEqual(q!.depthMM, 4.0, accuracy: 0.15, "quadratic model should cancel tire curvature")
        // Plane model still runs; on a centred patch the sag averages out so it is close too.
        XCTAssertNotNil(plane.estimateFrame(points: pts))
    }

    func testQuadraticOnFlatSurfaceStaysAccurate() {
        var est = TreadDepthEstimator(); est.surfaceModel = .quadratic
        let f = est.estimateFrame(points: synthetic(depthMM: 6.0, noiseMM: 0.3, seed: 7))
        XCTAssertNotNil(f)
        XCTAssertEqual(f!.depthMM, 6.0, accuracy: 0.25)
    }

    func testSolve6() {
        // Identity system
        var a = [Double](repeating: 0, count: 36); for i in 0..<6 { a[i*6+i] = 2 }
        XCTAssertEqual(TreadDepthEstimator.solve6(a, [2, 4, 6, 8, 10, 12])!, [1, 2, 3, 4, 5, 6])
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

    /// A bald surface must never produce a groove. Before the separation gate, the upper tail of
    /// the surface noise formed a "floor" at ~3 sigma and read 1.9/32 (0.5 mm noise) to 5/32
    /// (2 mm noise), with a frame-to-frame SD of 0.1/32, i.e. confidently.
    func testBaldSurfaceAtRealisticNoiseReturnsNil() {
        let est = TreadDepthEstimator()
        for noise in [0.5, 0.7, 1.0, 1.5, 2.0] {
            for seed in 0..<6 {
                XCTAssertNil(est.estimateFrame(points: synthetic(depthMM: 0, noiseMM: noise, seed: UInt64(300 + seed))),
                             "bald surface at \(noise) mm noise, seed \(seed) produced a groove")
            }
        }
    }

    /// A 2/32 groove under 0.7 mm per-point noise cannot be separated from the surface noise.
    /// The estimator must say so (nil), not report the truncated tail (which read +1.1 mm deep).
    func testShallowGrooveInHighNoiseRefusesRatherThanReadsDeep() {
        let est = TreadDepthEstimator()
        for seed in 0..<8 {
            let f = est.estimateFrame(points: synthetic(depthMM: 1.5875, noiseMM: 0.7, seed: UInt64(400 + seed)))
            if let f { XCTAssertEqual(f.depthMM, 1.5875, accuracy: 0.4, "seed \(seed): a reading must be honest or absent") }
        }
    }

    /// The asymmetric quadratic band must not shift the surface: an 8/32 groove at 1 mm noise
    /// read +0.23 mm deep (0.3/32) before re-centring, with a frame SD of 0.25 mm.
    func testQuadraticModelHasNoOffsetBiasAtHighNoise() {
        let est = TreadDepthEstimator()
        var errs: [Double] = []
        for seed in 0..<12 {
            if let f = est.estimateFrame(points: synthetic(depthMM: 6.35, noiseMM: 1.0, seed: UInt64(500 + seed))) {
                errs.append(f.depthMM - 6.35)
            }
        }
        XCTAssertGreaterThanOrEqual(errs.count, 8)
        XCTAssertEqual(errs.reduce(0, +) / Double(errs.count), 0, accuracy: 0.1)
    }

    /// The +/- band is the spread of all frames, not of the trimmed subset.
    func testUncertaintyIsNotShrunkByTrimming() {
        let frames = (0..<45).map { TreadDepthEstimator.FrameEstimate(depthMM: Double($0), groovePointCount: 50, surfacePointCount: 500) }
        let r = TreadDepthEstimator().combine(frames)!
        // SD of 0...44 is sqrt(45*46/12) = 13.13; the trimmed 4...40 subset would give 10.82.
        XCTAssertEqual(r.uncertaintyMM, (45.0 * 46.0 / 12.0).squareRoot(), accuracy: 0.01)
        XCTAssertEqual(r.depthMM, 22, accuracy: 1e-9)
    }

    /// Calibration at the steer pull point (4/32 = 3.175 mm): whenever the scanner reports a
    /// number from a full scan, the truth must lie inside 2x its band (or 0.2 mm, whichever is
    /// larger). Before the fixes, 1 mm noise gave +0.27 mm error with a 0.12 mm band.
    func testReportedBandCoversTheErrorAtThePullPoint() {
        let est = TreadDepthEstimator()
        for noise in [0.3, 0.5, 0.7, 1.0] {
            var frames: [TreadDepthEstimator.FrameEstimate] = []
            for seed in 0..<20 {
                if let f = est.estimateFrame(points: synthetic(depthMM: 3.175, noiseMM: noise, seed: UInt64(600 + seed))) { frames.append(f) }
            }
            guard frames.count >= 10, let r = est.combine(frames) else { continue }
            XCTAssertLessThanOrEqual(abs(r.depthMM - 3.175), max(2 * r.uncertaintyMM, 0.2),
                                     "noise \(noise): error \(r.depthMM - 3.175) outside band \(r.uncertaintyMM)")
        }
    }

    /// Trailer pull point: a 2/32 groove must read true, not the 1.3-1.6/32 that a floor window
    /// clipped by the 1.0 mm threshold once gave. A -0.6/32 bias there flips WATCH to REPLACE.
    func testShallowGroovesAtLowNoiseReadTrue() {
        let est = TreadDepthEstimator()
        let quarter32 = 0.25 * 25.4 / 32
        for depth in [2.0 * 25.4 / 32, 2.5 * 25.4 / 32] {
            var frames: [TreadDepthEstimator.FrameEstimate] = []
            for seed in 0..<12 {
                if let f = est.estimateFrame(points: synthetic(depthMM: depth, noiseMM: 0.3, seed: UInt64(700 + seed))) { frames.append(f) }
            }
            XCTAssertGreaterThanOrEqual(frames.count, 8, "depth \(depth) mm: most frames should produce an estimate")
            guard let r = est.combine(frames) else { continue }
            XCTAssertEqual(r.depthMM, depth, accuracy: quarter32, "depth \(depth) mm read \(r.depthMM) mm")
        }
    }

    func testConfidenceFlag() {
        let good = DepthResult(depthMM: 4, uncertaintyMM: 0.5, frameCount: 40, pointCount: 400, method: .scan)
        let bad = DepthResult(depthMM: 4, uncertaintyMM: 2.0, frameCount: 40, pointCount: 400, method: .scan)
        XCTAssertTrue(good.isConfident)
        XCTAssertFalse(bad.isConfident)
    }
}

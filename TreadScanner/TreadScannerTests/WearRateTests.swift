import XCTest
@testable import TreadScanner

final class WearRateTests: XCTestCase {
    // 12/32 down to 8/32 over 100,000 km = 4/32 per 100,000 km = 0.4/32 per 10,000 km.
    func testNormalWearRate() {
        let samples = [WearSample(odometer: 400_000, depth32: 12), WearSample(odometer: 500_000, depth32: 8)]
        let rate = WearRate.per10kKM(samples)
        XCTAssertNotNil(rate)
        XCTAssertEqual(rate ?? 0, 0.4, accuracy: 0.0001)
    }

    func testRateUsesFirstAndLastSample() {
        let samples = [
            WearSample(odometer: 400_000, depth32: 12),
            WearSample(odometer: 450_000, depth32: 11),   // ignored except as a middle point
            WearSample(odometer: 500_000, depth32: 8)
        ]
        XCTAssertEqual(WearRate.per10kKM(samples) ?? 0, 0.4, accuracy: 0.0001)
    }

    func testSingleInspectionHasNoRate() {
        XCTAssertNil(WearRate.per10kKM([WearSample(odometer: 400_000, depth32: 12)]))
    }

    func testNoSamplesHasNoRate() {
        XCTAssertNil(WearRate.per10kKM([]))
    }

    /// Missing odometers leave fewer than two usable samples, so there is nothing to divide by.
    func testMissingOdometerLeavesTooFewSamples() {
        let readings: [(Int?, Double?)] = [(nil, 12), (500_000, 8), (nil, 6)]
        let samples: [WearSample] = readings.compactMap { (odo, depth) -> WearSample? in
            guard let odo, let depth else { return nil }
            return WearSample(odometer: odo, depth32: depth)
        }
        XCTAssertEqual(samples.count, 1)
        XCTAssertNil(WearRate.per10kKM(samples))
    }

    func testSameOdometerDoesNotDivideByZero() {
        let samples = [WearSample(odometer: 500_000, depth32: 12), WearSample(odometer: 500_000, depth32: 8)]
        XCTAssertNil(WearRate.per10kKM(samples))
    }

    func testBackwardsOdometerIsRejected() {
        let samples = [WearSample(odometer: 500_000, depth32: 12), WearSample(odometer: 400_000, depth32: 8)]
        XCTAssertNil(WearRate.per10kKM(samples))
    }

    /// New tires on the same position read as negative wear; a rate is still reported but it is not projectable.
    func testNegativeWearRate() {
        let samples = [WearSample(odometer: 400_000, depth32: 6), WearSample(odometer: 500_000, depth32: 20)]
        let rate = WearRate.per10kKM(samples)
        XCTAssertNotNil(rate)
        XCTAssertLessThan(rate ?? 0, 0)
        XCTAssertNil(WearRate.projectedKM(currentDepth32: 20, minimum32: 2, ratePer10kKM: rate ?? 0))
    }

    // (10/32 − 2/32) ÷ 0.4 per 10,000 km = 200,000 km.
    func testProjectedKM() {
        let km = WearRate.projectedKM(currentDepth32: 10, minimum32: 2, ratePer10kKM: 0.4)
        XCTAssertEqual(km ?? 0, 200_000, accuracy: 0.5)
    }

    func testProjectedKMClampsAtZeroWhenAlreadyAtMinimum() {
        XCTAssertEqual(WearRate.projectedKM(currentDepth32: 1, minimum32: 4, ratePer10kKM: 0.4) ?? -1, 0, accuracy: 0.0001)
    }

    func testProjectedKMNilForZeroRate() {
        XCTAssertNil(WearRate.projectedKM(currentDepth32: 10, minimum32: 2, ratePer10kKM: 0))
    }

    func testSteerMinimumShortensProjection() {
        let steer = WearRate.projectedKM(currentDepth32: 10, minimum32: Thresholds().steerMinimum32, ratePer10kKM: 0.4) ?? 0
        let other = WearRate.projectedKM(currentDepth32: 10, minimum32: Thresholds().otherMinimum32, ratePer10kKM: 0.4) ?? 0
        XCTAssertLessThan(steer, other)
    }
}

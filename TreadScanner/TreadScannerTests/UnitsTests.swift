import XCTest
@testable import TreadScanner

final class UnitsTests: XCTestCase {
    func testOne32ndIsPoint79mm() {
        XCTAssertEqual(Units.mm(from32nds: 1), 0.79375, accuracy: 1e-9)
    }

    func testRoundTrip() {
        for v in [2.0, 4.0, 7.5, 12.0, 32.0] {
            XCTAssertEqual(Units.thirtySeconds(fromMM: Units.mm(from32nds: v)), v, accuracy: 1e-9)
        }
    }

    func testLegalMinimumsInMM() {
        XCTAssertEqual(Units.mm(from32nds: 4), 3.175, accuracy: 1e-9)  // steer
        XCTAssertEqual(Units.mm(from32nds: 2), 1.5875, accuracy: 1e-9) // drive/trailer
    }

    func testFormatting() {
        XCTAssertEqual(Units.format32(7), "7/32")
        XCTAssertEqual(Units.format32(7.4), "7.5/32")
        XCTAssertEqual(Units.format32(7.2), "7/32")
        XCTAssertEqual(Units.format32(nil), "—")
        XCTAssertEqual(Units.formatMM(3.175), "3.2 mm")
    }

    func testUncertaintyNeverRoundsToZero() {
        // What TireDetailView.apply did before: a ±0.24/32 band stored and exported as 0.0.
        XCTAssertEqual(Units.roundedHalf32(0.24), 0)
        XCTAssertEqual(Units.ceilHalf32(0.24), 0.5)
        XCTAssertEqual(Units.ceilHalf32(0.51), 1.0)
        XCTAssertEqual(Units.ceilHalf32(1.5), 1.5)
        XCTAssertEqual(Units.ceilHalf32(0), 0.5)
    }

    func testThresholdStatus() {
        let t = Thresholds(steerMinimum32: 4, otherMinimum32: 2, watchBand32: 2)
        XCTAssertEqual(t.status(depth32: 4, role: .steer), .replace)
        XCTAssertEqual(t.status(depth32: 5, role: .steer), .watch)
        XCTAssertEqual(t.status(depth32: 6, role: .steer), .watch)
        XCTAssertEqual(t.status(depth32: 7, role: .steer), .ok)
        XCTAssertEqual(t.status(depth32: 2, role: .drive), .replace)
        XCTAssertEqual(t.status(depth32: 3, role: .trailer), .watch)
        XCTAssertEqual(t.status(depth32: 5, role: .drive), .ok)
        XCTAssertEqual(t.status(depth32: nil, role: .drive), .unknown)
    }
}

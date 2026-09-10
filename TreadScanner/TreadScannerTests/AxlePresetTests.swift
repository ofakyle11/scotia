import XCTest
@testable import TreadScanner

final class AxlePresetTests: XCTestCase {
    func testStraightTruck() {
        XCTAssertEqual(AxlePreset.straightTruck2Axle.positions.map(\.code), ["LF", "LRO", "LRI", "RRO", "RRI", "RF"])
    }

    func testTractor3Axle() {
        // Walk order: left side front to back, around the rear, right side back to front.
        XCTAssertEqual(AxlePreset.tractor3Axle.positions.map(\.code),
                       ["LF", "L2O", "L2I", "LRO", "LRI", "RRO", "RRI", "R2O", "R2I", "RF"])
    }

    func testTandemTrailer() {
        XCTAssertEqual(AxlePreset.tandemTrailer.positions.map(\.code), ["LFO", "LFI", "LRO", "LRI", "RRO", "RRI", "RFO", "RFI"])
    }

    func testTriAxleTrailerHasTwelve() {
        XCTAssertEqual(AxlePreset.triAxleTrailer.positions.count, 12)
    }

    func testRolesAndInnerFlags() {
        let p = AxlePreset.tractor3Axle.positions
        XCTAssertEqual(p.first { $0.code == "LF" }?.role, .steer)
        XCTAssertEqual(p.first { $0.code == "LRI" }?.isInner, true)
        XCTAssertEqual(p.first { $0.code == "LRO" }?.isInner, false)
        XCTAssertEqual(p.first { $0.code == "LRO" }?.role, .drive)
    }

    func testCustomAxles() {
        let axles = [AxleSpec(dual: false, role: .steer), AxleSpec(dual: false, role: .steer), AxleSpec(dual: true, role: .drive)]
        XCTAssertEqual(AxlePreset.positions(for: axles).map(\.code), ["LF", "L2", "LRO", "LRI", "RRO", "RRI", "R2", "RF"])
    }

    func testWalkOrderNeverCrossesTheTruckMidway() {
        // Sides must form exactly two contiguous runs: all left, then all right.
        let sides = AxlePreset.tractor3Axle.positions.map(\.side)
        let changes = zip(sides, sides.dropFirst()).filter { $0 != $1 }.count
        XCTAssertEqual(changes, 1)
        XCTAssertEqual(sides.first, .left)
    }

    func testPositionsRoundTripJSON() throws {
        let pos = AxlePreset.tractor3Axle.positions
        let data = try JSONEncoder().encode(pos)
        XCTAssertEqual(try JSONDecoder().decode([TirePosition].self, from: data), pos)
    }
}

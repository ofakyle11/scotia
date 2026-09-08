import XCTest
@testable import TreadScanner

final class AxlePresetTests: XCTestCase {
    func testStraightTruck() {
        XCTAssertEqual(AxlePreset.straightTruck2Axle.positions.map(\.code), ["LF", "RF", "LRO", "LRI", "RRO", "RRI"])
    }

    func testTractor3Axle() {
        XCTAssertEqual(AxlePreset.tractor3Axle.positions.map(\.code),
                       ["LF", "RF", "L2O", "L2I", "R2O", "R2I", "LRO", "LRI", "RRO", "RRI"])
    }

    func testTandemTrailer() {
        XCTAssertEqual(AxlePreset.tandemTrailer.positions.map(\.code), ["LFO", "LFI", "RFO", "RFI", "LRO", "LRI", "RRO", "RRI"])
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
        XCTAssertEqual(AxlePreset.positions(for: axles).map(\.code), ["LF", "RF", "L2", "R2", "LRO", "LRI", "RRO", "RRI"])
    }

    func testPositionsRoundTripJSON() throws {
        let pos = AxlePreset.tractor3Axle.positions
        let data = try JSONEncoder().encode(pos)
        XCTAssertEqual(try JSONDecoder().decode([TirePosition].self, from: data), pos)
    }
}

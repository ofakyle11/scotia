import XCTest
@testable import TreadScanner

final class YardCheckDocumentTests: XCTestCase {
    func testSlotNumbering() {
        let lo = TirePosition(code: "LRO", axleIndex: 2, side: .left, isDual: true, isInner: false, role: .drive)
        let li = TirePosition(code: "LRI", axleIndex: 2, side: .left, isDual: true, isInner: true, role: .drive)
        let ri = TirePosition(code: "RRI", axleIndex: 2, side: .right, isDual: true, isInner: true, role: .drive)
        let ro = TirePosition(code: "RRO", axleIndex: 2, side: .right, isDual: true, isInner: false, role: .drive)
        let lf = TirePosition(code: "LF", axleIndex: 1, side: .left, isDual: false, isInner: false, role: .steer)
        let rf = TirePosition(code: "RF", axleIndex: 1, side: .right, isDual: false, isInner: false, role: .steer)
        XCTAssertEqual([lo, li, ri, ro].map(YardCheckDocument.slot), [1, 2, 3, 4])
        XCTAssertEqual([lf, rf].map(YardCheckDocument.slot), [1, 2])
    }

    func testConfigCode() {
        let tractor = [YardCheckDocument.Axle(role: .steer, dual: false, size: ""), .init(role: .drive, dual: true, size: ""), .init(role: .drive, dual: true, size: "")]
        XCTAssertEqual(YardCheckDocument.configCode(tractor), "2S-4D-4D")
        let trailer = [YardCheckDocument.Axle(role: .tag, dual: true, size: ""), .init(role: .trailer, dual: true, size: ""), .init(role: .trailer, dual: true, size: "")]
        XCTAssertEqual(YardCheckDocument.configCode(trailer), "4TL-4T-4T")
    }

    func testPolicyJSONFallsBackToShopThresholds() {
        let json = YardCheckDocument.policyJSON(nil)
        let steer = json["steer"] as? [String: Any]
        XCTAssertEqual(steer?["pull"] as? Int, Thresholds.current.minimum(for: .steer))
        XCTAssertEqual((json["drive"] as? [String: Any])?["retreads"] as? Bool, true)
    }

    @MainActor
    func testDocumentBuildsFromSwiftData() throws {
        let schema = Schema([Customer.self, Vehicle.self, Inspection.self, TireReading.self, SyncQueueItem.self, VerifySample.self, Survey.self, FleetPolicy.self])
        let container = try ModelContainer(for: schema, configurations: [ModelConfiguration(isStoredInMemoryOnly: true)])
        let ctx = ModelContext(container)
        let customer = Customer(name: "GFL"); ctx.insert(customer)
        let vehicle = Vehicle(unitNumber: "215008", customer: customer); vehicle.vehicleType = "Tractor - Class 8"; ctx.insert(vehicle)
        let survey = Survey(fleet: "GFL", location: "Clarington", reportedBy: "MF"); ctx.insert(survey)
        let ins = Inspection(vehicle: vehicle, technician: "MF", odometer: nil, preset: .tractor3Axle); ins.survey = survey; ctx.insert(ins)
        let r = TireReading(positionCode: "LF", inspection: ins); r.depthInner32 = 5; r.depthCentre32 = 5; r.depthOuter32 = 6; r.size = "425/65R22.5"; r.valveCap = .missing; ctx.insert(r)
        let policy = FleetPolicy(customerName: "GFL"); policy.steerPull32 = 7; policy.steerRecPSI = 120; ctx.insert(policy)
        try ctx.save()

        let doc = YardCheckDocument.build(survey: survey, context: ctx)
        let vehicles = doc["vehicles"] as! [[String: Any]]
        XCTAssertEqual(vehicles.count, 1)
        XCTAssertEqual(vehicles[0]["unit"] as? String, "215008")
        XCTAssertEqual(vehicles[0]["type"] as? String, "Tractor - Class 8")
        let axles = vehicles[0]["axles"] as! [[String: Any]]
        XCTAssertEqual(axles.count, 3)
        XCTAssertEqual(axles[0]["size"] as? String, "425/65R22.5")
        let tires = vehicles[0]["tires"] as! [[String: Any]]
        XCTAssertEqual(tires.count, 10)
        let lf = tires.first { ($0["code"] as? String) == "LF" }!
        XCTAssertEqual(lf["slot"] as? Int, 1); XCTAssertEqual(lf["valveCap"] as? String, "missing")
        let pol = (doc["policy"] as! [String: Any])["default"] as! [String: Any]
        XCTAssertEqual((pol["steer"] as! [String: Any])["pull"] as? Int, 7)
        XCTAssertEqual((pol["steer"] as! [String: Any])["recPsi"] as? Int, 120)
        XCTAssertFalse(YardCheckDocument.json(doc).isEmpty)
    }
}

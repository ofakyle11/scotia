import XCTest
import SwiftData
@testable import TreadScanner

@MainActor
final class SpreadsheetRowTests: XCTestCase {
    private func makeInspection() throws -> (ModelContext, Inspection) {
        let schema = Schema([Customer.self, Vehicle.self, Inspection.self, TireReading.self, SyncQueueItem.self, VerifySample.self, Survey.self, FleetPolicy.self])
        let container = try ModelContainer(for: schema, configurations: [ModelConfiguration(isStoredInMemoryOnly: true)])
        let ctx = ModelContext(container)
        let customer = Customer(name: "Acme Freight, Inc.")
        let vehicle = Vehicle(unitNumber: "42", plate: "ABC 123", vin: "1FUJ...", customer: customer)
        ctx.insert(customer); ctx.insert(vehicle)
        let inspection = Inspection(vehicle: vehicle, technician: "MF", odometer: 512000, preset: .straightTruck2Axle)
        ctx.insert(inspection)
        let r = TireReading(positionCode: "LF", inspection: inspection)
        r.depthInner32 = 6; r.depthCentre32 = 5; r.depthOuter32 = 7
        r.method = .scan; r.scanConfidence32 = 0.5; r.notes = "cupping, \"outer\" edge"
        ctx.insert(r)
        try ctx.save()
        return (ctx, inspection)
    }

    func testHeaderHas37Columns() {
        XCTAssertEqual(SpreadsheetRow.header.count, 37)
        XCTAssertEqual(SpreadsheetRow.header.first, "inspection_id")
        XCTAssertEqual(SpreadsheetRow.header[24], "scan_confidence_32nds")
        XCTAssertEqual(SpreadsheetRow.header.last, "retreads_allowed")
    }

    func testOneRowPerPositionWithValues() throws {
        let (_, inspection) = try makeInspection()
        let rows = SpreadsheetRow.rows(for: inspection, thresholds: Thresholds())
        XCTAssertEqual(rows.count, 6)
        for row in rows { XCTAssertEqual(row.count, SpreadsheetRow.header.count) }
        let lf = rows[0]
        func col(_ name: String) -> String { lf[SpreadsheetRow.header.firstIndex(of: name)!] }
        XCTAssertEqual(col("position"), "LF")
        XCTAssertEqual(col("customer"), "Acme Freight, Inc.")
        XCTAssertEqual(col("axle_config"), "TRUCK_2A")
        XCTAssertEqual(col("depth_min_32nds"), "5.0")
        XCTAssertEqual(col("depth_min_mm"), "3.97")
        XCTAssertEqual(col("status"), "WATCH")   // steer, 5/32 is within the watch band above 4/32
        XCTAssertEqual(col("method"), "scan")
        XCTAssertEqual(col("scan_confidence_32nds"), "0.5")
        // Unmeasured position: blank depth, blank status/method
        let rf = rows[1]
        XCTAssertEqual(rf[SpreadsheetRow.header.firstIndex(of: "depth_min_32nds")!], "")
        XCTAssertEqual(rf[SpreadsheetRow.header.firstIndex(of: "status")!], "")
        XCTAssertEqual(rf[SpreadsheetRow.header.firstIndex(of: "method")!], "")
    }

    /// A customer with a fleet policy must get that policy's pull point in status and
    /// pull_point_32nds, on every path that writes a row (share-sheet CSV included).
    func testFleetPolicyPullPointDrivesStatusAndColumn() throws {
        let (ctx, inspection) = try makeInspection()
        let policy = FleetPolicy(customerName: "Acme Freight, Inc.", thresholds: Thresholds())
        policy.steerPull32 = 7
        ctx.insert(policy); try ctx.save()
        func col(_ row: [String], _ name: String) -> String { row[SpreadsheetRow.header.firstIndex(of: name)!] }
        let shop = SpreadsheetRow.rows(for: inspection, thresholds: Thresholds())[0]
        XCTAssertEqual(col(shop, "status"), "WATCH")
        XCTAssertEqual(col(shop, "pull_point_32nds"), "4")
        let fleet = SpreadsheetRow.rows(for: inspection, thresholds: Thresholds(), policy: policy)[0]
        XCTAssertEqual(col(fleet, "status"), "REPLACE")      // 5/32 steer, pull point 7
        XCTAssertEqual(col(fleet, "pull_point_32nds"), "7")
        let found = FleetPolicy.find("Acme Freight, Inc.", in: ctx)
        XCTAssertNotNil(found)
        let csv = CSVExporter.csv(for: inspection, policy: found)
        XCTAssertTrue(csv.split(separator: "\r\n")[1].contains(",REPLACE,"), "share-sheet CSV must carry the fleet policy")
    }

    func testCSVEscaping() throws {
        let (_, inspection) = try makeInspection()
        let csv = CSVExporter.csv(for: inspection)
        let lines = csv.split(separator: "\r\n")
        XCTAssertEqual(lines.count, 7) // header + 6
        XCTAssertTrue(lines[0].hasPrefix("inspection_id,date,technician"))
        XCTAssertTrue(lines[1].contains("\"Acme Freight, Inc.\""))
        XCTAssertTrue(lines[1].contains("\"cupping, \"\"outer\"\" edge\""))
    }

    func testEscapeRules() {
        XCTAssertEqual(CSVExporter.escape("plain"), "plain")
        XCTAssertEqual(CSVExporter.escape("a,b"), "\"a,b\"")
        XCTAssertEqual(CSVExporter.escape("say \"hi\""), "\"say \"\"hi\"\"\"")
    }
}

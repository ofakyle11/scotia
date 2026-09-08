import Foundation
import SwiftData

/// One row waiting to be appended to Google Sheets. Rows are grouped by inspection so
/// they land together, but each is retried independently.
@Model
final class SyncQueueItem {
    @Attribute(.unique) var id: UUID
    var inspectionID: UUID
    var sheetName: String
    /// JSON-encoded [String] cells
    var rowJSON: Data
    var createdAt: Date
    var attempts: Int
    var lastError: String?
    var lastErrorAt: Date?

    init(inspectionID: UUID, sheetName: String, cells: [String]) {
        self.id = UUID()
        self.inspectionID = inspectionID
        self.sheetName = sheetName
        self.rowJSON = (try? JSONEncoder().encode(cells)) ?? Data()
        self.createdAt = Date()
        self.attempts = 0
    }

    var cells: [String] { (try? JSONDecoder().decode([String].self, from: rowJSON)) ?? [] }
}

/// Scan vs gauge pair for the LiDAR accuracy study (Verify mode).
@Model
final class VerifySample {
    @Attribute(.unique) var id: UUID
    var date: Date
    var technician: String
    var label: String
    var scan32: Double
    var scanConfidence32: Double
    var gauge32: Double
    var frameCount: Int

    init(technician: String, label: String, scan32: Double, scanConfidence32: Double, gauge32: Double, frameCount: Int) {
        self.id = UUID()
        self.date = Date()
        self.technician = technician
        self.label = label
        self.scan32 = scan32
        self.scanConfidence32 = scanConfidence32
        self.gauge32 = gauge32
        self.frameCount = frameCount
    }

    var error32: Double { scan32 - gauge32 }
}

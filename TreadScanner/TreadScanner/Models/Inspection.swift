import Foundation
import SwiftData

enum SyncState: String, Codable {
    case notQueued, pending, synced, failed
}

@Model
final class Inspection {
    @Attribute(.unique) var id: UUID
    var date: Date
    var technician: String
    var odometer: Int?
    var axlePresetRaw: String
    /// JSON-encoded [TirePosition]; lets Custom presets persist their layout.
    var positionsJSON: Data
    var isComplete: Bool
    var syncStateRaw: String
    var notes: String
    var vehicle: Vehicle?
    @Relationship(deleteRule: .cascade, inverse: \TireReading.inspection) var readings: [TireReading] = []

    init(vehicle: Vehicle?, technician: String, odometer: Int?, preset: AxlePreset, positions: [TirePosition]? = nil) {
        self.id = UUID()
        self.date = Date()
        self.technician = technician
        self.odometer = odometer
        self.axlePresetRaw = preset.rawValue
        let pos = positions ?? preset.positions
        self.positionsJSON = (try? JSONEncoder().encode(pos)) ?? Data()
        self.isComplete = false
        self.syncStateRaw = SyncState.notQueued.rawValue
        self.notes = ""
        self.vehicle = vehicle
    }

    var preset: AxlePreset { AxlePreset(rawValue: axlePresetRaw) ?? .custom }

    var positions: [TirePosition] {
        (try? JSONDecoder().decode([TirePosition].self, from: positionsJSON)) ?? []
    }

    var syncState: SyncState {
        get { SyncState(rawValue: syncStateRaw) ?? .notQueued }
        set { syncStateRaw = newValue.rawValue }
    }

    func reading(for position: TirePosition) -> TireReading? {
        readings.first { $0.positionCode == position.code }
    }

    var completedCount: Int {
        positions.filter { reading(for: $0)?.hasDepth == true }.count
    }

    /// Short human id for the spreadsheet, e.g. 20260908-1432-AB12
    var shortID: String {
        let f = DateFormatter()
        f.dateFormat = "yyyyMMdd-HHmm"
        let suffix = id.uuidString.prefix(4)
        return "\(f.string(from: date))-\(suffix)"
    }
}

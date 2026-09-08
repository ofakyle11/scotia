import Foundation
import SwiftData

enum ReadingMethod: String, Codable, CaseIterable {
    case scan, gauge, manual
}

@Model
final class TireReading {
    @Attribute(.unique) var id: UUID
    var positionCode: String
    var depthInner32: Double?
    var depthCentre32: Double?
    var depthOuter32: Double?
    /// ± band in 32nds reported by the scanner; nil for manual/gauge.
    var scanConfidence32: Double?
    var methodRaw: String
    var pressurePSI: Int?
    var dotCode: String
    var brand: String
    var model: String
    var size: String
    var photoFilename: String?
    var notes: String
    var updatedAt: Date
    var inspection: Inspection?

    init(positionCode: String, inspection: Inspection?) {
        self.id = UUID()
        self.positionCode = positionCode
        self.methodRaw = ReadingMethod.manual.rawValue
        self.dotCode = ""
        self.brand = ""
        self.model = ""
        self.size = ""
        self.notes = ""
        self.updatedAt = Date()
        self.inspection = inspection
    }

    var method: ReadingMethod {
        get { ReadingMethod(rawValue: methodRaw) ?? .manual }
        set { methodRaw = newValue.rawValue }
    }

    var grooves: [Double] { [depthInner32, depthCentre32, depthOuter32].compactMap { $0 } }
    var hasDepth: Bool { !grooves.isEmpty }
    var depthMin32: Double? { grooves.min() }
    var depthMinMM: Double? { depthMin32.map(Units.mm(from32nds:)) }

    /// Spread between grooves; large values suggest alignment or inflation issues.
    var unevenWear32: Double? {
        guard let lo = grooves.min(), let hi = grooves.max() else { return nil }
        return hi - lo
    }
}

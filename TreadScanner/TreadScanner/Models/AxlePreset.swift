import Foundation

enum AxlePreset: String, Codable, CaseIterable, Identifiable {
    case straightTruck2Axle
    case tractor3Axle
    case tandemTrailer
    case triAxleTrailer
    case custom

    var id: String { rawValue }

    var label: String {
        switch self {
        case .straightTruck2Axle: return "Straight truck (2 axle)"
        case .tractor3Axle: return "Tractor (3 axle)"
        case .tandemTrailer: return "Tandem trailer"
        case .triAxleTrailer: return "Tri-axle trailer"
        case .custom: return "Custom"
        }
    }

    /// Spreadsheet-friendly code.
    var code: String {
        switch self {
        case .straightTruck2Axle: return "TRUCK_2A"
        case .tractor3Axle: return "TRACTOR_3A"
        case .tandemTrailer: return "TRAILER_2A"
        case .triAxleTrailer: return "TRAILER_3A"
        case .custom: return "CUSTOM"
        }
    }

    var axles: [AxleSpec] {
        switch self {
        case .straightTruck2Axle:
            return [AxleSpec(dual: false, role: .steer), AxleSpec(dual: true, role: .drive)]
        case .tractor3Axle:
            return [AxleSpec(dual: false, role: .steer), AxleSpec(dual: true, role: .drive), AxleSpec(dual: true, role: .drive)]
        case .tandemTrailer:
            return [AxleSpec(dual: true, role: .trailer), AxleSpec(dual: true, role: .trailer)]
        case .triAxleTrailer:
            return [AxleSpec(dual: true, role: .trailer), AxleSpec(dual: true, role: .trailer), AxleSpec(dual: true, role: .trailer)]
        case .custom:
            return [AxleSpec(dual: false, role: .steer), AxleSpec(dual: true, role: .drive)]
        }
    }

    var positions: [TirePosition] { AxlePreset.positions(for: axles) }

    /// Positions in the order a technician walks them: down the left side front to back,
    /// around the rear, then up the right side back to front. On duals the outer tire is
    /// reached first, then the inner behind it. This is also the row order in the export.
    static func positions(for axles: [AxleSpec]) -> [TirePosition] {
        let perAxle = axles.enumerated().map { idx, spec in
            TirePosition.positions(axleIndex: idx + 1, axleCount: axles.count, dual: spec.dual, role: spec.role)
        }
        let left = perAxle.flatMap { $0.filter { $0.side == .left } }                  // front → back, O then I
        let right = perAxle.reversed().flatMap { $0.filter { $0.side == .right } }    // back → front, O then I
        return left + right
    }
}

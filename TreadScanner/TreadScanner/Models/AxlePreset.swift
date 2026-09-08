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

    static func positions(for axles: [AxleSpec]) -> [TirePosition] {
        axles.enumerated().flatMap { idx, spec in
            TirePosition.positions(axleIndex: idx + 1, axleCount: axles.count, dual: spec.dual, role: spec.role)
        }
    }
}

import Foundation
import SwiftData

/// Builds the survey document consumed by yardcheck.js (bundled as a resource). The JSON
/// shape is the contract shared with the web app and the PC tool; every statistic is computed
/// by the renderer, so all three produce identical reports from identical readings.
enum YardCheckDocument {
    static func build(survey: Survey, context: ModelContext, brandName: String = "Scotia Tire & Alignment") -> [String: Any] {
        let inspections = survey.inspections.sorted { $0.date < $1.date }
        let policy = FleetPolicy.find(survey.fleet, in: context)
        let df = ISO8601DateFormatter(); df.formatOptions = [.withFullDate]
        return [
            "survey": [
                "id": survey.surveyNumber, "fleet": survey.fleet, "location": survey.location, "account": survey.account,
                "dates": Array(Set(inspections.map { df.string(from: $0.date) })).sorted().nonEmpty ?? [df.string(from: survey.date)],
                "reportedBy": survey.reportedBy,
                "participants": survey.participants.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty },
                "generated": df.string(from: Date()),
            ] as [String: Any],
            "policy": ["default": policyJSON(policy)],
            "brand": ["name": brandName],
            "vehicles": inspections.map { vehicleJSON($0) },
        ]
    }

    static func policyJSON(_ p: FleetPolicy?) -> [String: Any] {
        let t = Thresholds.current
        var out: [String: Any] = [:]
        for role in AxleRole.allCases {
            let r = p?.role(role)
            out[role.rawValue] = [
                "pull": r?.pull ?? t.minimum(for: role),
                "recPsi": r?.recPSI as Any, "minPsi": r?.minPSI as Any,
                "retreads": r?.retreads ?? (role != .steer),
            ]
        }
        return out
    }

    static func vehicleJSON(_ ins: Inspection) -> [String: Any] {
        let positions = ins.positions
        let axles = axleList(ins)
        let tires: [[String: Any]] = positions.map { p in
            let r = ins.reading(for: p)
            return [
                "axle": p.axleIndex, "slot": slot(p), "code": p.code,
                "inner": r?.depthInner32 as Any, "centre": r?.depthCentre32 as Any, "outer": r?.depthOuter32 as Any,
                "psi": r?.pressurePSI as Any, "valveCap": r?.valveCap.rawValue ?? "ok", "notes": r?.notes ?? "",
            ]
        }
        return [
            "unit": ins.vehicle?.unitNumber ?? "", "type": ins.vehicle?.vehicleType ?? "",
            "axles": axles.map { ["role": $0.role.rawValue, "dual": $0.dual, "size": $0.size] },
            "tires": tires, "notes": ins.notes,
        ]
    }

    struct Axle { var role: AxleRole; var dual: Bool; var size: String }

    static func axleList(_ ins: Inspection) -> [Axle] {
        var byAxle: [Int: Axle] = [:]
        for p in ins.positions {
            if byAxle[p.axleIndex] == nil { byAxle[p.axleIndex] = Axle(role: p.role, dual: p.isDual, size: "") }
            if let size = ins.reading(for: p)?.size, !size.isEmpty, byAxle[p.axleIndex]!.size.isEmpty { byAxle[p.axleIndex]!.size = size }
        }
        return byAxle.keys.sorted().map { byAxle[$0]! }
    }

    /// Bridgestone slot numbering, left to right: singles 1,2; duals 1 LO, 2 LI, 3 RI, 4 RO.
    static func slot(_ p: TirePosition) -> Int {
        if !p.isDual { return p.side == .left ? 1 : 2 }
        if p.side == .left { return p.isInner ? 2 : 1 }
        return p.isInner ? 3 : 4
    }

    /// "2S-4D-4D": tire count + role letter per axle.
    static func configCode(_ axles: [Axle]) -> String {
        axles.map { a in
            let letter: String
            switch a.role { case .steer: letter = "S"; case .drive: letter = "D"; case .trailer: letter = "T"; case .tag: letter = "TL" }
            return "\(a.dual ? 4 : 2)\(letter)"
        }.joined(separator: "-")
    }

    static func json(_ doc: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: doc, options: [.sortedKeys]) else { return "{}" }
        return String(decoding: data, as: UTF8.self)
    }
}

private extension Array {
    var nonEmpty: [Element]? { isEmpty ? nil : self }
}

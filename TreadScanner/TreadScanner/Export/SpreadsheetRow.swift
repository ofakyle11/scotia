import Foundation

/// Canonical column order for the Inspections sheet and the CSV export.
enum SpreadsheetRow {
    static let header: [String] = [
        "inspection_id", "date", "technician", "customer", "unit_number", "plate", "vin",
        "odometer", "axle_config", "position", "brand", "model", "size", "dot_code",
        "depth_inner_32nds", "depth_centre_32nds", "depth_outer_32nds", "depth_min_32nds",
        "depth_min_mm", "pressure_psi", "status", "method", "photo_url", "notes",
        "scan_confidence_32nds"
    ]

    static let verifyHeader: [String] = [
        "date", "technician", "label", "scan_32nds", "scan_confidence_32nds", "gauge_32nds", "error_32nds", "frames"
    ]

    private static let dateFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withFullDate, .withTime, .withColonSeparatorInTime]
        f.timeZone = .current
        return f
    }()

    static func rows(for inspection: Inspection, thresholds: Thresholds = .current) -> [[String]] {
        inspection.positions.map { position in
            let r = inspection.reading(for: position)
            let status = thresholds.status(depth32: r?.depthMin32, role: position.role)
            return [
                inspection.shortID,
                dateFormatter.string(from: inspection.date),
                inspection.technician,
                inspection.vehicle?.customer?.name ?? "",
                inspection.vehicle?.unitNumber ?? "",
                inspection.vehicle?.plate ?? "",
                inspection.vehicle?.vin ?? "",
                inspection.odometer.map { String($0) } ?? "",
                inspection.preset.code,
                position.code,
                r?.brand ?? "",
                r?.model ?? "",
                r?.size ?? "",
                r?.dotCode ?? "",
                num(r?.depthInner32),
                num(r?.depthCentre32),
                num(r?.depthOuter32),
                num(r?.depthMin32),
                num(r?.depthMinMM, decimals: 2),
                r?.pressurePSI.map { String($0) } ?? "",
                status.rawValue,
                r?.hasDepth == true ? (r?.method.rawValue ?? "") : "",
                r?.photoFilename ?? "",
                r?.notes ?? "",
                num(r?.scanConfidence32)
            ]
        }
    }

    static func row(for sample: VerifySample) -> [String] {
        [
            dateFormatter.string(from: sample.date),
            sample.technician,
            sample.label,
            num(sample.scan32, decimals: 2),
            num(sample.scanConfidence32, decimals: 2),
            num(sample.gauge32),
            num(sample.error32, decimals: 2),
            String(sample.frameCount)
        ]
    }

    static func num(_ v: Double?, decimals: Int = 1) -> String {
        guard let v else { return "" }
        return String(format: "%.\(decimals)f", v)
    }
}

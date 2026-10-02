import Foundation

enum CSVExporter {
    /// `policy` is the customer's fleet policy, if any. Without it the status and pull_point
    /// columns carry the shop thresholds, and the CSV disagrees with the yard check built from it.
    static func csv(for inspection: Inspection, policy: FleetPolicy? = nil) -> String {
        let lines = [SpreadsheetRow.header] + SpreadsheetRow.rows(for: inspection, policy: policy)
        return lines.map { $0.map(escape).joined(separator: ",") }.joined(separator: "\r\n") + "\r\n"
    }

    /// Writes to a temp file suitable for the share sheet.
    static func write(_ inspection: Inspection, policy: FleetPolicy? = nil) throws -> URL {
        let unit = inspection.vehicle?.unitNumber.replacingOccurrences(of: "/", with: "-") ?? "unit"
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("tread_\(unit)_\(inspection.shortID).csv")
        try csv(for: inspection, policy: policy).write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    static func escape(_ cell: String) -> String {
        if cell.contains(",") || cell.contains("\"") || cell.contains("\n") || cell.contains("\r") {
            return "\"" + cell.replacingOccurrences(of: "\"", with: "\"\"") + "\""
        }
        return cell
    }
}

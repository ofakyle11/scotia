import Foundation

/// Minimal Google Sheets v4 client: ensure a tab exists with a header row, append rows.
struct SheetsAPI {
    let auth: GoogleAuth

    enum SheetsError: LocalizedError {
        case noSpreadsheet
        case http(Int, String)
        var errorDescription: String? {
            switch self {
            case .noSpreadsheet: return "No spreadsheet ID set. Add it in Settings."
            case .http(let code, let body): return "Sheets API error \(code): \(body.prefix(200))"
            }
        }
        /// 401/403 mean re-auth; 4xx otherwise means the row itself is bad and should not retry forever.
        var isRetryable: Bool {
            if case .http(let code, _) = self { return code == 401 || code == 403 || code == 429 || code >= 500 }
            return true
        }
    }

    private var base: String { "https://sheets.googleapis.com/v4/spreadsheets" }

    /// Creates the tab if missing and writes the header when the tab is empty.
    func ensureSheet(named name: String, header: [String]) async throws {
        guard let id = AppConfig.spreadsheetID else { throw SheetsError.noSpreadsheet }
        let meta = try await request("GET", "\(base)/\(id)?fields=sheets.properties.title")
        let titles = ((meta["sheets"] as? [[String: Any]]) ?? [])
            .compactMap { ($0["properties"] as? [String: Any])?["title"] as? String }
        if !titles.contains(name) {
            _ = try await request("POST", "\(base)/\(id):batchUpdate", body: [
                "requests": [["addSheet": ["properties": ["title": name]]]]
            ])
        }
        let range = "'\(name)'!A1:A1"
        let first = try await request("GET", "\(base)/\(id)/values/\(encode(range))")
        if (first["values"] as? [[Any]])?.isEmpty ?? true {
            _ = try await request("PUT", "\(base)/\(id)/values/\(encode("'\(name)'!A1"))?valueInputOption=RAW", body: [
                "range": "'\(name)'!A1",
                "majorDimension": "ROWS",
                "values": [header]
            ])
        }
    }

    func append(rows: [[String]], to name: String) async throws {
        guard let id = AppConfig.spreadsheetID else { throw SheetsError.noSpreadsheet }
        let range = "'\(name)'!A1"
        _ = try await request("POST", "\(base)/\(id)/values/\(encode(range)):append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS", body: [
            "range": range,
            "majorDimension": "ROWS",
            "values": rows
        ])
    }

    private func encode(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? s
    }

    private func request(_ method: String, _ urlString: String, body: [String: Any]? = nil) async throws -> [String: Any] {
        let token = try await auth.accessToken()
        var req = URLRequest(url: URL(string: urlString)!)
        req.httpMethod = method
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await URLSession.shared.data(for: req)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
            throw SheetsError.http(code, String(data: data, encoding: .utf8) ?? "")
        }
        return (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }
}

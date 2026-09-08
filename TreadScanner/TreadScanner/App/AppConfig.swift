import Foundation

/// Static configuration loaded from Config.plist (copied from Config.example.plist).
/// Values can be overridden at runtime from Settings; those overrides live in UserDefaults.
enum AppConfig {
    private static let plist: [String: Any] = {
        guard let url = Bundle.main.url(forResource: "Config", withExtension: "plist"),
              let data = try? Data(contentsOf: url),
              let dict = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]
        else { return [:] }
        return dict
    }()

    private static func string(_ key: String) -> String? {
        let value = (plist[key] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        return (value?.isEmpty == false) ? value : nil
    }

    static var googleClientID: String? { string("GoogleClientID") }

    /// Spreadsheet ID: Settings override first, then Config.plist.
    static var spreadsheetID: String? {
        let override = UserDefaults.standard.string(forKey: DefaultsKey.spreadsheetID)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if let override, !override.isEmpty { return override }
        return string("SpreadsheetID")
    }

    static var inspectionsSheetName: String { string("InspectionsSheetName") ?? "Inspections" }
    static var verifySheetName: String { string("VerifySheetName") ?? "Verify" }

    /// Reversed client ID used as the OAuth redirect scheme, e.g. com.googleusercontent.apps.1234-abcd
    static var redirectScheme: String? {
        guard let id = googleClientID else { return nil }
        let parts = id.split(separator: ".")
        guard parts.count >= 3, parts.last == "com" else { return nil }
        return parts.reversed().joined(separator: ".")
    }
}

enum DefaultsKey {
    static let spreadsheetID = "spreadsheetID"
    static let technicianName = "technicianName"
    static let showMillimetres = "showMillimetres"
    static let steerMinimum32 = "steerMinimum32"
    static let otherMinimum32 = "otherMinimum32"
    static let watchBand32 = "watchBand32"
}

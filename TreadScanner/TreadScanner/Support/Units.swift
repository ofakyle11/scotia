import Foundation

enum Units {
    static let mmPer32nd = 25.4 / 32.0   // 0.79375 mm

    static func mm(from32nds v: Double) -> Double { v * mmPer32nd }
    static func thirtySeconds(fromMM mm: Double) -> Double { mm / mmPer32nd }

    /// Round to the nearest half 32nd, which is what a dial gauge realistically resolves.
    static func roundedHalf32(_ v: Double) -> Double { (v * 2).rounded() / 2 }

    static func format32(_ v: Double?) -> String {
        guard let v else { return "—" }
        let r = roundedHalf32(v)
        if r == r.rounded() { return "\(Int(r))/32" }
        return String(format: "%.1f/32", r)
    }

    static func formatMM(_ mm: Double?) -> String {
        guard let mm else { return "—" }
        return String(format: "%.1f mm", mm)
    }

    static func formatDepth(_ v32: Double?) -> String {
        guard let v32 else { return "—" }
        if UserDefaults.standard.bool(forKey: DefaultsKey.showMillimetres) {
            return formatMM(mm(from32nds: v32))
        }
        return format32(v32)
    }
}

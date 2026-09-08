import Foundation

enum TireStatus: String, Codable {
    case ok = "OK", watch = "WATCH", replace = "REPLACE", unknown = ""
}

/// Legal minimums in 32nds. Defaults follow Canada NSC / US FMCSA: 4/32 steer, 2/32 all others.
/// `watchBand` adds a "replace soon" band above the minimum.
struct Thresholds: Equatable {
    var steerMinimum32: Int = 4
    var otherMinimum32: Int = 2
    var watchBand32: Int = 2

    static var current: Thresholds {
        let d = UserDefaults.standard
        var t = Thresholds()
        if d.object(forKey: DefaultsKey.steerMinimum32) != nil { t.steerMinimum32 = d.integer(forKey: DefaultsKey.steerMinimum32) }
        if d.object(forKey: DefaultsKey.otherMinimum32) != nil { t.otherMinimum32 = d.integer(forKey: DefaultsKey.otherMinimum32) }
        if d.object(forKey: DefaultsKey.watchBand32) != nil { t.watchBand32 = d.integer(forKey: DefaultsKey.watchBand32) }
        return t
    }

    func save() {
        let d = UserDefaults.standard
        d.set(steerMinimum32, forKey: DefaultsKey.steerMinimum32)
        d.set(otherMinimum32, forKey: DefaultsKey.otherMinimum32)
        d.set(watchBand32, forKey: DefaultsKey.watchBand32)
    }

    func minimum(for role: AxleRole) -> Int {
        role == .steer ? steerMinimum32 : otherMinimum32
    }

    func status(depth32: Double?, role: AxleRole) -> TireStatus {
        guard let depth32 else { return .unknown }
        let min = Double(minimum(for: role))
        if depth32 <= min { return .replace }
        if depth32 <= min + Double(watchBand32) { return .watch }
        return .ok
    }
}

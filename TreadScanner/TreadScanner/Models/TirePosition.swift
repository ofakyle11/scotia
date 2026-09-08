import Foundation

enum Side: String, Codable, CaseIterable { case left = "L", right = "R" }

enum AxleRole: String, Codable, CaseIterable {
    case steer, drive, trailer, tag
    var label: String { rawValue.capitalized }
}

/// One wheel position on the vehicle, TMC-style code (LF, RF, LFO, LFI, LRO, LRI ...).
struct TirePosition: Codable, Hashable, Identifiable {
    var id: String { code }
    var code: String
    var axleIndex: Int        // 1-based from the front
    var side: Side
    var isDual: Bool
    var isInner: Bool         // inner dual: hard to reach, defaults to manual entry
    var role: AxleRole

    var displayName: String {
        var s = side == .left ? "Left" : "Right"
        s += " axle \(axleIndex)"
        if isDual { s += isInner ? " inner" : " outer" }
        return s
    }

    /// Generate positions for an axle. Front axle uses F, rear-most uses R, others use their number.
    static func positions(axleIndex: Int, axleCount: Int, dual: Bool, role: AxleRole) -> [TirePosition] {
        let axleLetter: String
        if axleIndex == 1 { axleLetter = "F" }
        else if axleIndex == axleCount { axleLetter = "R" }
        else { axleLetter = "\(axleIndex)" }

        var out: [TirePosition] = []
        for side in Side.allCases {
            if dual {
                out.append(TirePosition(code: side.rawValue + axleLetter + "O", axleIndex: axleIndex, side: side, isDual: true, isInner: false, role: role))
                out.append(TirePosition(code: side.rawValue + axleLetter + "I", axleIndex: axleIndex, side: side, isDual: true, isInner: true, role: role))
            } else {
                out.append(TirePosition(code: side.rawValue + axleLetter, axleIndex: axleIndex, side: side, isDual: false, isInner: false, role: role))
            }
        }
        return out
    }
}

/// Describes one axle for the Custom preset builder.
struct AxleSpec: Codable, Hashable, Identifiable {
    var id = UUID()
    var dual: Bool
    var role: AxleRole
}

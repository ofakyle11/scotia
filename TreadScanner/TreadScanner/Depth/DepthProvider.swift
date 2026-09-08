import Foundation

enum DepthProviderError: LocalizedError {
    case unavailable
    case cancelled
    case insufficientData(String)

    var errorDescription: String? {
        switch self {
        case .unavailable: return "LiDAR scanning is not available on this device."
        case .cancelled: return "Scan cancelled."
        case .insufficientData(let why): return "Could not measure tread: \(why)"
        }
    }
}

/// Source of a tread depth reading. Scan, gauge and manual all conform so the
/// inspection flow does not care where a number came from.
protocol DepthProvider {
    var method: ReadingMethod { get }
    var isAvailable: Bool { get }
}

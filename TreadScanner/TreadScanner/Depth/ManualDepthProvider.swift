import Foundation

struct ManualDepthProvider: DepthProvider {
    let method: ReadingMethod = .manual
    var isAvailable: Bool { true }

    func result(depth32: Double) -> DepthResult {
        DepthResult(depthMM: Units.mm(from32nds: depth32), uncertaintyMM: 0, frameCount: 0, pointCount: 0, method: .manual)
    }
}

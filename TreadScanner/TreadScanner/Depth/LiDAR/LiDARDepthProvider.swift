import Foundation
import simd

/// Accumulates per-frame estimates while the guidance says the phone is steady and in
/// range, then combines them into one DepthResult. Drive it from ScanView.
@MainActor
final class LiDARDepthProvider: ObservableObject, DepthProvider {
    nonisolated let method: ReadingMethod = .scan
    nonisolated var isAvailable: Bool { LiDARAvailability.isSupported }

    static let targetFrames = 45          // ~2.5 s at 15-20 usable fps

    @Published private(set) var frames: [TreadDepthEstimator.FrameEstimate] = []
    @Published private(set) var liveEstimate: DepthResult?
    @Published private(set) var isComplete = false

    private let estimator = TreadDepthEstimator()

    var progress: Double { min(1, Double(frames.count) / Double(LiDARDepthProvider.targetFrames)) }

    func reset() {
        frames = []
        liveEstimate = nil
        isComplete = false
    }

    /// Feed one frame's ROI point cloud. Ignored once complete or when guidance is not ready.
    func ingest(points: [SIMD3<Double>], guidance: ScanGuidance) {
        guard !isComplete, guidance.isReady else { return }
        guard let est = estimator.estimateFrame(points: points) else { return }
        frames.append(est)
        liveEstimate = estimator.combine(frames)
        if frames.count >= LiDARDepthProvider.targetFrames { isComplete = true }
    }

    func finish() throws -> DepthResult {
        guard let r = estimator.combine(frames) else {
            throw DepthProviderError.insufficientData("no usable frames. Try cleaner tread or better light.")
        }
        return r
    }
}

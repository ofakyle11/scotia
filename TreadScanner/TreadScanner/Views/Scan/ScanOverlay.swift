import SwiftUI

struct ScanOverlay: View {
    let title: String
    let guidance: ScanGuidance
    let progress: Double
    let live: DepthResult?
    let isComplete: Bool
    let error: String?
    var onAccept: () -> Void
    var onRetry: () -> Void
    var onCancel: () -> Void
    /// Present only when the error is one Settings can fix (camera permission).
    var onOpenSettings: (() -> Void)? = nil

    var body: some View {
        ZStack {
            // Reticle: the exact region of interest the extractor measures. ARPreview fills the
            // whole screen, so the reticle is centred on the whole screen too (not on the space
            // left between the top bar and the bottom panel), and it is sized from the same
            // roiFraction LiDARSession uses: on a 6.7" phone that is about 245 × 325 pt, not a
            // 180 pt square. Anything inside this box is measured; nothing outside it is.
            GeometryReader { geo in
                let roi = ScanSettings.roiSizeOnScreen(viewSize: geo.size)
                ZStack {
                    RoundedRectangle(cornerRadius: 16)
                        .stroke(guidance.isReady ? Color.green : Color.white.opacity(0.8), style: StrokeStyle(lineWidth: 3, dash: guidance.isReady ? [] : [10, 8]))
                        .frame(width: roi.width, height: roi.height)
                    RoundedRectangle(cornerRadius: 24)
                        .trim(from: 0, to: progress)
                        .stroke(Color.green, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                        .frame(width: roi.width + 24, height: roi.height + 24)
                        .animation(.linear(duration: 0.1), value: progress)
                    if let live {
                        VStack(spacing: 2) {
                            Text(Units.format32(live.depth32)).font(.system(size: 34, weight: .bold, design: .rounded))
                            Text("± \(String(format: "%.1f", live.uncertainty32))/32").font(.caption)
                        }
                        .foregroundStyle(live.isConfident ? .white : .orange)
                        .shadow(radius: 4)
                    }
                }
                .frame(width: geo.size.width, height: geo.size.height)
            }
            .ignoresSafeArea()

            VStack {
                HStack {
                    Button("Cancel", action: onCancel).padding(10).background(.ultraThinMaterial, in: Capsule())
                    Spacer()
                    Text(title).font(.headline).padding(10).background(.ultraThinMaterial, in: Capsule())
                }
                .padding()

                Spacer()

                bottomPanel
            }
        }
        .foregroundStyle(.white)
    }

    private var bottomPanel: some View {
        VStack(spacing: 12) {
            if let error {
                Text(error).foregroundStyle(.orange).multilineTextAlignment(.center)
                if let onOpenSettings {
                    Button("Open Settings", action: onOpenSettings).buttonStyle(.bordered)
                }
            } else if isComplete, let live {
                Text(live.isConfident ? "Reading complete" : "Noisy reading. Rescan or enter manually.")
                    .foregroundStyle(live.isConfident ? .green : .orange)
            } else {
                Text(guidance.hint.rawValue).font(.title3.bold())
                HStack(spacing: 16) {
                    metric("Distance", guidance.distanceM.map { String(format: "%.0f cm", $0 * 100) } ?? "—",
                           ok: guidance.distanceM.map { $0 >= ScanGuidance.minDistanceM && $0 <= ScanGuidance.maxDistanceM } ?? false)
                    metric("Tilt", guidance.tiltDegrees.map { String(format: "%.0f°", $0) } ?? "—",
                           ok: (guidance.tiltDegrees ?? 99) <= ScanGuidance.maxTiltDegrees)
                    metric("Quality", String(format: "%.0f%%", guidance.highConfidenceFraction * 100),
                           ok: guidance.highConfidenceFraction >= 0.5)
                }
            }
            HStack(spacing: 20) {
                Button(action: onRetry) { Label("Retry", systemImage: "arrow.counterclockwise") }
                    .buttonStyle(.bordered)
                    .disabled(progress == 0 && error == nil)
                Button(action: onAccept) { Label("Accept", systemImage: "checkmark") }
                    .buttonStyle(.borderedProminent)
                    .disabled(live == nil || !isComplete)
            }
            .tint(.green)
        }
        .padding()
        .frame(maxWidth: .infinity)
        .background(.ultraThinMaterial)
    }

    private func metric(_ label: String, _ value: String, ok: Bool) -> some View {
        VStack {
            Text(value).font(.headline.monospacedDigit()).foregroundStyle(ok ? .green : .white)
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
    }
}

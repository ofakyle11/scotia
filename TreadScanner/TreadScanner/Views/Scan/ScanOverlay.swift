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

    var body: some View {
        VStack {
            HStack {
                Button("Cancel", action: onCancel).padding(10).background(.ultraThinMaterial, in: Capsule())
                Spacer()
                Text(title).font(.headline).padding(10).background(.ultraThinMaterial, in: Capsule())
            }
            .padding()

            Spacer()

            // Reticle: the region of interest used for the point cloud.
            ZStack {
                RoundedRectangle(cornerRadius: 16)
                    .stroke(guidance.isReady ? Color.green : Color.white.opacity(0.8), style: StrokeStyle(lineWidth: 3, dash: guidance.isReady ? [] : [10, 8]))
                    .frame(width: 180, height: 180)
                Circle()
                    .trim(from: 0, to: progress)
                    .stroke(Color.green, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .frame(width: 210, height: 210)
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

            Spacer()

            VStack(spacing: 12) {
                if let error {
                    Text(error).foregroundStyle(.orange).multilineTextAlignment(.center)
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
        .foregroundStyle(.white)
    }

    private func metric(_ label: String, _ value: String, ok: Bool) -> some View {
        VStack {
            Text(value).font(.headline.monospacedDigit()).foregroundStyle(ok ? .green : .white)
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
    }
}

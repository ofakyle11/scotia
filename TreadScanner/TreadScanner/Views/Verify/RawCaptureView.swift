import SwiftUI
#if canImport(ARKit)
import ARKit
#endif

/// Records raw LiDAR frames of a real tire to a .treadcap file, with the gauge reading typed in,
/// then shares the file. Analyse on a computer with tools/treadlab. This is how the estimator
/// gets tuned against real tread instead of synthetic data.
struct RawCaptureView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var label = ""
    @State private var gauge = ""
    @State private var showCamera = false
    @State private var shareURL: URL?
    @State private var captures = LiDARAvailability.isSupported ? FrameRecorder.listCaptures() : []

    var body: some View {
        NavigationStack {
            Form {
                Section("New capture") {
                    TextField("Label (e.g. Unit 42 LF centre)", text: $label)
                    HStack { Text("Gauge reading"); TextField("32nds", text: $gauge).keyboardType(.decimalPad).multilineTextAlignment(.trailing) }
                    Button("Record 60 frames") { showCamera = true }
                        .disabled(!LiDARAvailability.isSupported || Double(gauge) == nil)
                    if !LiDARAvailability.isSupported {
                        Text("Needs an iPhone with LiDAR.").font(.footnote).foregroundStyle(.secondary)
                    }
                }
                Section {
                    if captures.isEmpty { Text("No captures yet.").foregroundStyle(.secondary) }
                    ForEach(captures, id: \.self) { url in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(url.deletingPathExtension().lastPathComponent).font(.footnote.monospaced())
                                Text(sizeString(url)).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button { shareURL = url } label: { Image(systemName: "square.and.arrow.up") }
                        }
                    }
                    .onDelete { idx in
                        for i in idx { try? FileManager.default.removeItem(at: captures[i]) }
                        captures = FrameRecorder.listCaptures()
                    }
                } header: { Text("Captures on this phone (\(captures.count))") } footer: {
                    Text("Every frame is recorded, in range or not, so the analysis can work out which distance reads best. Sweep slowly from about 10 cm out to 30 cm while it records. Share to a computer and run: python3 tools/treadlab/treadlab.py pose <file>. Each file is roughly 15 MB.")
                }
            }
            .navigationTitle("Raw LiDAR capture")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .sheet(item: $shareURL) { url in ShareSheet(items: [url]) }
            .fullScreenCover(isPresented: $showCamera, onDismiss: { captures = FrameRecorder.listCaptures() }) {
                RecordingScanView(label: label, gauge32: Double(gauge))
            }
        }
    }

    private func sizeString(_ url: URL) -> String {
        let bytes = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? 0
        return ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }
}

/// Same guidance overlay as a normal scan, but every frame that passes the gate is written
/// to the recorder as well as the estimator.
struct RecordingScanView: View {
    let label: String
    let gauge32: Double?
    @Environment(\.dismiss) private var dismiss
    @StateObject private var lidar = LiDARSession()
    @StateObject private var provider = LiDARDepthProvider()
    @State private var recorder = FrameRecorder()
    @State private var error: String?
    @State private var done = false

    var body: some View {
        ZStack {
            #if canImport(ARKit)
            ARPreview(session: lidar.session).ignoresSafeArea()
            #endif
            ScanOverlay(title: "Recording \(recorder.frameCount)/\(recorder.maxFrames) · \(label)", guidance: lidar.guidance, progress: Double(recorder.frameCount) / Double(recorder.maxFrames),
                        live: provider.liveEstimate, isComplete: done, error: error,
                        onAccept: { recorder.stop(); dismiss() },
                        onRetry: { restart() },
                        onCancel: { recorder.stop(); if let u = recorder.url { try? FileManager.default.removeItem(at: u) }; dismiss() })
        }
        .onAppear { lidar.start(); restart() }
        .onDisappear { lidar.stop(); recorder.stop() }
        .onReceive(lidar.$latestPoints) { points in
            provider.ingest(points: points, guidance: lidar.guidance)
            #if canImport(ARKit)
            // Record every frame that carries depth, in the gate or not. The gate's limits are
            // unproven, and a diagnostic that only runs when they pass could never disprove them.
            // Each frame stores its own distance, tilt and motion so the analysis sorts it out.
            if !done, let frame = lidar.session.currentFrame, let depth = frame.smoothedSceneDepth ?? frame.sceneDepth {
                if !recorder.append(frame: frame, depth: depth, guidance: lidar.guidance) { done = true; recorder.stop() }
            }
            #endif
        }
    }

    private func restart() {
        recorder.stop()
        if let u = recorder.url { try? FileManager.default.removeItem(at: u) }
        provider.reset(); done = false; error = nil
        do { try recorder.start(label: label, gauge32: gauge32) } catch { self.error = error.localizedDescription }
    }
}

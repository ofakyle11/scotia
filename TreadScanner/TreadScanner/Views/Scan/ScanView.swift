import SwiftUI
import UIKit
import CoreImage
#if canImport(ARKit)
import ARKit
import RealityKit
#endif

/// Full-screen LiDAR scan. Shows the camera, a reticle, distance/tilt guidance and a
/// progress ring. Accumulates frames only while guidance is green, then offers Accept/Retry.
struct ScanView: View {
    let title: String
    /// Called with the result and a snapshot of the camera image (for the photo record).
    var onAccept: (DepthResult, UIImage?) -> Void

    @Environment(\.dismiss) private var dismiss
    @StateObject private var lidar = LiDARSession()
    @StateObject private var provider = LiDARDepthProvider()
    @State private var error: String?

    var body: some View {
        ZStack {
            #if canImport(ARKit)
            ARPreview(session: lidar.session).ignoresSafeArea()
            #else
            Color.black.ignoresSafeArea()
            #endif
            ScanOverlay(
                title: title,
                guidance: lidar.guidance,
                progress: provider.progress,
                live: provider.liveEstimate,
                isComplete: provider.isComplete,
                error: error,
                onAccept: accept,
                onRetry: { provider.reset(); error = nil },
                onCancel: { dismiss() }
            )
        }
        .onAppear {
            guard LiDARAvailability.isSupported else {
                error = DepthProviderError.unavailable.localizedDescription
                return
            }
            lidar.start()
        }
        .onDisappear { lidar.stop() }
        .onReceive(lidar.$latestPoints) { points in
            provider.ingest(points: points, guidance: lidar.guidance)
        }
    }

    private func accept() {
        do {
            let result = try provider.finish()
            var image: UIImage?
            #if canImport(ARKit)
            if let buffer = lidar.latestImage {
                let ci = CIImage(cvPixelBuffer: buffer).oriented(.right)
                if let cg = CIContext().createCGImage(ci, from: ci.extent) {
                    image = UIImage(cgImage: cg)
                }
            }
            #endif
            onAccept(result, image)
            provider.reset()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

#if canImport(ARKit)
/// Plain camera feed for the AR session; no virtual content needed.
struct ARPreview: UIViewRepresentable {
    let session: ARSession
    func makeUIView(context: Context) -> ARView {
        let view = ARView(frame: .zero, cameraMode: .ar, automaticallyConfigureSession: false)
        view.session = session
        view.renderOptions = [.disableMotionBlur, .disableDepthOfField, .disableHDR, .disableCameraGrain]
        return view
    }
    func updateUIView(_ uiView: ARView, context: Context) {}
}
#endif

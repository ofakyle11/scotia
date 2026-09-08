import Foundation
import simd
#if canImport(ARKit)
import ARKit
import Combine

/// Wraps ARSession with sceneDepth and turns each frame into a camera-space point cloud
/// restricted to the centre scan region. Runs on the main actor for SwiftUI friendliness;
/// the per-frame maths is cheap (about 6k points).
@MainActor
final class LiDARSession: NSObject, ObservableObject, ARSessionDelegate {
    let session = ARSession()
    @Published var guidance = ScanGuidance()
    @Published var latestPoints: [SIMD3<Double>] = []
    @Published var latestImage: CVPixelBuffer?

    /// Fraction of the depth map width/height used as the region of interest, centred.
    nonisolated let roiFraction = 0.35
    /// Box-filter radius (pixels) applied to the depth map before unprojection. At 20 cm one
    /// depth pixel is about 1 mm and a groove 8-12 px wide, so 3x3 (radius 1) is the sweet spot:
    /// 5x5 blurs groove edges and reads shallow. Confirmed by tools/treadlab sweep on synthetic
    /// tires; re-check against real captures.
    nonisolated let smoothingRadius = 1
    private var lastCameraPosition: SIMD3<Float>?
    private var lastTimestamp: TimeInterval?

    func start() {
        guard LiDARAvailability.isSupported else { return }
        let config = ARWorldTrackingConfiguration()
        // smoothedSceneDepth is Apple's temporally filtered depth; per-point noise is noticeably
        // lower than raw sceneDepth for a still camera, which is exactly our scan pose.
        config.frameSemantics = ARWorldTrackingConfiguration.supportsFrameSemantics(.smoothedSceneDepth) ? [.smoothedSceneDepth] : [.sceneDepth]
        config.environmentTexturing = .none
        session.delegate = self
        session.run(config, options: [.resetTracking, .removeExistingAnchors])
    }

    func stop() {
        session.pause()
    }

    nonisolated func session(_ session: ARSession, didUpdate frame: ARFrame) {
        guard let depth = frame.smoothedSceneDepth ?? frame.sceneDepth else { return }
        let extracted = LiDARSession.extract(frame: frame, depth: depth, roiFraction: roiFraction, radius: smoothingRadius)
        Task { @MainActor in
            self.apply(extracted, frame: frame)
        }
    }

    private struct Extracted {
        var points: [SIMD3<Double>]
        var medianDistance: Double?
        var tiltDegrees: Double?
        var highConfidenceFraction: Double
    }

    private func apply(_ e: Extracted, frame: ARFrame) {
        latestPoints = e.points
        latestImage = frame.capturedImage

        // Motion estimate from camera translation between frames.
        let pos = SIMD3<Float>(frame.camera.transform.columns.3.x, frame.camera.transform.columns.3.y, frame.camera.transform.columns.3.z)
        var motion = 0.0
        if let last = lastCameraPosition, let lastT = lastTimestamp, frame.timestamp > lastT {
            motion = Double(simd_length(pos - last)) / (frame.timestamp - lastT)
        }
        lastCameraPosition = pos
        lastTimestamp = frame.timestamp

        guidance = ScanGuidance(
            distanceM: e.medianDistance,
            tiltDegrees: e.tiltDegrees,
            motionMPerS: motion,
            highConfidenceFraction: e.highConfidenceFraction
        )
    }

    /// Unproject the ROI of the depth map into camera-space points (metres).
    nonisolated private static func extract(frame: ARFrame, depth: ARDepthData, roiFraction: Double, radius: Int) -> Extracted {
        let depthMap = depth.depthMap
        guard let confMap = depth.confidenceMap else {
            return Extracted(points: [], medianDistance: nil, tiltDegrees: nil, highConfidenceFraction: 0)
        }
        CVPixelBufferLockBaseAddress(depthMap, .readOnly)
        CVPixelBufferLockBaseAddress(confMap, .readOnly)
        defer {
            CVPixelBufferUnlockBaseAddress(depthMap, .readOnly)
            CVPixelBufferUnlockBaseAddress(confMap, .readOnly)
        }

        let w = CVPixelBufferGetWidth(depthMap)
        let h = CVPixelBufferGetHeight(depthMap)
        guard let dBase = CVPixelBufferGetBaseAddress(depthMap),
              let cBase = CVPixelBufferGetBaseAddress(confMap) else {
            return Extracted(points: [], medianDistance: nil, tiltDegrees: nil, highConfidenceFraction: 0)
        }
        let dStride = CVPixelBufferGetBytesPerRow(depthMap) / MemoryLayout<Float32>.size
        let cStride = CVPixelBufferGetBytesPerRow(confMap)
        let dPtr = dBase.assumingMemoryBound(to: Float32.self)
        let cPtr = cBase.assumingMemoryBound(to: UInt8.self)

        // Intrinsics are for the full-res camera image; scale to depth-map resolution.
        let intr = frame.camera.intrinsics
        let imgW = Double(frame.camera.imageResolution.width)
        let imgH = Double(frame.camera.imageResolution.height)
        let sx = Double(w) / imgW, sy = Double(h) / imgH
        let fx = Double(intr[0][0]) * sx, fy = Double(intr[1][1]) * sy
        let cx = Double(intr[2][0]) * sx, cy = Double(intr[2][1]) * sy

        let rx0 = Int(Double(w) * (0.5 - roiFraction / 2)), rx1 = Int(Double(w) * (0.5 + roiFraction / 2))
        let ry0 = Int(Double(h) * (0.5 - roiFraction / 2)), ry1 = Int(Double(h) * (0.5 + roiFraction / 2))

        var points: [SIMD3<Double>] = []
        points.reserveCapacity((rx1 - rx0) * (ry1 - ry0))
        var depths: [Double] = []
        var total = 0, high = 0
        for y in ry0..<ry1 {
            for x in rx0..<rx1 {
                total += 1
                guard Int(cPtr[y * cStride + x]) == ARConfidenceLevel.high.rawValue else { continue }
                high += 1
                // Smooth: mean of high-confidence neighbours in a (2r+1)^2 box.
                var sum = 0.0, n = 0
                for dy in -radius...radius {
                    let yy = y + dy
                    guard yy >= 0, yy < h else { continue }
                    for dx in -radius...radius {
                        let xx = x + dx
                        guard xx >= 0, xx < w, Int(cPtr[yy * cStride + xx]) == ARConfidenceLevel.high.rawValue else { continue }
                        let v = Double(dPtr[yy * dStride + xx])
                        if v > 0.05, v < 0.6 { sum += v; n += 1 }
                    }
                }
                guard n >= 3 else { continue }
                let z = sum / Double(n)
                // ARKit camera space: +x right, +y up, -z forward. Image y grows downward.
                let px = (Double(x) - cx) / fx * z
                let py = -(Double(y) - cy) / fy * z
                points.append(SIMD3<Double>(px, py, -z))
                depths.append(z)
            }
        }

        var medianDistance: Double?
        var tilt: Double?
        if !depths.isEmpty {
            depths.sort()
            medianDistance = depths[depths.count / 2]
        }
        if points.count >= 60, let plane = TreadDepthEstimator().fitPlane(points) {
            // Tilt = angle between surface normal and the camera's optical axis.
            let cosTheta = min(1, max(-1, abs(plane.normal.z)))
            tilt = acos(cosTheta) * 180 / .pi
        }
        return Extracted(
            points: points,
            medianDistance: medianDistance,
            tiltDegrees: tilt,
            highConfidenceFraction: total > 0 ? Double(high) / Double(total) : 0
        )
    }
}
#endif

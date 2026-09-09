import Foundation
#if canImport(ARKit)
import ARKit
import CoreImage
import UIKit

/// Records raw LiDAR frames to a single `.treadcap` file for offline analysis with
/// `tools/treadlab`. Idea borrowed from LiDAR-Depth-Map-Capture-for-iOS: keep the full
/// 32-bit depth and the confidence map, never a lossy image of them.
///
/// File layout (little-endian):
///   magic "TREADCAP" (8 bytes), header length UInt32, header JSON (UTF-8),
///   then per frame: UInt32 length + frame JSON, Float32 depth[w*h], UInt8 confidence[w*h], UInt32 jpegLen + JPEG.
final class FrameRecorder {
    private var handle: FileHandle?
    private(set) var url: URL?
    private(set) var frameCount = 0
    private let ciContext = CIContext()
    var maxFrames = 60

    var isRecording: Bool { handle != nil }

    func start(label: String, gauge32: Double?) throws {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Captures", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let safe = label.replacingOccurrences(of: "[^A-Za-z0-9_-]", with: "_", options: .regularExpression)
        let f = DateFormatter(); f.dateFormat = "yyyyMMdd-HHmmss"
        let url = dir.appendingPathComponent("\(f.string(from: Date()))_\(safe.isEmpty ? "capture" : safe).treadcap")
        FileManager.default.createFile(atPath: url.path, contents: nil)
        let h = try FileHandle(forWritingTo: url)
        let header: [String: Any] = [
            "version": 1, "label": label, "gauge32": gauge32 as Any,
            // UIDevice.current.model is just "iPhone" on every handset, which cannot tell a
            // 15 Pro Max from a 16 Pro Max. The hardware identifier can, and different
            // sensor generations may well read differently.
            "device": FrameRecorder.deviceName, "deviceID": FrameRecorder.deviceIdentifier,
            "system": UIDevice.current.systemVersion, "created": ISO8601DateFormatter().string(from: Date())
        ]
        let headerData = try JSONSerialization.data(withJSONObject: header)
        h.write(Data("TREADCAP".utf8))
        h.write(FrameRecorder.le32(UInt32(headerData.count)))
        h.write(headerData)
        handle = h
        self.url = url
        frameCount = 0
    }

    /// Append one frame. Returns false once `maxFrames` is reached.
    @discardableResult
    func append(frame: ARFrame, depth: ARDepthData, guidance: ScanGuidance? = nil) -> Bool {
        guard let h = handle, frameCount < maxFrames, let conf = depth.confidenceMap else { return false }
        let dm = depth.depthMap
        CVPixelBufferLockBaseAddress(dm, .readOnly); CVPixelBufferLockBaseAddress(conf, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(dm, .readOnly); CVPixelBufferUnlockBaseAddress(conf, .readOnly) }
        let w = CVPixelBufferGetWidth(dm), hgt = CVPixelBufferGetHeight(dm)
        guard let dBase = CVPixelBufferGetBaseAddress(dm), let cBase = CVPixelBufferGetBaseAddress(conf) else { return false }

        // Depth rows may be padded; copy row by row into a tight buffer.
        var depthData = Data(count: w * hgt * 4)
        var confData = Data(count: w * hgt)
        let dStride = CVPixelBufferGetBytesPerRow(dm), cStride = CVPixelBufferGetBytesPerRow(conf)
        depthData.withUnsafeMutableBytes { dst in
            for y in 0..<hgt { memcpy(dst.baseAddress! + y * w * 4, dBase + y * dStride, w * 4) }
        }
        confData.withUnsafeMutableBytes { dst in
            for y in 0..<hgt { memcpy(dst.baseAddress! + y * w, cBase + y * cStride, w) }
        }

        let intr = frame.camera.intrinsics
        let t = frame.camera.transform
        let meta: [String: Any] = [
            "index": frameCount, "timestamp": frame.timestamp,
            "width": w, "height": hgt,
            "imageWidth": frame.camera.imageResolution.width, "imageHeight": frame.camera.imageResolution.height,
            "intrinsics": [intr[0][0], intr[1][1], intr[2][0], intr[2][1]].map(Double.init),   // fx fy cx cy
            "transform": (0..<4).flatMap { c in (0..<4).map { r in Double(t[c][r]) } },          // column-major
            "smoothed": frame.smoothedSceneDepth != nil,
            // Pose at capture time. Recorded for every frame, in range or not, so the
            // analysis can work out which distances and angles actually read well
            // instead of assuming the on-screen limits were right.
            "distanceM": guidance?.distanceM as Any,
            "tiltDegrees": guidance?.tiltDegrees as Any,
            "motionMPerS": guidance?.motionMPerS as Any,
            "highConfidenceFraction": guidance?.highConfidenceFraction as Any,
            "inGate": guidance?.isReady as Any
        ]
        let metaData = (try? JSONSerialization.data(withJSONObject: meta)) ?? Data()

        // Small JPEG of the RGB frame for context (not used for measurement).
        var jpeg = Data()
        let ci = CIImage(cvPixelBuffer: frame.capturedImage)
        let scale = 640.0 / ci.extent.width
        if let cg = ciContext.createCGImage(ci.transformed(by: CGAffineTransform(scaleX: scale, y: scale)), from: CGRect(x: 0, y: 0, width: ci.extent.width * scale, height: ci.extent.height * scale)) {
            jpeg = UIImage(cgImage: cg).jpegData(compressionQuality: 0.6) ?? Data()
        }

        h.write(FrameRecorder.le32(UInt32(metaData.count))); h.write(metaData)
        h.write(depthData); h.write(confData)
        h.write(FrameRecorder.le32(UInt32(jpeg.count))); h.write(jpeg)
        frameCount += 1
        return frameCount < maxFrames
    }

    func stop() {
        try? handle?.close()
        handle = nil
    }

    static func listCaptures() -> [URL] {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Captures", isDirectory: true)
        let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.creationDateKey])) ?? []
        return files.filter { $0.pathExtension == "treadcap" }.sorted { $0.lastPathComponent > $1.lastPathComponent }
    }

    private static func le32(_ v: UInt32) -> Data { withUnsafeBytes(of: v.littleEndian) { Data($0) } }

    /// Hardware identifier such as "iPhone17,2". Simulators report their host's value
    /// through the SIMULATOR_MODEL_IDENTIFIER environment variable.
    static var deviceIdentifier: String {
        if let sim = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] { return sim }
        var info = utsname()
        uname(&info)
        return withUnsafePointer(to: &info.machine) { ptr in
            ptr.withMemoryRebound(to: CChar.self, capacity: MemoryLayout.size(ofValue: info.machine)) {
                String(validatingUTF8: $0) ?? "unknown"
            }
        }
    }

    /// Marketing name for the LiDAR-capable handsets, so a capture says which phone took it.
    /// Anything unlisted falls back to the raw identifier rather than guessing.
    static var deviceName: String {
        let names = [
            "iPhone13,3": "iPhone 12 Pro",    "iPhone13,4": "iPhone 12 Pro Max",
            "iPhone14,2": "iPhone 13 Pro",    "iPhone14,3": "iPhone 13 Pro Max",
            "iPhone15,2": "iPhone 14 Pro",    "iPhone15,3": "iPhone 14 Pro Max",
            "iPhone16,1": "iPhone 15 Pro",    "iPhone16,2": "iPhone 15 Pro Max",
            "iPhone17,1": "iPhone 16 Pro",    "iPhone17,2": "iPhone 16 Pro Max",
            "iPhone18,1": "iPhone 17 Pro",    "iPhone18,2": "iPhone 17 Pro Max",
        ]
        let id = deviceIdentifier
        return names[id] ?? id
    }
}
#endif

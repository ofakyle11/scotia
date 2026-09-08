import Foundation
#if canImport(ARKit)
import ARKit
#endif

enum LiDARAvailability {
    /// True on iPhone 12 Pro and newer Pro models (and iPad Pro with LiDAR).
    static var isSupported: Bool {
        #if canImport(ARKit) && !targetEnvironment(simulator)
        return ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)
        #else
        return false
        #endif
    }
}

import Foundation
import UIKit

enum PhotoStore {
    static var directory: URL {
        let base = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("Photos", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    /// Saves a JPEG and returns the filename stored on the reading.
    static func save(_ image: UIImage, inspectionID: UUID, positionCode: String) -> String? {
        guard let data = image.jpegData(compressionQuality: 0.8) else { return nil }
        let name = "\(inspectionID.uuidString.prefix(8))_\(positionCode)_\(Int(Date().timeIntervalSince1970)).jpg"
        do {
            try data.write(to: directory.appendingPathComponent(name), options: .atomic)
            return name
        } catch {
            return nil
        }
    }

    static func load(_ filename: String?) -> UIImage? {
        guard let filename else { return nil }
        return UIImage(contentsOfFile: directory.appendingPathComponent(filename).path)
    }
}

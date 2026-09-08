import Foundation
import SwiftData

@Model
final class Customer {
    @Attribute(.unique) var id: UUID
    var name: String
    var contact: String
    var createdAt: Date
    @Relationship(deleteRule: .cascade, inverse: \Vehicle.customer) var vehicles: [Vehicle] = []

    init(name: String, contact: String = "") {
        self.id = UUID()
        self.name = name
        self.contact = contact
        self.createdAt = Date()
    }
}

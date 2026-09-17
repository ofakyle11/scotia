import Foundation
import SwiftData

@Model
final class Vehicle {
    @Attribute(.unique) var id: UUID
    var unitNumber: String
    var plate: String
    var vin: String
    /// "Tractor - Class 8", "Trailer - Van (Dry-Van)", "Pick-up"… shown on the yard check.
    var vehicleType: String = ""
    var customer: Customer?
    @Relationship(deleteRule: .cascade, inverse: \Inspection.vehicle) var inspections: [Inspection] = []

    init(unitNumber: String, plate: String = "", vin: String = "", customer: Customer? = nil) {
        self.id = UUID()
        self.unitNumber = unitNumber
        self.plate = plate
        self.vin = vin
        self.customer = customer
    }
}

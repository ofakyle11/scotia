import Foundation
import SwiftData

/// Per-customer fleet policy: the pull point (replace-at depth) and pressure targets for
/// each axle role. Drives status on that customer's trucks and the Maintenance Policies
/// section of the yard check. Customers without one use the shop thresholds.
@Model
final class FleetPolicy {
    @Attribute(.unique) var id: UUID
    var customerName: String
    var steerPull32: Int
    var drivePull32: Int
    var trailerPull32: Int
    var tagPull32: Int
    var steerRecPSI: Int?;   var steerMinPSI: Int?;   var steerRetreads: Bool
    var driveRecPSI: Int?;   var driveMinPSI: Int?;   var driveRetreads: Bool
    var trailerRecPSI: Int?; var trailerMinPSI: Int?; var trailerRetreads: Bool
    var tagRecPSI: Int?;     var tagMinPSI: Int?;     var tagRetreads: Bool

    init(customerName: String, thresholds: Thresholds = .current) {
        self.id = UUID()
        self.customerName = customerName
        steerPull32 = thresholds.steerMinimum32; drivePull32 = thresholds.otherMinimum32
        trailerPull32 = thresholds.otherMinimum32; tagPull32 = thresholds.otherMinimum32
        steerRetreads = false; driveRetreads = true; trailerRetreads = true; tagRetreads = true
    }

    struct Role { var pull: Int; var recPSI: Int?; var minPSI: Int?; var retreads: Bool }

    func role(_ r: AxleRole) -> Role {
        switch r {
        case .steer:   return Role(pull: steerPull32, recPSI: steerRecPSI, minPSI: steerMinPSI, retreads: steerRetreads)
        case .drive:   return Role(pull: drivePull32, recPSI: driveRecPSI, minPSI: driveMinPSI, retreads: driveRetreads)
        case .trailer: return Role(pull: trailerPull32, recPSI: trailerRecPSI, minPSI: trailerMinPSI, retreads: trailerRetreads)
        case .tag:     return Role(pull: tagPull32, recPSI: tagRecPSI, minPSI: tagMinPSI, retreads: tagRetreads)
        }
    }

    func set(_ r: AxleRole, _ v: Role) {
        switch r {
        case .steer:   steerPull32 = v.pull; steerRecPSI = v.recPSI; steerMinPSI = v.minPSI; steerRetreads = v.retreads
        case .drive:   drivePull32 = v.pull; driveRecPSI = v.recPSI; driveMinPSI = v.minPSI; driveRetreads = v.retreads
        case .trailer: trailerPull32 = v.pull; trailerRecPSI = v.recPSI; trailerMinPSI = v.minPSI; trailerRetreads = v.retreads
        case .tag:     tagPull32 = v.pull; tagRecPSI = v.recPSI; tagMinPSI = v.minPSI; tagRetreads = v.retreads
        }
    }

    /// Fleet policy for a customer name, or nil when they use shop thresholds.
    static func find(_ customerName: String?, in context: ModelContext) -> FleetPolicy? {
        guard let name = customerName, !name.isEmpty else { return nil }
        var d = FetchDescriptor<FleetPolicy>(predicate: #Predicate { $0.customerName == name })
        d.fetchLimit = 1
        return try? context.fetch(d).first
    }
}

/// Pull point for a role: the customer's policy if one exists, else the shop thresholds.
enum PullPoint {
    static func forRole(_ role: AxleRole, customer: String?, context: ModelContext?, thresholds: Thresholds = .current) -> Int {
        if let context, let p = FleetPolicy.find(customer, in: context) { return p.role(role).pull }
        return thresholds.minimum(for: role)
    }
}

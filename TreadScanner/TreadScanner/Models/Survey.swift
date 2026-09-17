import Foundation
import SwiftData

/// A yard check: every vehicle inspected in one visit to a customer's yard. Feeds the
/// fleet-wide report (cover, management summary, per-vehicle pages).
@Model
final class Survey {
    @Attribute(.unique) var id: UUID
    /// Short human id shown on the report cover, e.g. "165881".
    var surveyNumber: String
    var fleet: String
    var location: String
    var account: String
    var reportedBy: String
    var participants: String        // comma separated
    var date: Date
    var createdAt: Date
    @Relationship(deleteRule: .nullify, inverse: \Inspection.survey) var inspections: [Inspection] = []

    init(fleet: String, location: String, account: String = "", reportedBy: String, participants: String = "") {
        self.id = UUID()
        self.surveyNumber = String(Int.random(in: 100_000...999_999))
        self.fleet = fleet
        self.location = location
        self.account = account
        self.reportedBy = reportedBy
        self.participants = participants
        self.date = Date()
        self.createdAt = Date()
    }
}

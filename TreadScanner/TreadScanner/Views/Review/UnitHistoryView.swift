import SwiftUI
import SwiftData

/// Tread history for one unit across every inspection on record. Mirrors the web app's history page.
struct UnitHistoryView: View {
    let unitNumber: String
    var vehicleID: UUID?

    @Query(sort: \Inspection.date, order: .forward) private var allInspections: [Inspection]

    private var thresholds: Thresholds { .current }

    /// Inspections for this vehicle, or failing that any inspection on the same unit number, oldest first.
    private var inspections: [Inspection] {
        allInspections.filter { ins in
            if let vehicleID, ins.vehicle?.id == vehicleID { return true }
            guard !unitNumber.isEmpty else { return false }
            return ins.vehicle?.unitNumber == unitNumber
        }
    }

    /// Every position code seen on this unit, in the order it first appeared.
    private var codes: [String] {
        var seen = Set<String>()
        var out: [String] = []
        for ins in inspections {
            for pos in ins.positions where !seen.contains(pos.code) {
                seen.insert(pos.code)
                out.append(pos.code)
            }
        }
        return out
    }

    private func role(_ code: String) -> AxleRole {
        for ins in inspections.reversed() {
            if let pos = ins.positions.first(where: { $0.code == code }) { return pos.role }
        }
        return .drive
    }

    private func depth(_ code: String, in inspection: Inspection) -> Double? {
        inspection.readings.first { $0.positionCode == code }?.depthMin32
    }

    private func samples(_ code: String) -> [WearSample] {
        inspections.compactMap { ins in
            guard let odo = ins.odometer, let d = depth(code, in: ins) else { return nil }
            return WearSample(odometer: odo, depth32: d)
        }
    }

    private func rate(_ code: String) -> Double? { WearRate.per10kKM(samples(code)) }

    private func currentDepth(_ code: String) -> Double? {
        for ins in inspections.reversed() {
            if let d = depth(code, in: ins) { return d }
        }
        return nil
    }

    struct Projection: Identifiable {
        var id: String { code }
        var code: String
        var km: Double
    }

    private var projections: [Projection] {
        var out: [Projection] = []
        for code in codes {
            guard let r = rate(code), let current = currentDepth(code) else { continue }
            guard let km = WearRate.projectedKM(currentDepth32: current,
                                                minimum32: thresholds.minimum(for: role(code)),
                                                ratePer10kKM: r) else { continue }
            out.append(Projection(code: code, km: km))
        }
        return out.sorted { $0.km < $1.km }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if inspections.isEmpty {
                    ContentUnavailableView("No inspections for this unit", systemImage: "clock.arrow.circlepath")
                } else {
                    summary
                    grid
                    Text("Wear rate needs an odometer on at least two inspections. Projected life = (current depth − minimum) ÷ rate.")
                        .font(.caption).foregroundStyle(.secondary).padding(.horizontal)
                    if !projections.isEmpty { projectionList }
                }
            }
            .padding(.vertical)
        }
        .navigationTitle("Unit \(unitNumber) history")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var summary: some View {
        let odos = inspections.compactMap(\.odometer)
        let span = (odos.count > 1 && odos.last! > odos.first!) ? " · \((odos.last! - odos.first!).formatted()) km" : ""
        let first = inspections.first?.date
        let last = inspections.last?.date
        let range: String = {
            guard let first, let last else { return "" }
            return "\(Self.dayFormatter.string(from: first)) → \(Self.dayFormatter.string(from: last))"
        }()
        return VStack(alignment: .leading, spacing: 4) {
            Text("\(inspections.count) inspection\(inspections.count == 1 ? "" : "s")").font(.headline)
            Text(range + span).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal)
    }

    private var grid: some View {
        ScrollView(.horizontal, showsIndicators: true) {
            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 6) {
                GridRow {
                    Text("Pos").font(.caption.bold())
                    ForEach(inspections) { ins in
                        VStack(alignment: .leading, spacing: 1) {
                            Text(Self.shortDayFormatter.string(from: ins.date)).font(.caption.bold())
                            Text(ins.odometer.map { "\($0 / 1000)k" } ?? "—")
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    Text("Wear /10k km").font(.caption.bold())
                }
                Divider()
                ForEach(codes, id: \.self) { code in
                    GridRow {
                        Text(code).font(.caption.bold()).frame(width: 44, alignment: .leading)
                        ForEach(inspections) { ins in
                            cell(depth(code, in: ins), role: role(code))
                        }
                        Text(rate(code).map { String(format: "%.1f/32", $0) } ?? "—")
                            .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                    }
                }
            }
            .padding(.horizontal)
        }
    }

    private func cell(_ depth32: Double?, role: AxleRole) -> some View {
        let status = thresholds.status(depth32: depth32, role: role)
        return Text(Units.format32(depth32))
            .font(.caption.monospacedDigit())
            .padding(.horizontal, 6).padding(.vertical, 3)
            .background(Capsule().fill(VehicleDiagramView.color(for: status).opacity(0.18)))
            .foregroundStyle(status == .unknown ? Color.secondary : VehicleDiagramView.color(for: status))
    }

    private var projectionList: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Projected km to minimum").font(.headline)
            ForEach(projections) { p in
                HStack {
                    Text(p.code).bold().frame(width: 50, alignment: .leading)
                    Text("\(Int((p.km / 1000).rounded()).formatted())k km").monospacedDigit()
                    Spacer()
                }
                .font(.callout)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal)
    }

    static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .none
        return f
    }()

    static let shortDayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.setLocalizedDateFormatFromTemplate("MMM d")
        return f
    }()
}

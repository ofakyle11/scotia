import SwiftUI

/// Top-down truck diagram. Each tire is a tappable rounded rectangle coloured by status.
struct VehicleDiagramView: View {
    let inspection: Inspection
    var highlighted: TirePosition?
    var onTap: (TirePosition) -> Void

    private var thresholds: Thresholds { .current }

    private var axles: [Int] {
        Array(Set(inspection.positions.map(\.axleIndex))).sorted()
    }

    var body: some View {
        VStack(spacing: 18) {
            ForEach(axles, id: \.self) { axle in
                let tires = inspection.positions.filter { $0.axleIndex == axle }
                HStack(spacing: 0) {
                    side(tires.filter { $0.side == .left }.sorted { !$0.isInner && $1.isInner })   // outer, inner
                    Rectangle().fill(Color.secondary.opacity(0.4)).frame(height: 6).frame(maxWidth: .infinity)
                    side(tires.filter { $0.side == .right }.sorted { $0.isInner && !$1.isInner })  // inner, outer
                }
            }
        }
        .padding()
        .background(
            RoundedRectangle(cornerRadius: 24)
                .fill(Color(.secondarySystemBackground))
        )
    }

    private func side(_ tires: [TirePosition]) -> some View {
        HStack(spacing: 4) {
            ForEach(tires) { tire in
                tireView(tire)
            }
        }
    }

    private func tireView(_ tire: TirePosition) -> some View {
        let reading = inspection.reading(for: tire)
        let status = thresholds.status(depth32: reading?.depthMin32, role: tire.role)
        return Button { onTap(tire) } label: {
            VStack(spacing: 2) {
                Text(tire.code).font(.caption2.bold())
                Text(Units.format32(reading?.depthMin32)).font(.caption2.monospacedDigit())
            }
            .frame(width: 46, height: 64)
            .background(RoundedRectangle(cornerRadius: 10).fill(color(for: status)))
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(highlighted == tire ? Color.accentColor : .clear, lineWidth: 3)
            )
            .foregroundStyle(status == .unknown ? Color.primary : Color.white)
        }
        .buttonStyle(.plain)
    }

    static func color(for status: TireStatus) -> Color {
        switch status {
        case .ok: return .green
        case .watch: return .orange
        case .replace: return .red
        case .unknown: return Color(.tertiarySystemFill)
        }
    }

    private func color(for status: TireStatus) -> Color { VehicleDiagramView.color(for: status) }
}

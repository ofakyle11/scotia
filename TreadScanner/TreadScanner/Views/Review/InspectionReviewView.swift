import SwiftUI
import SwiftData

/// Screens the review view can push from its toolbar menu.
enum ReviewRoute: String, Identifiable, Hashable {
    case report, history
    var id: String { rawValue }
}

/// The main working screen for an inspection: diagram, position list, finish/export.
struct InspectionReviewView: View {
    @Environment(\.modelContext) private var context
    @EnvironmentObject private var sync: SheetsSyncService
    @Bindable var inspection: Inspection
    var startInWalkMode = false

    @State private var selected: TirePosition?
    @State private var route: ReviewRoute?
    @State private var shareURL: URL?
    @State private var showFinishConfirm = false

    private var thresholds: Thresholds { .current }
    private var nextOpen: TirePosition? {
        inspection.positions.first { inspection.reading(for: $0)?.hasDepth != true }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                VehicleDiagramView(inspection: inspection, highlighted: nextOpen) { selected = $0 }

                if let next = nextOpen {
                    Button { selected = next } label: {
                        Label("Next: \(next.code) · \(next.displayName)", systemImage: "arrow.right.circle.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                } else if !inspection.isComplete {
                    Button { showFinishConfirm = true } label: {
                        Label("Finish & send to spreadsheet", systemImage: "checkmark.circle.fill").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent).tint(.green)
                }

                summary

                VStack(spacing: 0) {
                    ForEach(inspection.positions) { pos in
                        let r = inspection.reading(for: pos)
                        Button { selected = pos } label: {
                            HStack {
                                Circle().fill(VehicleDiagramView.color(for: thresholds.status(depth32: r?.depthMin32, role: pos.role))).frame(width: 12)
                                Text(pos.code).bold().frame(width: 44, alignment: .leading)
                                Text(pos.displayName).foregroundStyle(.secondary).lineLimit(1)
                                Spacer()
                                if let r, r.hasDepth {
                                    Text(r.grooves.map { Units.format32($0) }.joined(separator: " · ")).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                                    Text(Units.formatDepth(r.depthMin32)).monospacedDigit().bold()
                                    Image(systemName: r.method == .scan ? "dot.scope" : "keyboard").font(.caption).foregroundStyle(.secondary)
                                } else {
                                    Text("—").foregroundStyle(.secondary)
                                }
                                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                            }
                            .padding(.vertical, 10)
                        }
                        .buttonStyle(.plain)
                        Divider()
                    }
                }
                .padding(.horizontal)

                TextField("Inspection notes", text: $inspection.notes, axis: .vertical)
                    .textFieldStyle(.roundedBorder).padding(.horizontal)
            }
            .padding(.vertical)
        }
        .navigationTitle("Unit \(inspection.vehicle?.unitNumber ?? "")")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button { route = .report } label: { Label("Customer report", systemImage: "doc.richtext") }
                    Button { route = .history } label: { Label("Unit history", systemImage: "chart.line.downtrend.xyaxis") }
                    Button { export() } label: { Label("Share CSV", systemImage: "square.and.arrow.up") }
                    if inspection.isComplete {
                        Button { sync.enqueue(inspection, context: context) } label: { Label("Re-send to spreadsheet", systemImage: "arrow.triangle.2.circlepath") }
                        Button { inspection.isComplete = false; try? context.save() } label: { Label("Reopen", systemImage: "lock.open") }
                    }
                } label: { Image(systemName: "ellipsis.circle") }
            }
        }
        .navigationDestination(item: $selected) { pos in
            TireDetailView(inspection: inspection, position: pos) {
                selected = nextOpen(after: pos)
            }
        }
        .navigationDestination(item: $route) { route in
            switch route {
            case .report:
                InspectionReportView(inspection: inspection)
            case .history:
                UnitHistoryView(unitNumber: inspection.vehicle?.unitNumber ?? "",
                                vehicleID: inspection.vehicle?.id)
            }
        }
        .sheet(item: $shareURL) { url in ShareSheet(items: [url]) }
        .confirmationDialog("Finish inspection?", isPresented: $showFinishConfirm, titleVisibility: .visible) {
            Button("Finish and sync \(inspection.positions.count) rows") { finish() }
        } message: {
            Text(GoogleAuth.shared.isSignedIn ? "Rows append to the Google Sheet when online." : "Not signed in to Google. Rows queue until you sign in, or share the CSV.")
        }
        .onAppear { if startInWalkMode, selected == nil { selected = nextOpen } }
    }

    private var summary: some View {
        let statuses = inspection.positions.map { thresholds.status(depth32: inspection.reading(for: $0)?.depthMin32, role: $0.role) }
        return HStack(spacing: 12) {
            pill("\(statuses.filter { $0 == .replace }.count) replace", .red)
            pill("\(statuses.filter { $0 == .watch }.count) watch", .orange)
            pill("\(statuses.filter { $0 == .ok }.count) ok", .green)
            Spacer()
            SyncBadge(state: inspection.syncState)
        }
        .padding(.horizontal)
    }

    private func pill(_ text: String, _ color: Color) -> some View {
        Text(text).font(.caption.bold()).padding(.horizontal, 10).padding(.vertical, 5)
            .background(Capsule().fill(color.opacity(0.18))).foregroundStyle(color)
    }

    private func nextOpen(after pos: TirePosition) -> TirePosition? {
        let all = inspection.positions
        guard let i = all.firstIndex(of: pos) else { return nil }
        let after = all[(i + 1)...] + all[..<i]
        return after.first { inspection.reading(for: $0)?.hasDepth != true }
    }

    private func finish() {
        inspection.isComplete = true
        try? context.save()
        sync.enqueue(inspection, context: context)
    }

    private func export() {
        shareURL = try? CSVExporter.write(inspection)
    }
}

extension URL: Identifiable { public var id: String { absoluteString } }

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

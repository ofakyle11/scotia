import SwiftUI
import SwiftData

struct InspectionListView: View {
    @Environment(\.modelContext) private var context
    @EnvironmentObject private var sync: SheetsSyncService
    @Query(sort: \Inspection.date, order: .reverse) private var inspections: [Inspection]
    @State private var showNew = false
    @State private var showSettings = false
    @State private var showVerify = false
    @State private var showCapture = false

    var body: some View {
        NavigationStack {
            List {
                if !sync.isOnline && sync.pendingCount > 0 {
                    Label("\(sync.pendingCount) rows waiting for network", systemImage: "wifi.slash")
                        .foregroundStyle(.secondary)
                }
                if let err = sync.lastError {
                    VStack(alignment: .leading, spacing: 6) {
                        Label(err, systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
                        Button("Retry sync") { sync.retryFailed() }.font(.callout)
                    }
                }
                ForEach(inspections) { inspection in
                    NavigationLink(value: inspection.id) {
                        InspectionRow(inspection: inspection)
                    }
                }
                .onDelete { idx in
                    for i in idx { context.delete(inspections[i]) }
                    try? context.save()
                }
            }
            .overlay {
                if inspections.isEmpty {
                    ContentUnavailableView("No inspections yet", systemImage: "truck.box", description: Text("Tap + to start walking around a truck."))
                }
            }
            .navigationTitle("Tread Scanner")
            .navigationDestination(for: UUID.self) { id in
                if let inspection = inspections.first(where: { $0.id == id }) {
                    InspectionReviewView(inspection: inspection)
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Menu {
                        Button { showVerify = true } label: { Label("Verify scanner vs gauge", systemImage: "checkmark.seal") }
                        Button { showCapture = true } label: { Label("Record raw LiDAR capture", systemImage: "waveform.path.ecg.rectangle") }
                        Button { showSettings = true } label: { Label("Settings", systemImage: "gear") }
                    } label: { Image(systemName: "ellipsis.circle") }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showNew = true } label: { Image(systemName: "plus") }
                }
            }
            .sheet(isPresented: $showNew) { NewInspectionView() }
            .sheet(isPresented: $showSettings) { SettingsView() }
            .sheet(isPresented: $showVerify) { VerifyModeView() }
            .sheet(isPresented: $showCapture) { RawCaptureView() }
        }
    }
}

struct InspectionRow: View {
    let inspection: Inspection

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text(inspection.vehicle?.unitNumber.isEmpty == false ? "Unit \(inspection.vehicle!.unitNumber)" : "Unnamed unit")
                    .font(.headline)
                Text("\(inspection.vehicle?.customer?.name ?? "No customer") · \(inspection.preset.label)")
                    .font(.subheadline).foregroundStyle(.secondary)
                Text(inspection.date, style: .date).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text("\(inspection.completedCount)/\(inspection.positions.count)")
                    .font(.subheadline.monospacedDigit())
                SyncBadge(state: inspection.syncState)
            }
        }
    }
}

struct SyncBadge: View {
    let state: SyncState
    var body: some View {
        switch state {
        case .notQueued: Image(systemName: "circle.dashed").foregroundStyle(.secondary)
        case .pending: Image(systemName: "arrow.triangle.2.circlepath").foregroundStyle(.orange)
        case .synced: Image(systemName: "checkmark.icloud.fill").foregroundStyle(.green)
        case .failed: Image(systemName: "exclamationmark.icloud.fill").foregroundStyle(.red)
        }
    }
}

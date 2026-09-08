import SwiftUI
import SwiftData

@main
struct TreadScannerApp: App {
    let container: ModelContainer
    @StateObject private var sync: SheetsSyncService

    init() {
        let schema = Schema([
            Customer.self, Vehicle.self, Inspection.self,
            TireReading.self, SyncQueueItem.self, VerifySample.self
        ])
        let config = ModelConfiguration(schema: schema, isStoredInMemoryOnly: false)
        let built: ModelContainer
        do {
            built = try ModelContainer(for: schema, configurations: [config])
        } catch {
            fatalError("Could not create SwiftData container: \(error)")
        }
        container = built
        _sync = StateObject(wrappedValue: SheetsSyncService(container: built))
    }

    var body: some Scene {
        WindowGroup {
            InspectionListView()
                .environmentObject(sync)
                .task { sync.start() }
        }
        .modelContainer(container)
    }
}

import Foundation
import Network
import SwiftData

/// Offline-first sync. Finishing an inspection enqueues SyncQueueItems; this service drains
/// them whenever the network is up, with backoff, and updates Inspection.syncState.
@MainActor
final class SheetsSyncService: ObservableObject {
    @Published private(set) var isOnline = false
    @Published private(set) var isSyncing = false
    @Published private(set) var pendingCount = 0
    @Published private(set) var lastError: String?

    private let container: ModelContainer
    private let monitor = NWPathMonitor()
    private var started = false
    private var ensuredSheets: Set<String> = []

    init(container: ModelContainer) {
        self.container = container
    }

    func start() {
        guard !started else { return }
        started = true
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                guard let self else { return }
                self.isOnline = path.status == .satisfied
                if self.isOnline { await self.syncNow() }
            }
        }
        monitor.start(queue: DispatchQueue(label: "sync.path"))
        refreshPendingCount()
    }

    // MARK: Enqueue

    func enqueue(_ inspection: Inspection, context: ModelContext) {
        for row in SpreadsheetRow.rows(for: inspection) {
            context.insert(SyncQueueItem(inspectionID: inspection.id, sheetName: AppConfig.inspectionsSheetName, cells: row))
        }
        inspection.syncState = .pending
        try? context.save()
        refreshPendingCount()
        Task { await syncNow() }
    }

    func enqueue(_ sample: VerifySample, context: ModelContext) {
        context.insert(SyncQueueItem(inspectionID: sample.id, sheetName: AppConfig.verifySheetName, cells: SpreadsheetRow.row(for: sample)))
        try? context.save()
        refreshPendingCount()
        Task { await syncNow() }
    }

    // MARK: Drain

    func syncNow() async {
        guard !isSyncing, GoogleAuth.shared.isSignedIn, AppConfig.spreadsheetID != nil else { return }
        isSyncing = true
        defer { isSyncing = false; refreshPendingCount() }

        let context = ModelContext(container)
        let api = SheetsAPI(auth: GoogleAuth.shared)
        let items = (try? context.fetch(FetchDescriptor<SyncQueueItem>(sortBy: [SortDescriptor(\.createdAt)]))) ?? []
        guard !items.isEmpty else { return }

        // Group by sheet, then by inspection, so an inspection lands as a contiguous block.
        let bySheet = Dictionary(grouping: items, by: \.sheetName)
        for (sheet, sheetItems) in bySheet {
            let header = sheet == AppConfig.verifySheetName ? SpreadsheetRow.verifyHeader : SpreadsheetRow.header
            do {
                if !ensuredSheets.contains(sheet) {
                    try await api.ensureSheet(named: sheet, header: header)
                    ensuredSheets.insert(sheet)
                }
            } catch {
                lastError = error.localizedDescription
                continue
            }

            let byInspection = Dictionary(grouping: sheetItems, by: \.inspectionID)
            for (inspectionID, group) in byInspection {
                let ordered = group.sorted { $0.createdAt < $1.createdAt }
                // Skip groups in backoff.
                if let last = ordered.map(\.attempts).max(), last > 0 {
                    let wait = min(3600, pow(2, Double(last)) * 30)
                    if let newest = ordered.compactMap({ $0.lastErrorAt }).max(), Date().timeIntervalSince(newest) < wait { continue }
                }
                do {
                    try await api.append(rows: ordered.map(\.cells), to: sheet)
                    for item in ordered { context.delete(item) }
                    markInspection(inspectionID, state: .synced, context: context)
                    lastError = nil
                } catch {
                    let retryable = (error as? SheetsAPI.SheetsError)?.isRetryable ?? true
                    for item in ordered {
                        item.attempts += 1
                        item.lastError = error.localizedDescription
                        item.lastErrorAt = Date()
                    }
                    if !retryable || (ordered.first?.attempts ?? 0) >= 8 {
                        markInspection(inspectionID, state: .failed, context: context)
                    }
                    lastError = error.localizedDescription
                }
                try? context.save()
            }
        }
    }

    /// Clears failure state so a fixed spreadsheet/sign-in can retry immediately.
    func retryFailed() {
        let context = ModelContext(container)
        let items = (try? context.fetch(FetchDescriptor<SyncQueueItem>())) ?? []
        items.forEach { $0.attempts = 0; $0.lastErrorAt = nil }
        let failed = (try? context.fetch(FetchDescriptor<Inspection>())) ?? []
        failed.filter { $0.syncState == .failed }.forEach { $0.syncState = .pending }
        try? context.save()
        ensuredSheets.removeAll()
        Task { await syncNow() }
    }

    private func markInspection(_ id: UUID, state: SyncState, context: ModelContext) {
        var descriptor = FetchDescriptor<Inspection>(predicate: #Predicate { $0.id == id })
        descriptor.fetchLimit = 1
        if let inspection = try? context.fetch(descriptor).first {
            inspection.syncState = state
        }
    }

    private func refreshPendingCount() {
        let context = ModelContext(container)
        pendingCount = (try? context.fetchCount(FetchDescriptor<SyncQueueItem>())) ?? 0
    }
}

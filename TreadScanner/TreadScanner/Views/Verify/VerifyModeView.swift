import SwiftUI
import SwiftData

/// Accuracy study: scan a groove, then type the dial-gauge reading for the same groove.
/// Pairs go to the "Verify" tab so the shop can see how the scanner tracks the gauge.
struct VerifyModeView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var sync: SheetsSyncService
    @Query(sort: \VerifySample.date, order: .reverse) private var samples: [VerifySample]

    @State private var label = ""
    @State private var gauge = ""
    @State private var scan: DepthResult?
    @State private var showScan = false

    var body: some View {
        NavigationStack {
            Form {
                Section("New sample") {
                    TextField("Label (e.g. Unit 42 LF centre)", text: $label)
                    HStack {
                        Text("Scan")
                        Spacer()
                        if let scan {
                            Text("\(Units.format32(scan.depth32)) ± \(String(format: "%.1f", scan.uncertainty32))").monospacedDigit()
                        }
                        Button(scan == nil ? "Scan" : "Rescan") { showScan = true }
                            .disabled(!LiDARAvailability.isSupported)
                    }
                    HStack {
                        Text("Gauge")
                        TextField("32nds", text: $gauge).keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                    }
                    Button("Save pair") { save() }
                        .disabled(scan == nil || Double(gauge) == nil)
                }
                Section {
                    if samples.isEmpty {
                        Text("No samples yet.").foregroundStyle(.secondary)
                    } else {
                        stats
                        ForEach(samples) { s in
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(s.label.isEmpty ? "Sample" : s.label).font(.subheadline)
                                    Text(s.date, style: .date).font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Text("scan \(Units.format32(s.scan32))").font(.caption.monospacedDigit())
                                Text("gauge \(Units.format32(s.gauge32))").font(.caption.monospacedDigit())
                                Text(String(format: "%+.1f", s.error32)).monospacedDigit().bold()
                                    .foregroundStyle(abs(s.error32) <= 1 ? .green : .orange)
                            }
                        }
                        .onDelete { idx in for i in idx { context.delete(samples[i]) }; try? context.save() }
                    }
                } header: {
                    Text("Samples (\(samples.count))")
                } footer: {
                    Text("Target: 90% of scans within ±1/32 of the gauge and no pass/fail disagreements at 4/32 and 2/32.")
                }
            }
            .navigationTitle("Verify scanner")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .fullScreenCover(isPresented: $showScan) {
                ScanView(title: "Verify") { result, _ in
                    scan = result
                    showScan = false
                }
            }
        }
    }

    private var stats: some View {
        let errors = samples.map(\.error32)
        let n = Double(errors.count)
        let mean = errors.reduce(0, +) / n
        let within1 = Double(errors.filter { abs($0) <= 1 }.count) / n * 100
        let rmse = (errors.reduce(0) { $0 + $1 * $1 } / n).squareRoot()
        return VStack(alignment: .leading, spacing: 4) {
            Text(String(format: "Bias %+.2f/32 · RMSE %.2f/32 · %.0f%% within ±1/32", mean, rmse, within1))
                .font(.footnote.monospacedDigit())
        }
    }

    private func save() {
        guard let scan, let g = Double(gauge) else { return }
        let sample = VerifySample(
            technician: UserDefaults.standard.string(forKey: DefaultsKey.technicianName) ?? "",
            label: label, scan32: scan.depth32, scanConfidence32: scan.uncertainty32, gauge32: g, frameCount: scan.frameCount
        )
        context.insert(sample)
        try? context.save()
        sync.enqueue(sample, context: context)
        self.scan = nil
        gauge = ""
    }
}

import SwiftUI

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var sync: SheetsSyncService
    @ObservedObject private var auth = GoogleAuth.shared

    @AppStorage(DefaultsKey.technicianName) private var technician = ""
    @AppStorage(DefaultsKey.showMillimetres) private var showMM = false
    @AppStorage(DefaultsKey.spreadsheetID) private var spreadsheetID = ""
    @State private var thresholds = Thresholds.current
    @State private var authError: String?
    @State private var signingIn = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Technician") {
                    TextField("Default technician name", text: $technician)
                }
                Section("Thresholds (32nds)") {
                    Stepper("Steer minimum: \(thresholds.steerMinimum32)/32", value: $thresholds.steerMinimum32, in: 1...10)
                    Stepper("Drive/trailer minimum: \(thresholds.otherMinimum32)/32", value: $thresholds.otherMinimum32, in: 1...10)
                    Stepper("Watch band: +\(thresholds.watchBand32)/32", value: $thresholds.watchBand32, in: 0...6)
                    Text("Defaults: 4/32 steer, 2/32 others (Canada NSC / US FMCSA). WATCH flags tires within the band above the minimum.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section("Display") {
                    Toggle("Show millimetres instead of 32nds", isOn: $showMM)
                }
                Section("Google Sheets") {
                    if AppConfig.googleClientID == nil {
                        Label("Add GoogleClientID to Config.plist to enable sync.", systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
                    }
                    if auth.isSignedIn {
                        LabeledContent("Account", value: auth.accountEmail ?? "Signed in")
                        Button("Sign out", role: .destructive) { auth.signOut() }
                    } else {
                        Button { signIn() } label: {
                            if signingIn { ProgressView() } else { Label("Sign in with Google", systemImage: "person.crop.circle") }
                        }
                        .disabled(AppConfig.googleClientID == nil || signingIn)
                    }
                    TextField("Spreadsheet ID (from the sheet URL)", text: $spreadsheetID)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    if spreadsheetID.isEmpty, let fromPlist = AppConfig.spreadsheetID {
                        Text("Using Config.plist: \(fromPlist)").font(.footnote).foregroundStyle(.secondary)
                    }
                    LabeledContent("Pending rows", value: "\(sync.pendingCount)")
                    Button("Sync now") { Task { await sync.syncNow() } }.disabled(!auth.isSignedIn)
                    if let e = authError ?? sync.lastError {
                        Text(e).font(.footnote).foregroundStyle(.orange)
                    }
                }
                Section("Scanner") {
                    LabeledContent("LiDAR", value: LiDARAvailability.isSupported ? "Available" : "Not on this device")
                    Text("Scans measure groove depth relative to the tread surface and report a ± band. Readings over ±1.5/32 are flagged. Verify against a gauge from the main menu to build up accuracy data.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { thresholds.save(); dismiss() } } }
            .onChange(of: thresholds) { _, t in t.save() }
        }
    }

    private func signIn() {
        signingIn = true
        authError = nil
        Task {
            do { try await auth.signIn() } catch { authError = error.localizedDescription }
            signingIn = false
        }
    }
}

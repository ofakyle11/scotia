import SwiftUI
import SwiftData
import PhotosUI

/// Per-tire entry: three grooves (inner/centre/outer), scan or manual, photo, extras.
struct TireDetailView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss

    let inspection: Inspection
    let position: TirePosition
    var onNext: (() -> Void)?

    @State private var reading: TireReading
    @State private var inner = ""
    @State private var centre = ""
    @State private var outer = ""
    @State private var pressure = ""
    @State private var showScan = false
    @State private var scanTarget: Groove = .centre
    @State private var photoItem: PhotosPickerItem?
    @State private var showCamera = false
    @FocusState private var focused: Groove?
    /// Text values that came from the scanner; editing away from them flips method to manual.
    @State private var scannedText: [Groove: String] = [:]

    enum Groove: String, CaseIterable, Identifiable {
        case inner, centre, outer
        var id: String { rawValue }
        var label: String { rawValue.capitalized }
    }

    init(inspection: Inspection, position: TirePosition, onNext: (() -> Void)? = nil) {
        self.inspection = inspection
        self.position = position
        self.onNext = onNext
        let existing = inspection.reading(for: position) ?? TireReading(positionCode: position.code, inspection: nil)
        _reading = State(initialValue: existing)
        _inner = State(initialValue: Self.text(existing.depthInner32))
        _centre = State(initialValue: Self.text(existing.depthCentre32))
        _outer = State(initialValue: Self.text(existing.depthOuter32))
        _pressure = State(initialValue: existing.pressurePSI.map { String($0) } ?? "")
        // A tire saved as a scan reopens with its grooves known to be scanned, so a rescan of one
        // groove keeps the method honest without demanding all three again.
        if existing.method == .scan {
            var scanned: [Groove: String] = [:]
            for (g, v) in [(Groove.inner, existing.depthInner32), (.centre, existing.depthCentre32), (.outer, existing.depthOuter32)] where v != nil {
                scanned[g] = Self.text(v)
            }
            _scannedText = State(initialValue: scanned)
        }
    }

    private var thresholds: Thresholds { .current }
    private var canScan: Bool { LiDARAvailability.isSupported }

    var body: some View {
        Form {
            Section {
                HStack {
                    VStack(alignment: .leading) {
                        Text(position.code).font(.largeTitle.bold())
                        Text("\(position.displayName) · \(position.role.label)").foregroundStyle(.secondary)
                    }
                    Spacer()
                    statusPill
                }
                if position.isInner {
                    Label("Inner dual: use the gauge and type the reading.", systemImage: "hand.point.up.left")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }

            Section("Tread depth (32nds)") {
                grooveRow(.inner, text: $inner)
                grooveRow(.centre, text: $centre)
                grooveRow(.outer, text: $outer)
                HStack {
                    Text("Minimum").bold()
                    Spacer()
                    Text(Units.formatDepth(currentMin)).monospacedDigit()
                    if let c = reading.scanConfidence32, reading.method == .scan {
                        Text("± \(String(format: "%.1f", c))").font(.caption).foregroundStyle(.secondary)
                    }
                }
                Picker("Method", selection: Binding(get: { reading.method }, set: { reading.method = $0 })) {
                    // "Scan" is set only by the scanner (apply); a typed number may be gauge or manual.
                    ForEach(ReadingMethod.allCases.filter { $0 != .scan || reading.method == .scan }, id: \.self) { Text($0.rawValue.capitalized).tag($0) }
                }
                .pickerStyle(.segmented)
                if let uneven = unevenWear, uneven >= 3 {
                    Label("Grooves differ by \(Units.format32(uneven)). Check alignment and inflation.", systemImage: "exclamationmark.triangle")
                        .font(.footnote).foregroundStyle(.orange)
                }
            }

            Section("Photo") {
                if let img = PhotoStore.load(reading.photoFilename) {
                    Image(uiImage: img).resizable().scaledToFit().frame(maxHeight: 180).clipShape(RoundedRectangle(cornerRadius: 10))
                }
                HStack {
                    Button { showCamera = true } label: { Label("Take photo", systemImage: "camera") }
                    Spacer()
                    PhotosPicker(selection: $photoItem, matching: .images) { Label("Library", systemImage: "photo") }
                }
            }

            Section("Tire details (optional)") {
                TextField("Pressure (psi)", text: $pressure).keyboardType(.numberPad)
                Picker("Valve cap", selection: Binding(get: { reading.valveCap }, set: { reading.valveCap = $0 })) {
                    ForEach(ValveCap.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                TextField("DOT code", text: $reading.dotCode).textInputAutocapitalization(.characters)
                TextField("Brand", text: $reading.brand)
                TextField("Model", text: $reading.model)
                TextField("Size (e.g. 11R22.5)", text: $reading.size)
                TextField("Notes", text: $reading.notes, axis: .vertical)
            }
        }
        .navigationTitle(position.code)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(onNext == nil ? "Save" : "Save & next") { save(); onNext?(); if onNext == nil { dismiss() } }
            }
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { focused = nil }
            }
        }
        .onAppear { if position.isInner || !canScan { focused = .centre } }
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data) {
                    reading.photoFilename = PhotoStore.save(img, inspectionID: inspection.id, positionCode: position.code)
                }
            }
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { img in
                if let img { reading.photoFilename = PhotoStore.save(img, inspectionID: inspection.id, positionCode: position.code) }
            }
            .ignoresSafeArea()
        }
        .fullScreenCover(isPresented: $showScan) {
            ScanView(title: "\(position.code) · \(scanTarget.label) groove") { result, image in
                apply(result, to: scanTarget)
                if let image { reading.photoFilename = PhotoStore.save(image, inspectionID: inspection.id, positionCode: position.code) }
                // Close the scanner so the number is seen landing in its row and the next groove is
                // aimed at deliberately. Auto-advancing kept the session live with the gate already
                // green, so the next slot filled with the groove still under the lens in under a second
                // and the only cue was the small title at the top.
                showScan = false
            }
        }
    }

    private var statusPill: some View {
        let policy = FleetPolicy.find(inspection.vehicle?.customer?.name, in: context)
        let status = thresholds.status(depth32: currentMin, role: position.role, minimum: policy?.role(position.role).pull)
        return Text(status == .unknown ? "—" : status.rawValue)
            .font(.caption.bold())
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(Capsule().fill(VehicleDiagramView.color(for: status)))
            .foregroundStyle(status == .unknown ? Color.primary : .white)
    }

    private func grooveRow(_ groove: Groove, text: Binding<String>) -> some View {
        HStack {
            Text(groove.label).frame(width: 70, alignment: .leading)
            TextField("—", text: text)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .focused($focused, equals: groove)
                .onChange(of: text.wrappedValue) { _, new in
                    if reading.method == .scan, scannedText[groove] != new {
                        reading.method = .manual
                        reading.scanConfidence32 = nil
                    }
                }
            Text("/32").foregroundStyle(.secondary)
            if canScan {
                Button {
                    scanTarget = groove
                    showScan = true
                } label: {
                    Image(systemName: "dot.scope").font(.title3)
                        .frame(minWidth: 44, minHeight: 44)   // glove-sized target (HIG minimum)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.borderless)
            }
        }
    }

    private func value(for g: Groove) -> String {
        switch g { case .inner: return inner; case .centre: return centre; case .outer: return outer }
    }

    private var parsed: (Double?, Double?, Double?) { (Double(inner), Double(centre), Double(outer)) }
    private var currentMin: Double? { [parsed.0, parsed.1, parsed.2].compactMap { $0 }.min() }
    private var unevenWear: Double? {
        let v = [parsed.0, parsed.1, parsed.2].compactMap { $0 }
        guard let lo = v.min(), let hi = v.max() else { return nil }
        return hi - lo
    }

    private func apply(_ result: DepthResult, to groove: Groove) {
        let text = String(format: "%.1f", Units.roundedHalf32(result.depth32))
        scannedText[groove] = text
        switch groove {
        case .inner: inner = text
        case .centre: centre = text
        case .outer: outer = text
        }
        // The tire is a "scan" only when every groove that holds a value came from the scanner.
        // One scanned groove beside two typed ones used to export as method=scan with a ± band
        // that belonged to a groove which may not even be the minimum.
        let allScanned = Groove.allCases.allSatisfy { value(for: $0).isEmpty || scannedText[$0] == value(for: $0) }
        reading.method = allScanned ? .scan : .manual
        // The ± band is rounded UP and never below a half 32nd; rounding to nearest printed
        // "± 0.0" for any band under 0.25/32.
        reading.scanConfidence32 = allScanned ? max(reading.scanConfidence32 ?? 0, Units.ceilHalf32(result.uncertainty32)) : nil
    }

    private func save() {
        reading.depthInner32 = Double(inner)
        reading.depthCentre32 = Double(centre)
        reading.depthOuter32 = Double(outer)
        reading.pressurePSI = Int(pressure)
        reading.updatedAt = Date()
        if reading.modelContext == nil {
            context.insert(reading)
            reading.inspection = inspection
        }
        try? context.save()
    }

    private static func text(_ v: Double?) -> String {
        guard let v else { return "" }
        return v == v.rounded() ? String(Int(v)) : String(format: "%.1f", v)
    }
}

/// UIImagePickerController wrapper for taking a tire photo.
struct CameraPicker: UIViewControllerRepresentable {
    var onImage: (UIImage?) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let p = UIImagePickerController()
        p.sourceType = UIImagePickerController.isSourceTypeAvailable(.camera) ? .camera : .photoLibrary
        p.delegate = context.coordinator
        return p
    }
    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            parent.onImage(info[.originalImage] as? UIImage)
            parent.dismiss()
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.onImage(nil)
            parent.dismiss()
        }
    }
}

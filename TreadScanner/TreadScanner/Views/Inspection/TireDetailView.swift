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
                    ForEach(ReadingMethod.allCases, id: \.self) { Text($0.rawValue.capitalized).tag($0) }
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
                // Move to the next groove automatically.
                if let next = Groove.allCases.first(where: { value(for: $0).isEmpty }) {
                    scanTarget = next
                } else {
                    showScan = false
                }
            }
        }
    }

    private var statusPill: some View {
        let status = thresholds.status(depth32: currentMin, role: position.role)
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
                } label: { Image(systemName: "dot.scope").font(.title3) }
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
        reading.method = .scan
        reading.scanConfidence32 = max(reading.scanConfidence32 ?? 0, Units.roundedHalf32(result.uncertainty32))
        switch groove {
        case .inner: inner = text
        case .centre: centre = text
        case .outer: outer = text
        }
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

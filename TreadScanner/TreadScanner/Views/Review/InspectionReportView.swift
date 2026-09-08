import SwiftUI
import UIKit

/// Printable customer-facing report for one inspection. Mirrors the web app's report page.
struct InspectionReportView: View {
    let inspection: Inspection

    @State private var shareURL: URL?
    @State private var exportFailed = false

    var body: some View {
        // The report is laid out at a fixed page width, so allow panning on narrow phones.
        ScrollView([.vertical, .horizontal]) {
            ReportBody(inspection: inspection)
                .padding()
        }
        .navigationTitle("Report")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { exportPDF() } label: { Image(systemName: "square.and.arrow.up") }
            }
        }
        .sheet(item: $shareURL) { url in ShareSheet(items: [url]) }
        .alert("Could not build the PDF", isPresented: $exportFailed) {
            Button("OK", role: .cancel) {}
        }
    }

    @MainActor private func exportPDF() {
        if let url = ReportPDF.write(ReportBody(inspection: inspection), for: inspection) {
            shareURL = url
        } else {
            exportFailed = true
        }
    }
}

// MARK: - Report content

/// The report itself, laid out at a fixed width so it renders the same on screen and in the PDF.
struct ReportBody: View {
    let inspection: Inspection
    var width: CGFloat = ReportPDF.contentWidth

    private var thresholds: Thresholds { .current }

    private var positions: [TirePosition] { inspection.positions }

    private func status(_ position: TirePosition) -> TireStatus {
        thresholds.status(depth32: inspection.reading(for: position)?.depthMin32, role: position.role)
    }

    private func codes(_ status: TireStatus) -> [String] {
        positions.filter { self.status($0) == status }.map(\.code)
    }

    private var photoPositions: [TirePosition] {
        positions.filter { inspection.reading(for: $0)?.photoFilename != nil }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            header
            summary
            VehicleDiagramView(inspection: inspection, highlighted: nil) { _ in }
            table
            if !inspection.notes.isEmpty {
                Text("Notes: ").bold() + Text(inspection.notes)
            }
            if !photoPositions.isEmpty { photos }
            Text(footnote).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(width: width, alignment: .leading)
        .padding(.horizontal, 0)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Scotia Tire & Alignment").font(.title2.bold())
                Text("Tire tread inspection").font(.headline).foregroundStyle(.secondary)
            }
            VStack(alignment: .leading, spacing: 4) {
                metaRow(("Unit", inspection.vehicle?.unitNumber), ("Customer", inspection.vehicle?.customer?.name))
                metaRow(("Date", Self.dateFormatter.string(from: inspection.date)), ("Plate", inspection.vehicle?.plate))
                metaRow(("VIN", inspection.vehicle?.vin), ("Odometer", inspection.odometer.map { "\($0.formatted()) km" }))
                metaRow(("Technician", inspection.technician), ("Ref", inspection.shortID))
            }
            .font(.caption)
            Divider()
        }
    }

    private func metaRow(_ left: (String, String?), _ right: (String, String?)) -> some View {
        HStack(alignment: .top, spacing: 12) {
            meta(left.0, left.1)
            meta(right.0, right.1)
        }
    }

    private func meta(_ label: String, _ value: String?) -> some View {
        let text = (value?.isEmpty == false) ? value! : "—"
        return HStack(spacing: 4) {
            Text(label).bold()
            Text(text).foregroundStyle(.secondary)
            Spacer(minLength: 0)
        }
    }

    private var summary: some View {
        HStack(spacing: 10) {
            tile("Replace now", .replace)
            tile("Replace soon", .watch)
            tile("OK", .ok)
        }
    }

    private func tile(_ title: String, _ status: TireStatus) -> some View {
        let list = codes(status)
        return VStack(alignment: .leading, spacing: 2) {
            Text("\(list.count)").font(.title.bold())
            Text(title).font(.caption.bold())
            Text(list.isEmpty ? "—" : list.joined(separator: " "))
                .font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 12).fill(VehicleDiagramView.color(for: status).opacity(0.15)))
    }

    private var table: some View {
        VStack(spacing: 0) {
            headerRow
            Divider()
            ForEach(positions) { pos in
                row(pos)
                Divider()
            }
        }
    }

    private var headerRow: some View {
        HStack(spacing: 4) {
            Text("Position").frame(width: 92, alignment: .leading)
            Text("Inner").frame(width: 52, alignment: .trailing)
            Text("Centre").frame(width: 52, alignment: .trailing)
            Text("Outer").frame(width: 52, alignment: .trailing)
            Text("Min").frame(width: 58, alignment: .trailing)
            Text("PSI").frame(width: 34, alignment: .trailing)
            Text("Status").frame(width: 62, alignment: .leading)
            Text("Notes").frame(maxWidth: .infinity, alignment: .leading)
        }
        .font(.caption2.bold())
        .foregroundStyle(.secondary)
        .padding(.vertical, 4)
    }

    private func row(_ pos: TirePosition) -> some View {
        let r = inspection.reading(for: pos)
        let st = status(pos)
        return HStack(alignment: .top, spacing: 4) {
            VStack(alignment: .leading, spacing: 1) {
                Text(pos.code).font(.caption.bold())
                Text(pos.displayName).font(.system(size: 9)).foregroundStyle(.secondary)
            }
            .frame(width: 92, alignment: .leading)
            Text(Units.format32(r?.depthInner32)).frame(width: 52, alignment: .trailing)
            Text(Units.format32(r?.depthCentre32)).frame(width: 52, alignment: .trailing)
            Text(Units.format32(r?.depthOuter32)).frame(width: 52, alignment: .trailing)
            Text(Units.formatDepth(r?.depthMin32)).bold().frame(width: 58, alignment: .trailing)
            Text(r?.pressurePSI.map { String($0) } ?? "—").frame(width: 34, alignment: .trailing)
            Text(st == .unknown ? "—" : st.rawValue)
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(st == .unknown ? Color.secondary : VehicleDiagramView.color(for: st))
                .frame(width: 62, alignment: .leading)
            Text(Self.rowNotes(r)).font(.system(size: 10)).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .font(.caption.monospacedDigit())
        .padding(.vertical, 4)
    }

    /// Three photos per row, laid out eagerly so the off-screen PDF render includes them.
    private var photos: some View {
        let rows = stride(from: 0, to: photoPositions.count, by: 3).map { start in
            Array(photoPositions[start..<min(start + 3, photoPositions.count)])
        }
        let itemWidth = (width - 16) / 3
        return VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                HStack(alignment: .top, spacing: 8) {
                    ForEach(row) { pos in
                        photoCell(pos, width: itemWidth)
                    }
                    Spacer(minLength: 0)
                }
            }
        }
    }

    private func photoCell(_ pos: TirePosition, width itemWidth: CGFloat) -> some View {
        let reading = inspection.reading(for: pos)
        return VStack(alignment: .leading, spacing: 2) {
            if let image = PhotoStore.load(reading?.photoFilename) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .frame(width: itemWidth, height: 110)
                    .clipped()
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            Text("\(pos.code) · \(Units.formatDepth(reading?.depthMin32))")
                .font(.caption2).foregroundStyle(.secondary)
        }
        .frame(width: itemWidth, alignment: .leading)
    }

    private var footnote: String {
        let t = thresholds
        return "Minimums: \(t.steerMinimum32)/32 steer, \(t.otherMinimum32)/32 drive & trailer (Canada NSC / US FMCSA). "
            + "WATCH = within \(t.watchBand32)/32 of the minimum. "
            + "Depths in 32nds of an inch, lowest of three grooves."
    }

    /// Reading notes, tire identity, and an uneven-wear flag when the grooves differ by 3/32 or more.
    static func rowNotes(_ reading: TireReading?) -> String {
        guard let reading else { return "" }
        var parts: [String] = []
        if !reading.notes.isEmpty { parts.append(reading.notes) }
        let identity = "\(reading.brand) \(reading.size)".trimmingCharacters(in: .whitespaces)
        if !identity.isEmpty { parts.append(identity) }
        if reading.grooves.count > 1, let spread = reading.unevenWear32, spread >= 3 {
            parts.append("uneven wear")
        }
        return parts.joined(separator: " · ")
    }

    static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .short
        return f
    }()
}

// MARK: - PDF

/// Renders a SwiftUI view to a US Letter PDF on disk, for the share sheet.
enum ReportPDF {
    static let pageSize = CGSize(width: 612, height: 792)   // US Letter, points
    static let margin: CGFloat = 36
    static var contentWidth: CGFloat { pageSize.width - margin * 2 }

    @MainActor
    static func write<Content: View>(_ content: Content, for inspection: Inspection) -> URL? {
        let renderer = ImageRenderer(content: content.frame(width: contentWidth))
        renderer.scale = 2
        guard let image = renderer.uiImage, image.size.width > 0, image.size.height > 0 else { return nil }

        let usableHeight = pageSize.height - margin * 2
        // Draw the rendered report at the content width and slice it into Letter pages.
        let drawWidth = contentWidth
        let drawHeight = image.size.height * (drawWidth / image.size.width)
        let pageCount = max(1, Int(ceil(drawHeight / usableHeight)))

        let unit = inspection.vehicle?.unitNumber.replacingOccurrences(of: "/", with: "-") ?? "unit"
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("report_\(unit)_\(inspection.shortID).pdf")

        let pdf = UIGraphicsPDFRenderer(bounds: CGRect(origin: .zero, size: pageSize))
        do {
            try pdf.writePDF(to: url) { ctx in
                for page in 0..<pageCount {
                    ctx.beginPage()
                    let clip = CGRect(x: margin, y: margin, width: drawWidth, height: usableHeight)
                    ctx.cgContext.saveGState()
                    ctx.cgContext.clip(to: clip)
                    let origin = CGPoint(x: margin, y: margin - CGFloat(page) * usableHeight)
                    image.draw(in: CGRect(origin: origin, size: CGSize(width: drawWidth, height: drawHeight)))
                    ctx.cgContext.restoreGState()
                }
            }
        } catch {
            return nil
        }
        return url
    }
}

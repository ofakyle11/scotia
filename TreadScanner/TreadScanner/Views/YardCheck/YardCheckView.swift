import SwiftUI
import SwiftData
import WebKit

/// List of yard checks and the rendered fleet report. The report is produced by the same
/// yardcheck.js the web app and PC tool use, loaded into a web view, then exported to PDF.
struct YardCheckListView: View {
    @Environment(\.modelContext) private var context
    @Query(sort: \Survey.date, order: .reverse) private var surveys: [Survey]
    @State private var showNew = false

    var body: some View {
        NavigationStack {
            List {
                if surveys.isEmpty {
                    Text("No yard checks yet. Start one here, then pick it when you begin each inspection.").foregroundStyle(.secondary)
                }
                ForEach(surveys) { sv in
                    NavigationLink(value: sv.id) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(sv.fleet).font(.headline)
                            Text("\(sv.location) · \(sv.date.formatted(date: .abbreviated, time: .omitted)) · #\(sv.surveyNumber)").font(.subheadline).foregroundStyle(.secondary)
                            Text("\(sv.inspections.count) vehicles · \(sv.inspections.reduce(0) { $0 + $1.positions.count }) tires").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                .onDelete { idx in for i in idx { context.delete(surveys[i]) }; try? context.save() }
            }
            .navigationTitle("Yard checks")
            .navigationDestination(for: UUID.self) { id in
                if let sv = surveys.first(where: { $0.id == id }) { YardCheckReportView(survey: sv) }
            }
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button { showNew = true } label: { Image(systemName: "plus") } } }
            .sheet(isPresented: $showNew) { NewSurveyView() }
        }
    }
}

struct NewSurveyView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @State private var fleet = ""
    @State private var location = ""
    @State private var account = ""
    @State private var reportedBy = UserDefaults.standard.string(forKey: DefaultsKey.technicianName) ?? ""
    @State private var participants = ""

    var body: some View {
        NavigationStack {
            Form {
                TextField("Fleet / customer", text: $fleet).textInputAutocapitalization(.words)
                TextField("Location (yard, city)", text: $location)
                TextField("Account number (optional)", text: $account)
                TextField("Reported by", text: $reportedBy).textInputAutocapitalization(.words)
                TextField("Participants (comma separated)", text: $participants)
            }
            .navigationTitle("New yard check")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        context.insert(Survey(fleet: fleet.trimmingCharacters(in: .whitespaces), location: location, account: account, reportedBy: reportedBy, participants: participants))
                        try? context.save(); dismiss()
                    }.disabled(fleet.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }
}

struct YardCheckReportView: View {
    @Environment(\.modelContext) private var context
    let survey: Survey
    @State private var html = ""
    @State private var pdfURL: URL?
    @State private var exporting = false
    @State private var webView = WKWebView()

    var body: some View {
        Group {
            if survey.inspections.isEmpty {
                ContentUnavailableView("No vehicles yet", systemImage: "truck.box", description: Text("Pick this yard check when starting an inspection."))
            } else {
                ReportWebView(html: html, webView: webView)
            }
        }
        .navigationTitle("Yard check #\(survey.surveyNumber)")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { export() } label: { if exporting { ProgressView() } else { Image(systemName: "square.and.arrow.up") } }
                    .disabled(survey.inspections.isEmpty || exporting)
            }
        }
        .onAppear { html = YardCheckHTML.page(document: YardCheckDocument.build(survey: survey, context: context)) }
        .sheet(item: $pdfURL) { url in ShareSheet(items: [url]) }
    }

    private func export() {
        exporting = true
        // Letter, no margins: the page CSS already lays out 8.5 x 11 in pages.
        let config = WKPDFConfiguration()
        webView.createPDF(configuration: config) { result in
            exporting = false
            guard case .success(let data) = result else { return }
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("YardCheck_\(survey.fleet.replacingOccurrences(of: " ", with: "_"))_\(survey.surveyNumber).pdf")
            try? data.write(to: url)
            pdfURL = url
        }
    }
}

/// Wraps yardcheck.js and yardcheck.css (bundled resources, kept identical to web/) around a document.
enum YardCheckHTML {
    static func page(document: [String: Any]) -> String {
        let js = resource("yardcheck", "js"), css = resource("yardcheck", "css")
        let data = YardCheckDocument.json(document).replacingOccurrences(of: "</", with: "<\\/")
        return """
        <!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=816">
        <style>html,body{margin:0;background:#777}\(css)</style></head><body><div id="r"></div>
        <script>\(js)</script><script>YardCheck.mount(\(data), document.getElementById("r"));</script></body></html>
        """
    }
    static func resource(_ name: String, _ ext: String) -> String {
        guard let url = Bundle.main.url(forResource: name, withExtension: ext), let s = try? String(contentsOf: url) else { return "" }
        return s
    }
}

struct ReportWebView: UIViewRepresentable {
    let html: String
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView {
        webView.scrollView.minimumZoomScale = 0.4
        webView.loadHTMLString(html, baseURL: nil)
        return webView
    }
    func updateUIView(_ uiView: WKWebView, context: Context) {
        if !html.isEmpty { uiView.loadHTMLString(html, baseURL: nil) }
    }
}

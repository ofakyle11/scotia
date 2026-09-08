import SwiftUI
import SwiftData

struct NewInspectionView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Query(sort: \Customer.name) private var customers: [Customer]

    @State private var customerName = ""
    @State private var unitNumber = ""
    @State private var plate = ""
    @State private var vin = ""
    @State private var odometer = ""
    @State private var technician = UserDefaults.standard.string(forKey: DefaultsKey.technicianName) ?? ""
    @State private var preset: AxlePreset = .tractor3Axle
    @State private var customAxles: [AxleSpec] = AxlePreset.custom.axles
    @State private var created: Inspection?

    private var positions: [TirePosition] {
        preset == .custom ? AxlePreset.positions(for: customAxles) : preset.positions
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Customer & vehicle") {
                    TextField("Customer / fleet", text: $customerName)
                        .textInputAutocapitalization(.words)
                    if !customerName.isEmpty {
                        let matches = customers.filter { $0.name.localizedCaseInsensitiveContains(customerName) && $0.name != customerName }.prefix(3)
                        ForEach(Array(matches)) { c in
                            Button(c.name) { customerName = c.name }.font(.callout)
                        }
                    }
                    TextField("Unit number", text: $unitNumber)
                    TextField("Plate", text: $plate).textInputAutocapitalization(.characters)
                    TextField("VIN", text: $vin).textInputAutocapitalization(.characters)
                    TextField("Odometer (km)", text: $odometer).keyboardType(.numberPad)
                }
                Section("Technician") {
                    TextField("Name", text: $technician).textInputAutocapitalization(.words)
                }
                Section("Axle configuration") {
                    Picker("Preset", selection: $preset) {
                        ForEach(AxlePreset.allCases) { Text($0.label).tag($0) }
                    }
                    if preset == .custom {
                        ForEach($customAxles) { $axle in
                            HStack {
                                Picker("Role", selection: $axle.role) {
                                    ForEach(AxleRole.allCases, id: \.self) { Text($0.label).tag($0) }
                                }.labelsHidden()
                                Toggle("Dual", isOn: $axle.dual)
                            }
                        }
                        .onDelete { customAxles.remove(atOffsets: $0) }
                        Button { customAxles.append(AxleSpec(dual: true, role: .drive)) } label: {
                            Label("Add axle", systemImage: "plus")
                        }
                    }
                    Text("\(positions.count) tire positions: \(positions.map(\.code).joined(separator: " "))")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("New inspection")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Start") { start() }.disabled(unitNumber.trimmingCharacters(in: .whitespaces).isEmpty || positions.isEmpty)
                }
            }
            .navigationDestination(item: $created) { inspection in
                InspectionReviewView(inspection: inspection, startInWalkMode: true)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            }
        }
    }

    private func start() {
        UserDefaults.standard.set(technician, forKey: DefaultsKey.technicianName)
        let name = customerName.trimmingCharacters(in: .whitespaces)
        var customer: Customer? = nil
        if !name.isEmpty {
            customer = customers.first { $0.name.caseInsensitiveCompare(name) == .orderedSame } ?? {
                let c = Customer(name: name); context.insert(c); return c
            }()
        }
        let vehicle = customer?.vehicles.first { $0.unitNumber.caseInsensitiveCompare(unitNumber) == .orderedSame }
            ?? Vehicle(unitNumber: unitNumber.trimmingCharacters(in: .whitespaces), plate: plate, vin: vin, customer: customer)
        if vehicle.modelContext == nil { context.insert(vehicle) }
        if !plate.isEmpty { vehicle.plate = plate }
        if !vin.isEmpty { vehicle.vin = vin }

        let inspection = Inspection(
            vehicle: vehicle,
            technician: technician,
            odometer: Int(odometer),
            preset: preset,
            positions: preset == .custom ? AxlePreset.positions(for: customAxles) : nil
        )
        context.insert(inspection)
        try? context.save()
        created = inspection
    }
}

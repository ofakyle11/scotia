import SwiftUI
import SwiftData

struct FleetPolicyListView: View {
    @Environment(\.modelContext) private var context
    @Query(sort: \Customer.name) private var customers: [Customer]
    @Query private var policies: [FleetPolicy]

    var body: some View {
        List {
            ForEach(customers) { c in
                NavigationLink(c.name) { FleetPolicyEditor(customerName: c.name) }
                    .badge(policies.contains { $0.customerName == c.name } ? "policy" : "shop default")
            }
            if customers.isEmpty { Text("Customers appear here after their first inspection.").foregroundStyle(.secondary) }
        }
        .navigationTitle("Fleet policies")
    }
}

struct FleetPolicyEditor: View {
    @Environment(\.modelContext) private var context
    let customerName: String
    @State private var policy: FleetPolicy?

    var body: some View {
        Form {
            if let policy {
                ForEach(AxleRole.allCases, id: \.self) { role in
                    Section(role.label) {
                        RoleRow(role: role, policy: policy)
                    }
                }
                Section {
                    Button("Remove policy (use shop thresholds)", role: .destructive) { context.delete(policy); try? context.save(); self.policy = nil }
                }
            } else {
                Text("Using shop thresholds.").foregroundStyle(.secondary)
                Button("Create fleet policy") { let p = FleetPolicy(customerName: customerName); context.insert(p); try? context.save(); policy = p }
            }
        }
        .navigationTitle(customerName)
        .onAppear { policy = FleetPolicy.find(customerName, in: context) }
        .onDisappear { try? context.save() }
    }
}

private struct RoleRow: View {
    let role: AxleRole
    @Bindable var policy: FleetPolicy

    var body: some View {
        let r = policy.role(role)
        Stepper("Pull point: \(r.pull)/32", value: Binding(get: { r.pull }, set: { var v = policy.role(role); v.pull = $0; policy.set(role, v) }), in: 1...12)
        HStack { Text("Rec. PSI"); Spacer(); TextField("—", value: Binding(get: { policy.role(role).recPSI }, set: { var v = policy.role(role); v.recPSI = $0; policy.set(role, v) }), format: .number).keyboardType(.numberPad).multilineTextAlignment(.trailing) }
        HStack { Text("Min. PSI"); Spacer(); TextField("—", value: Binding(get: { policy.role(role).minPSI }, set: { var v = policy.role(role); v.minPSI = $0; policy.set(role, v) }), format: .number).keyboardType(.numberPad).multilineTextAlignment(.trailing) }
        Toggle("Retreads allowed", isOn: Binding(get: { policy.role(role).retreads }, set: { var v = policy.role(role); v.retreads = $0; policy.set(role, v) }))
    }
}

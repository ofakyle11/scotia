// Fixture test for web/yardcheck.js: three vehicles with exactly known conditions.
// Run: node tools/yardcheck/test_renderer.js
const assert = require("assert");
const YC = require("../../web/yardcheck.js");

const policy = { steer: { pull: 5, recPsi: 100, minPsi: 80, retreads: false }, drive: { pull: 5, recPsi: 100, minPsi: 80, retreads: true },
                 trailer: { pull: 5, recPsi: 100, minPsi: 80, retreads: true }, tag: { pull: 5, recPsi: 100, minPsi: 80, retreads: true } };
const T = (axle, slot, min, extra = {}) => Object.assign({ axle, slot, inner: min, centre: min, outer: min }, extra);

const doc = {
  survey: { id: "165881", fleet: "GFL UTILITIES", location: "Clarington, Ontario", dates: ["2026-08-19"], reportedBy: "billy devries", participants: [], generated: "2026-08-20" },
  policy: { default: policy },
  vehicles: [
    // pick-up 2S-4D: one tire AT pull point (5), one NEAR (7 = pull+2), rest fine; one missing valve cap; psi measured on two tires
    { unit: "214053", type: "Pick-up", axles: [{ role: "steer", dual: false, size: "225/75R16" }, { role: "drive", dual: true, size: "225/75R16" }],
      tires: [T(1, 1, 5, { psi: 100 }), T(1, 2, 7, { psi: 70, valveCap: "missing" }), T(2, 1, 14), T(2, 2, 14), T(2, 3, 14), T(2, 4, 14)] },
    // tractor 2S-4D-4D: one mismatched dual on axle 2 slots 3/4 (12 vs 20), rest fine
    { unit: "215008", type: "Tractor - Class 8", axles: [{ role: "steer", dual: false, size: "11R22.5" }, { role: "drive", dual: true, size: "11R22.5" }, { role: "drive", dual: true, size: "11R22.5" }],
      tires: [T(1, 1, 20), T(1, 2, 20), T(2, 1, 26), T(2, 2, 26), T(2, 3, 12), T(2, 4, 20), T(3, 1, 26), T(3, 2, 26), T(3, 3, 26), T(3, 4, 26)], notes: "will need all 8 come end of september" },
    // trailer 4T-4T-4T, all fine, one tire unmeasured
    { unit: "R66938", type: "Trailer - Liquid Tank", axles: [{ role: "trailer", dual: true, size: "11R22.5" }, { role: "trailer", dual: true, size: "11R22.5" }, { role: "trailer", dual: true, size: "11R22.5" }],
      tires: [T(1, 1, 14), T(1, 2, 17), T(1, 3, 16), T(1, 4, 16), T(2, 1, 12), T(2, 2, 8), T(2, 3, 12), T(2, 4, 12), T(3, 1, 17), T(3, 2, 17), T(3, 3, 10), { axle: 3, slot: 4 }] },
  ],
};

const out = YC.compute(doc);
const s = out.stats;

// config codes and sizes
assert.strictEqual(out.vehicles[0].configCode, "2S-4D");
assert.strictEqual(out.vehicles[1].configCode, "2S-4D-4D");
assert.strictEqual(out.vehicles[2].configCode, "4T-4T-4T");
assert.strictEqual(out.vehicles[1].sizeLine, "All: 11R22.5");
assert.strictEqual(YC.sizeSummary([{ role: "steer", size: "425/65R22.5" }, { role: "drive", size: "11R22.5" }, { role: "drive", size: "11R22.5" }]), "1 - S : 425/65R22.5 , 2,3 - D : 11R22.5");
assert.strictEqual(YC.slotNumber({ side: "L", dual: true, inner: false }), 1);
assert.strictEqual(YC.slotNumber({ side: "R", dual: true, inner: true }), 3);
assert.strictEqual(YC.slotNumber({ side: "R", dual: false }), 2);

// counts
assert.strictEqual(s.tiresInspected, 28);
assert.strictEqual(s.vehiclesInspected, 3);
assert.strictEqual(s.immediateCount, 1, "one tire at pull point");
const near = out.vehicles[0].tires.find(t => t.slot === 2 && t.axle === 1);
assert.deepStrictEqual(near.warning, ["RTD Near Pull Point"]);
const mm = out.vehicles[1].tires.filter(t => t.warning.includes("Tread Depth Mismatch"));
assert.strictEqual(mm.length, 2, "both tires of the mismatched dual are flagged");
assert.strictEqual(s.conditionCounts["Tread Depth Mismatch"], 2);
assert.strictEqual(s.conditionCounts["RTD Near Pull Point"], 1);
assert.strictEqual(s.withConditions, 4);
assert.strictEqual(s.withoutConditions, 24);
assert.strictEqual(s.immediate, 1); assert.strictEqual(s.warning, 3); assert.strictEqual(s.both, 0);

// bands over measured tires (27 measured: 1 red, 1 orange, 25 green)
assert.deepStrictEqual(s.bands, { red: 1, orange: 1, green: 25 });

// duals: pick-up 2 pairs, tractor 4 pairs, trailer 6 pairs but one pair has an unmeasured tire -> 5 => 11
assert.strictEqual(s.dualPairs, 11);
assert.strictEqual(s.vehiclesWithDuals, 3);
assert.deepStrictEqual(s.mismatch, { none: 10, inflation: 0, tread: 1, both: 0 });

// inflation: two measured (100 -> within, 70 -> under20 vs rec 100), 26 not checked
assert.strictEqual(s.inflation.within, 1); assert.strictEqual(s.inflation.under20, 1); assert.strictEqual(s.inflation.notChecked, 26);
assert.strictEqual(YC.inflationBucket(119, 100), "within"); assert.strictEqual(YC.inflationBucket(120, 100), "over20");
assert.strictEqual(YC.inflationBucket(94, 100), "under5"); assert.strictEqual(YC.inflationBucket(89, 100), "under10");

// valves
assert.deepStrictEqual(s.valves, { missing: 1, replaced: 0, inaccessible: 0 });

// histogram: bin 5 has one red, bin 7 one orange, bin 26 has 7 green
assert.strictEqual(s.histAll[5].red, 1); assert.strictEqual(s.histAll[7].orange, 1); assert.strictEqual(s.histAll[26].green, 6);
assert.strictEqual(s.histByRole.steer.tires, 4); assert.strictEqual(s.histByRole.trailer.tires, 11); assert.strictEqual(s.histByRole.tag, undefined);

// policies: three groups, ordered by vehicle count then key
assert.strictEqual(s.policies.length, 3);
const tractorGroup = s.policies.find(g => g.title.startsWith("1 × 2S-4D-4D"));
assert.deepStrictEqual(tractorGroup.rows.map(r => [r.tires, r.type, r.pull]), [[2, "Steer", 5], [4, "Drive", 5], [4, "Drive", 5]]);
assert.deepStrictEqual(tractorGroup.vehicles, ["215008"]);

// render: page count and key strings from the reference
const html = YC.render(out);
const pages = (html.match(/class="yc-page/g) || []).length;
assert.ok(pages >= 9, "cover, surveys, summary, RTD, conditions, mismatch, policies, IA details, vehicles");
assert.ok(html.includes(`${pages}/${pages}`), "last page numbered n/n");
assert.ok(html.includes("<b>5</b> / 5"), "RTD cell 'depth / pull'");
assert.ok(html.includes("-- / 100"), "unmeasured PSI shown as -- / rec");
assert.ok(html.includes(">2-3<"), "axle-slot position label");
assert.ok(html.includes("RTD Near Pull Point"));
assert.ok(html.includes("will need all 8 come end of september"));
assert.ok(html.includes("(continued)") === false, "no vehicle needed continuation");
assert.ok(html.includes("Tires without Conditions"));
assert.ok(html.includes("86%") && html.includes("(24)"), "24 of 28 without conditions = 86%");
console.log(`renderer fixtures pass: ${pages} pages, ${s.tiresInspected} tires, ${s.withConditions} with conditions`);

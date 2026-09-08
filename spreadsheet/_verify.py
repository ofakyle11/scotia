#!/usr/bin/env python3
"""Scratch verification: add fake unit-42 rows to a COPY, then read Fleet Summary."""
import shutil, sys
from openpyxl import load_workbook

SRC = "tread_inspections_template.xlsx"
DST = "_scratch_verify.xlsx"

if sys.argv[1:] == ["seed"]:
    shutil.copy(SRC, DST)
    wb = load_workbook(DST)
    ws = wb["Inspections"]
    # older inspection for unit 42 (should be IGNORED by Fleet Summary)
    old = [
        ["INSP-000900", "2026-06-01T09:00:00", "M. Francis", "Acme Freight", 42, "AB12345",
         "1FUJGLDR8CLBP1234", 380000, "6x4", "LF", "Michelin", "XZE2+", "11R22.5", "3117",
         12, 11, 12, 11, 8.73, 105, "OK", "gauge", "", "older inspection", 0.5],
        ["INSP-000901", "2026-06-01T09:05:00", "M. Francis", "Acme Freight", 42, "AB12345",
         "1FUJGLDR8CLBP1234", 380000, "6x4", "L2O", "Michelin", "XDN2", "11R22.5", "3117",
         3, 3, 3, 3, 2.38, 100, "REPLACE", "gauge", "", "older inspection", 0.5],
    ]
    # latest inspection day 2026-09-08: example row (LF, WATCH, min 5) plus these
    new = [
        ["INSP-000002", "2026-09-08T14:36:00", "M. Francis", "Acme Freight", 42, "AB12345",
         "1FUJGLDR8CLBP1234", 412305, "6x4", "RF", "Michelin", "XZE2+", "11R22.5", "3117",
         9, 9, 10, 9, 7.14, 105, "OK", "gauge", "", "", 0.5],
        ["INSP-000003", "2026-09-08T14:40:00", "M. Francis", "Acme Freight", 42, "AB12345",
         "1FUJGLDR8CLBP1234", 412305, "6x4", "L2O", "Bridgestone", "M710", "11R22.5", "2617",
         2, 2, 3, 2, 1.59, 100, "REPLACE", "gauge", "", "", 0.5],
        ["INSP-000004", "2026-09-08T14:44:00", "M. Francis", "Acme Freight", 42, "AB12345",
         "1FUJGLDR8CLBP1234", 412305, "6x4", "L2I", "Bridgestone", "M710", "11R22.5", "2617",
         8, 7, 8, 7, 5.56, 100, "OK", "gauge", "", "", 0.5],
        ["INSP-000005", "2026-09-08T14:48:00", "M. Francis", "Acme Freight", 42, "AB12345",
         "1FUJGLDR8CLBP1234", 412305, "6x4", "LRO", "Bridgestone", "M710", "11R22.5", "2617",
         4, 3, 4, 3, 2.38, 100, "WATCH", "gauge", "", "", 0.5],
    ]
    r = 3
    for row in old + new:
        for j, v in enumerate(row, start=1):
            ws.cell(row=r, column=j, value=v)
        r += 1
    wb.save(DST)
    print("seeded", DST, "rows 2..", r - 1)
else:
    wb = load_workbook(DST, data_only=True)
    ws = wb["Fleet Summary"]
    hdr = [ws.cell(row=4, column=j).value for j in range(1, 12)]
    print(hdr)
    for r in (5, 6):
        print([ws.cell(row=r, column=j).value for j in range(1, 12)])

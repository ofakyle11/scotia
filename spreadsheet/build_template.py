#!/usr/bin/env python3
"""Build tread_inspections_template.xlsx for the Scotia Tire tread-depth inspection project.

Re-runnable: overwrites the output file each time.

    python3 build_template.py [output.xlsx]

After building, recalculate with LibreOffice so cached values exist:

    python3 <xlsx-skill>/scripts/recalc.py tread_inspections_template.xlsx 90
"""

import sys

from openpyxl import Workbook
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

# ---------------------------------------------------------------- styling ---
ARIAL = "Arial"
HEADER_FILL = PatternFill("solid", fgColor="1F3864")   # dark navy
INPUT_FILL = PatternFill("solid", fgColor="FFFF00")    # yellow = user input
RED_FILL = PatternFill("solid", fgColor="FFC7CE")
AMBER_FILL = PatternFill("solid", fgColor="FFEB9C")
GREEN_FILL = PatternFill("solid", fgColor="C6EFCE")
BAND_FILL = PatternFill("solid", fgColor="F2F2F2")

HEADER_FONT = Font(name=ARIAL, size=11, bold=True, color="FFFFFF")
BODY_FONT = Font(name=ARIAL, size=10)
INPUT_FONT = Font(name=ARIAL, size=10, color="0000FF")  # blue = hardcoded input
BOLD = Font(name=ARIAL, size=11, bold=True)
TITLE_FONT = Font(name=ARIAL, size=14, bold=True, color="1F3864")
NOTE_FONT = Font(name=ARIAL, size=9, italic=True, color="595959")

THIN = Side(style="thin", color="BFBFBF")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

# ------------------------------------------------------------- input data ---
COLUMNS = [
    "inspection_id", "date", "technician", "customer", "unit_number", "plate",
    "vin", "odometer", "axle_config", "position", "brand", "model", "size",
    "dot_code", "depth_inner_32nds", "depth_centre_32nds", "depth_outer_32nds",
    "depth_min_32nds", "depth_min_mm", "pressure_psi", "status", "method",
    "photo_url", "notes", "scan_confidence_32nds",
]

COL_WIDTHS = {
    "inspection_id": 16, "date": 20, "technician": 14, "customer": 18,
    "unit_number": 12, "plate": 10, "vin": 20, "odometer": 11,
    "axle_config": 12, "position": 9, "brand": 12, "model": 16, "size": 12,
    "dot_code": 13, "depth_inner_32nds": 16, "depth_centre_32nds": 17,
    "depth_outer_32nds": 16, "depth_min_32nds": 15, "depth_min_mm": 13,
    "pressure_psi": 12, "status": 10, "method": 9, "photo_url": 24,
    "notes": 44, "scan_confidence_32nds": 20,
}

EXAMPLE_ROW = [
    "INSP-000001", "2026-09-08T14:32:00", "M. Francis", "Acme Freight", 42,
    "AB12345", "1FUJGLDR8CLBP1234", 412_305, "6x4", "LF", "Michelin",
    "XZE2+", "11R22.5", "3117", 6, 5, 7, 5, 3.97, 105, "WATCH", "gauge",
    "https://example.com/photos/insp-000001.jpg",
    "EXAMPLE ROW - delete this row before entering real data.", 0.5,
]

# Inspections column letters (1-based order above)
C_DATE, C_CUST, C_UNIT, C_ODO = "B", "D", "E", "H"
C_POS, C_DMIN, C_STATUS = "J", "R", "U"

LAST_ROW = 500          # data range end on Inspections
FLEET_ROWS = 40         # unit rows on Fleet Summary


def rng(col):
    """Absolute Inspections range for one column, rows 2..LAST_ROW."""
    return f"Inspections!${col}$2:${col}${LAST_ROW}"


# ------------------------------------------------------------------ README --
def build_readme(ws):
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 118

    lines = [
        ("Scotia Tire - Truck Tire Tread Depth Inspection Template", "title"),
        ("", "body"),
        ("WHAT THIS FILE IS", "h"),
        ("A Google Sheets / Excel workbook for collecting truck tire tread-depth inspections captured by the "
         "Scotia Tire iPhone/web app, and for turning them into a per-unit fleet action list.", "body"),
        ("", "body"),
        ("HOW TO USE IT", "h"),
        ("1. Upload this .xlsx to Google Drive.", "body"),
        ("2. Right-click it in Drive and choose Open with > Google Sheets. Then File > Save as Google Sheets "
         "so formulas and formatting are kept in a live Sheet.", "body"),
        ("3. Open the Inspections tab and DELETE the yellow EXAMPLE row (row 2). It exists only to show the "
         "expected format.", "body"),
        ("4. Export the inspection CSV from the app, then in the Inspections tab choose "
         "File > Import > Upload > select the CSV > Import location: \"Append to current sheet\" > "
         "Separator type: Comma > Import data. The CSV columns are already in the same order as row 1.", "body"),
        ("5. On the Fleet Summary tab, type a unit number into each yellow cell in column A. Every other "
         "column fills in automatically from the Inspections data.", "body"),
        ("6. On the Thresholds tab, adjust the yellow legal-minimum cells only if the governing standard "
         "changes.", "body"),
        ("", "body"),
        ("CELL COLOUR LEGEND", "h"),
        ("Yellow fill with blue text = a cell YOU type into (unit numbers, thresholds).", "body"),
        ("White cells with black text = formulas or imported data. Do not overwrite them.", "body"),
        ("Dark navy row = column headers. Keep them exactly as-is or the CSV append will misalign.", "body"),
        ("", "body"),
        ("COLUMN MEANINGS (Inspections tab, one row per tire)", "h"),
        ("inspection_id - unique id issued by the app for this tire reading.", "body"),
        ("date - ISO 8601 timestamp of the reading, e.g. 2026-09-08T14:32:00.", "body"),
        ("technician - person who performed the inspection.", "body"),
        ("customer - fleet/customer name.", "body"),
        ("unit_number - the truck or trailer unit number. This is the key the Fleet Summary tab looks up.", "body"),
        ("plate / vin - vehicle plate and VIN.", "body"),
        ("odometer - odometer reading in km at time of inspection.", "body"),
        ("axle_config - axle configuration, e.g. 6x4.", "body"),
        ("position - TMC wheel position code: LF/RF are the steer tires; L2O, L2I, LRO, LRI etc. are the "
         "drive and trailer positions (O = outer, I = inner).", "body"),
        ("brand / model / size - tire make, model and size, e.g. Michelin XZE2+ 11R22.5.", "body"),
        ("dot_code - DOT week/year code from the sidewall.", "body"),
        ("depth_inner_32nds / depth_centre_32nds / depth_outer_32nds - the three tread measurements across "
         "the face of the tire, in 32nds of an inch.", "body"),
        ("depth_min_32nds - the shallowest of those three readings; this is what is compared against the "
         "legal minimum.", "body"),
        ("depth_min_mm - the same minimum expressed in millimetres (1/32 in = 0.79375 mm).", "body"),
        ("pressure_psi - cold inflation pressure.", "body"),
        ("status - OK, WATCH or REPLACE (see thresholds below).", "body"),
        ("method - how the depth was obtained: scan (app camera/depth scan), gauge (tread depth gauge) or "
         "manual (typed in).", "body"),
        ("photo_url - link to the captured tire photo.", "body"),
        ("notes - free text.", "body"),
        ("scan_confidence_32nds - the app's estimated measurement uncertainty, in 32nds. Higher means the "
         "scan is less certain; re-check with a gauge when it is large.", "body"),
        ("", "body"),
        ("THRESHOLDS AND STATUS", "h"),
        ("REPLACE - depth_min_32nds is at or below the legal minimum for that wheel position.", "body"),
        ("WATCH   - depth_min_32nds is above the legal minimum but within the watch band (2/32) of it.", "body"),
        ("OK      - everything else.", "body"),
        ("Legal minimum tread depth is 4/32 in on steer tires (positions LF and RF) and 2/32 in on all "
         "drive and trailer positions.", "body"),
        ("Source: Canada National Safety Code (NSC) Standard 11 - Periodic Motor Vehicle Inspection, tire "
         "tread depth requirements; and United States FMCSA 49 CFR 393.75(b)-(c). The editable values live "
         "on the Thresholds tab.", "body"),
        ("", "body"),
        ("REGENERATING THIS FILE", "h"),
        ("This workbook is generated by build_template.py in the same folder: run "
         "`python3 build_template.py`, then recalculate it with LibreOffice so cached formula values are "
         "stored. See README.md.", "body"),
        ("", "body"),
        ("RANGE LIMIT", "h"),
        (f"All Fleet Summary formulas read Inspections rows 2 to {LAST_ROW}. If you append more than "
         f"{LAST_ROW - 1} inspection rows, edit the formulas and extend {LAST_ROW} to a larger row number.", "body"),
    ]

    for i, (text, kind) in enumerate(lines, start=1):
        c = ws.cell(row=i, column=1, value=text)
        if kind == "title":
            c.font = TITLE_FONT
        elif kind == "h":
            c.font = BOLD
        else:
            c.font = Font(name=ARIAL, size=10)
        c.alignment = Alignment(wrap_text=True, vertical="top")
        ws.row_dimensions[i].height = None


# ------------------------------------------------------------- Inspections --
def build_inspections(ws):
    for j, name in enumerate(COLUMNS, start=1):
        c = ws.cell(row=1, column=j, value=name)
        c.font = HEADER_FONT
        c.fill = HEADER_FILL
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = BOX
        ws.column_dimensions[get_column_letter(j)].width = COL_WIDTHS[name]
    ws.row_dimensions[1].height = 30

    for j, val in enumerate(EXAMPLE_ROW, start=1):
        c = ws.cell(row=2, column=j, value=val)
        c.font = INPUT_FONT
        c.fill = INPUT_FILL
        c.border = BOX
        c.alignment = Alignment(vertical="center")
    ws.cell(row=2, column=19).number_format = "0.00"   # depth_min_mm
    ws.cell(row=2, column=25).number_format = "0.0"    # scan_confidence

    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(COLUMNS))}{LAST_ROW}"

    status_rng = f"$U$2:$U${LAST_ROW}"
    ws.conditional_formatting.add(status_rng, CellIsRule(
        operator="equal", formula=['"REPLACE"'], fill=RED_FILL,
        font=Font(name=ARIAL, size=10, bold=True, color="9C0006")))
    ws.conditional_formatting.add(status_rng, CellIsRule(
        operator="equal", formula=['"WATCH"'], fill=AMBER_FILL,
        font=Font(name=ARIAL, size=10, bold=True, color="9C6500")))
    ws.conditional_formatting.add(status_rng, CellIsRule(
        operator="equal", formula=['"OK"'], fill=GREEN_FILL,
        font=Font(name=ARIAL, size=10, color="006100")))

    dv_status = DataValidation(type="list", formula1='"OK,WATCH,REPLACE"', allow_blank=True)
    dv_method = DataValidation(type="list", formula1='"scan,gauge,manual"', allow_blank=True)
    ws.add_data_validation(dv_status)
    ws.add_data_validation(dv_method)
    dv_status.add(f"U3:U{LAST_ROW}")
    dv_method.add(f"V3:V{LAST_ROW}")


# -------------------------------------------------------------- Thresholds --
def build_thresholds(ws):
    ws.sheet_view.showGridLines = False
    ws["A1"] = "Tread Depth Thresholds (editable inputs)"
    ws["A1"].font = TITLE_FONT

    headers = ["Setting", "Value (32nds)", "Note"]
    for j, h in enumerate(headers, start=1):
        c = ws.cell(row=3, column=j, value=h)
        c.font = HEADER_FONT
        c.fill = HEADER_FILL
        c.border = BOX
        c.alignment = Alignment(horizontal="center", vertical="center")

    rows = [
        ("Steer tire legal minimum", 4,
         "Minimum legal tread depth for steer-axle tires (TMC positions LF and RF). "
         "At or below this value the tire is out of service. Source: Canada NSC Standard 11; "
         "US FMCSA 49 CFR 393.75(b) (4/32 in on steering axle tires)."),
        ("Drive / trailer legal minimum", 2,
         "Minimum legal tread depth for all non-steer positions (drive and trailer axles, e.g. L2O, "
         "L2I, LRO, LRI). Source: Canada NSC Standard 11; US FMCSA 49 CFR 393.75(c) (2/32 in on all "
         "other tires)."),
        ("Watch band above minimum", 2,
         "A tire whose depth_min_32nds is above the legal minimum but within this many 32nds of it is "
         "flagged WATCH, so it can be scheduled before it becomes a REPLACE."),
    ]
    for i, (label, value, note) in enumerate(rows, start=4):
        a = ws.cell(row=i, column=1, value=label)
        a.font = BODY_FONT
        a.border = BOX
        b = ws.cell(row=i, column=2, value=value)
        b.font = Font(name=ARIAL, size=10, bold=True, color="0000FF")
        b.fill = INPUT_FILL
        b.border = BOX
        b.alignment = Alignment(horizontal="center")
        n = ws.cell(row=i, column=3, value=note)
        n.font = BODY_FONT
        n.alignment = Alignment(wrap_text=True, vertical="top")
        n.border = BOX
        ws.row_dimensions[i].height = 46

    ws.column_dimensions["A"].width = 32
    ws.column_dimensions["B"].width = 15
    ws.column_dimensions["C"].width = 92

    ws["A9"] = ("Yellow cells with blue text are inputs - edit these. Depths are in 32nds of an inch "
                "(1/32 in = 0.79375 mm). status in the Inspections tab is set by the app using these rules: "
                "REPLACE at or below the minimum, WATCH within the watch band above it, otherwise OK.")
    ws["A9"].font = NOTE_FONT
    ws["A9"].alignment = Alignment(wrap_text=True, vertical="top")
    ws.merge_cells("A9:C10")


# ----------------------------------------------------------- Fleet Summary --
def build_fleet(ws):
    ws.sheet_view.showGridLines = False
    ws["A1"] = "Fleet Summary - latest inspection per unit"
    ws["A1"].font = TITLE_FONT
    ws["A2"] = ("Type a unit number into each yellow cell in column A. Every other column is a formula "
                "reading the Inspections tab; all counts use ONLY that unit's most recent inspection date.")
    ws["A2"].font = NOTE_FONT
    ws["A2"].alignment = Alignment(wrap_text=True, vertical="top")
    ws.merge_cells("A2:K2")
    ws.row_dimensions[2].height = 26

    headers = [
        ("Unit #", 12), ("Customer", 20), ("Last inspection date", 20),
        ("Last odometer", 15), ("Tires inspected", 15), ("REPLACE", 11),
        ("WATCH", 11), ("OK", 9), ("Lowest tread (32nds)", 20),
        ("Position of lowest", 18), ("Action", 42),
    ]
    hrow = 4
    for j, (h, w) in enumerate(headers, start=1):
        c = ws.cell(row=hrow, column=j, value=h)
        c.font = HEADER_FONT
        c.fill = HEADER_FILL
        c.border = BOX
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        ws.column_dimensions[get_column_letter(j)].width = w
    ws.row_dimensions[hrow].height = 32

    R_UNIT, R_DATE = rng(C_UNIT), rng(C_DATE)
    R_CUST, R_ODO = rng(C_CUST), rng(C_ODO)
    R_POS, R_DMIN, R_STAT = rng(C_POS), rng(C_DMIN), rng(C_STATUS)

    first, last = hrow + 1, hrow + FLEET_ROWS
    for r in range(first, last + 1):
        u = f"$A{r}"
        # any rows at all for this unit?
        has = f"COUNTIFS({R_UNIT},{u})"
        # latest inspection DAY as text yyyy-mm-dd (ISO text -> serial -> text)
        maxday = (f"SUMPRODUCT(MAX(({R_UNIT}={u})*IFERROR(DATEVALUE(LEFT({R_DATE},10)),0)))")
        day = f"$C{r}"                      # the yyyy-mm-dd text produced in column C
        daykey = f"({day}&\"*\")"           # wildcard match on that day within the ISO timestamp
        # last row index (1-based within the range) belonging to that unit on that day
        rowpos = (f"SUMPRODUCT(MAX(({R_UNIT}={u})*(LEFT({R_DATE},10)={day})"
                  f"*(ROW({R_DATE})-1)))")

        cells = {
            1: None,  # input
            2: f'=IF($A{r}="","",IFERROR(INDEX({R_CUST},{rowpos}),""))',
            3: f'=IF($A{r}="","",IF({has}=0,"",IFERROR(TEXT({maxday},"YYYY-MM-DD"),"")))',
            4: f'=IF($C{r}="","",IFERROR(INDEX({R_ODO},{rowpos}),""))',
            5: f'=IF($C{r}="","",COUNTIFS({R_UNIT},{u},{R_DATE},{daykey}))',
            6: f'=IF($C{r}="","",COUNTIFS({R_UNIT},{u},{R_DATE},{daykey},{R_STAT},"REPLACE"))',
            7: f'=IF($C{r}="","",COUNTIFS({R_UNIT},{u},{R_DATE},{daykey},{R_STAT},"WATCH"))',
            8: f'=IF($C{r}="","",COUNTIFS({R_UNIT},{u},{R_DATE},{daykey},{R_STAT},"OK"))',
            9: (f'=IF($C{r}="","",IFERROR(_xlfn.MINIFS({R_DMIN},{R_UNIT},{u},'
                f'{R_DATE},{daykey}),""))'),
            10: (f'=IF($I{r}="","",IFERROR(INDEX({R_POS},SUMPRODUCT(MAX(({R_UNIT}={u})'
                 f'*(LEFT({R_DATE},10)={day})*({R_DMIN}=$I{r})*(ROW({R_DATE})-1)))),""))'),
            11: (f'=IF($C{r}="","",IF($F{r}>0,"Replace "&$F{r}&" tire(s) now",'
                 f'IF($G{r}>0,"Schedule: "&$G{r}&" tire(s) near minimum","OK")))'),
        }
        for j in range(1, 12):
            c = ws.cell(row=r, column=j)
            c.border = BOX
            if j == 1:
                c.font = INPUT_FONT
                c.fill = INPUT_FILL
                c.alignment = Alignment(horizontal="center")
            else:
                c.value = cells[j]
                c.font = BODY_FONT
                if j in (4,):
                    c.number_format = "#,##0"
                if j in (5, 6, 7, 8, 9):
                    c.alignment = Alignment(horizontal="center")
                if j == 3:
                    c.alignment = Alignment(horizontal="center")
                if j == 10:
                    c.alignment = Alignment(horizontal="center")

    # example unit so the sheet shows something out of the box
    ws.cell(row=first, column=1, value=42)

    ws.freeze_panes = f"A{first}"

    ws.conditional_formatting.add(f"$F${first}:$F${last}", CellIsRule(
        operator="greaterThan", formula=["0"], fill=RED_FILL,
        font=Font(name=ARIAL, size=10, bold=True, color="9C0006")))
    ws.conditional_formatting.add(f"$G${first}:$G${last}", CellIsRule(
        operator="greaterThan", formula=["0"], fill=AMBER_FILL,
        font=Font(name=ARIAL, size=10, bold=True, color="9C6500")))

    foot = last + 2
    ws.cell(row=foot, column=1, value=(
        f"Footnote: all formulas on this tab read Inspections rows 2 to {LAST_ROW}. If you append more "
        f"than {LAST_ROW - 1} inspection rows, edit these formulas and extend {LAST_ROW} to a larger row "
        f"number, otherwise the extra rows are ignored. Counts, lowest tread and position all use only "
        f"the unit's most recent inspection date. Legal minimums (Thresholds tab): 4/32 steer, 2/32 "
        f"drive and trailer - Canada NSC Standard 11 / US FMCSA 49 CFR 393.75."))
    ws.cell(row=foot, column=1).font = NOTE_FONT
    ws.cell(row=foot, column=1).alignment = Alignment(wrap_text=True, vertical="top")
    ws.merge_cells(start_row=foot, start_column=1, end_row=foot + 2, end_column=11)


# -------------------------------------------------------------------- main --
def main(out="tread_inspections_template.xlsx"):
    wb = Workbook()
    readme = wb.active
    readme.title = "README"
    build_readme(readme)
    build_inspections(wb.create_sheet("Inspections"))
    build_thresholds(wb.create_sheet("Thresholds"))
    build_fleet(wb.create_sheet("Fleet Summary"))

    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for c in row:
                if c.font and c.font.name != ARIAL:
                    c.font = Font(name=ARIAL, size=c.font.size or 10, bold=c.font.bold,
                                  italic=c.font.italic, color=c.font.color)
    wb.save(out)
    print(f"wrote {out}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "tread_inspections_template.xlsx")

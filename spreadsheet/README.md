# Scotia Tire — tread depth inspection spreadsheet template

`tread_inspections_template.xlsx` is the workbook that receives the per-tire CSV
exported by the Scotia Tire iPhone/web inspection app and turns it into a
per-unit fleet action list.

## Tabs

| Tab | What it is |
|---|---|
| `README` | In-workbook instructions, column meanings, colour legend, threshold source. |
| `Inspections` | The 25 CSV columns in row 1, in export order. One yellow EXAMPLE row to delete. Frozen header, autofilter, conditional colour on `status`. |
| `Thresholds` | Editable legal minimums (4/32 steer, 2/32 drive & trailer) and the 2/32 watch band, each with an explanatory note. |
| `Fleet Summary` | One row per unit. You type a unit number in the yellow column A cell; every other column is a formula reading `Inspections` rows 2–500, scoped to that unit's most recent inspection date. |

## Google Sheets import steps

1. Upload `tread_inspections_template.xlsx` to Google Drive.
2. Right-click it → **Open with → Google Sheets**, then **File → Save as Google Sheets**.
3. On the **Inspections** tab, delete the yellow EXAMPLE row (row 2).
4. With the **Inspections** tab active: **File → Import → Upload**, pick the CSV,
   set **Import location** to **Append to current sheet**, **Separator type** to
   **Comma**, then **Import data**. The CSV column order already matches row 1.
5. On **Fleet Summary**, type unit numbers into the yellow cells in column A.
6. If you ever append more than 499 inspection rows, edit the Fleet Summary
   formulas and extend the `500` row references.

## Regenerating

```bash
pip install openpyxl
python3 build_template.py                     # writes tread_inspections_template.xlsx
python3 <xlsx-skill>/scripts/recalc.py tread_inspections_template.xlsx 300
```

The recalc step is required: openpyxl writes formulas with no cached values, so
LibreOffice must evaluate them before the file is uploaded. It must report
`"status": "success"` with `"total_errors": 0`.

All formulas deliberately avoid `XLOOKUP`/`FILTER`/`SORT`/`UNIQUE`/`SEQUENCE`
(LibreOffice cannot evaluate them here) and write `MINIFS` as `_xlfn.MINIFS`.

## Thresholds source

Legal minimum tread depth: **4/32 in** on steer tires (TMC positions LF and RF),
**2/32 in** on all drive and trailer positions.
Canada National Safety Code (NSC) Standard 11 — Periodic Motor Vehicle
Inspection; United States FMCSA 49 CFR 393.75(b)–(c).

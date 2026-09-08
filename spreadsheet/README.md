# Inspection workbook

`tread_inspections_template.xlsx` — upload to Google Drive, then **File → Save as
Google Sheets**. Four tabs:

| Tab | What it is |
|---|---|
| **Inspections** | One row per tire. The 25 columns match the app's CSV export exactly. |
| **Fleet Summary** | Type unit numbers into the yellow column. Everything else calculates: latest inspection, tires replaced/watched/OK, lowest tread and where it is, and a plain-English action. |
| **Thresholds** | The legal minimums the status column reflects. Documentation, and inputs if you change them. |
| **README** | The same instructions, inside the workbook. |

## Adding an inspection

1. In the app, finish the inspection and choose **Share / download CSV**.
2. In Google Sheets, click the **Inspections** tab, then **File → Import → Upload**.
3. Choose **Append to current sheet** and **Comma**.

Columns line up every time, so this works for every inspection from either app.

`sample_inspection.csv` is a real 10-row tractor inspection you can import right
now to see the summary populate before any real data exists. It uses unit 42,
which is the unit already filled in on Fleet Summary.

## How Fleet Summary decides what is "latest"

`inspection_id` is `yyyymmdd-hhmm-XXXX`, so the highest one is the most recent.
The formulas turn that into a sortable number and count only the rows carrying
that id. If a unit is inspected twice in the same minute, only the later
reference is used.

## Formula choices

The workbook is built for Google Sheets, so it uses only functions Sheets
understands. `MAXIFS` and `MINIFS` are deliberately avoided: openpyxl has to
write them as `_xlfn.MAXIFS`, which Google Sheets does not recognise.
`SUMPRODUCT` does the same job everywhere. The lowest tread is found with a
`99 − depth` inversion rather than a conditional minimum, and row lookups use
`SUMPRODUCT(MAX(condition × ROW()))`, which needs no array entry in any of Excel,
LibreOffice or Google Sheets.

## What was and was not verified

`verify_template.py` checks, and passes: every formula points at the column its
header says it does, no function that Google Sheets rejects appears anywhere,
the structure is right, and the summary logic reproduces hand-computed answers
on a worked two-inspection example.

**The formulas have not been executed.** LibreOffice cannot load xlsx files in
the build container, so the usual recalculation step could not run. When you
first open the workbook, check the Fleet Summary row for unit 42 after importing
`sample_inspection.csv`: it should read 10 tires, 2 replace, 1 watch, 7 OK, lowest tread 2/32 at LRO. If it does, every formula on the tab is working.

## Rebuilding

```bash
pip install openpyxl
python3 build_template.py     # writes the xlsx
python3 verify_template.py    # checks it
```

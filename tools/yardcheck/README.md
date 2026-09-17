# yardcheck – fleet report from CSV exports

Turns the CSVs the apps export into a **Yard Check** report laid out like the
Bridgestone one: cover, management summary, remaining tread depth by axle
type, tire conditions, dual mismatches, maintenance policies, immediate
action details, and a page per vehicle with the numbered axle diagram.

```bash
python3 yardcheck.py build export1.csv export2.csv -o GFL_2026-09-17.html
python3 yardcheck.py build *.csv --policy policy.example.json --logo logo.png --pdf
python3 yardcheck.py doc   *.csv -o survey.json        # just the document the renderer consumes
```

Open the `.html` in any browser and print to PDF (Letter, no margins). With
Playwright installed, `--pdf` writes the PDF directly.

Rows are grouped by `survey_id`; older 25-column exports without it are
grouped by customer and date. Pull points and PSI come from the export's
policy columns when present, else `--policy`, else 4/32 steer and 2/32
others. The report is rendered by `web/yardcheck.js`, the same code the
phone uses, so the numbers agree with the app screen by construction.

Rules reproduced from the reference: at or below the pull point is an
immediate action; within 2/32 above it is "RTD Near Pull Point"; duals
differing by more than 4/32 are a tread depth mismatch and by more than 10%
pressure an inflation mismatch; positions are numbered axle-slot left to
right (singles 1, 2; duals 1 LO, 2 LI, 3 RI, 4 RO); configurations read
`2S-4D-4D`. Tests: `python3 -m pytest -q test_yardcheck.py` and
`node test_renderer.js`.

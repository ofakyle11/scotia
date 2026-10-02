# Field test: the first ten minutes

One phone, a dial gauge, a handful of quarters, ten minutes. At the end you will know one of
three things: ship the scanner to the two-week Verify trial, tune it, or stop trying to measure
tread with LiDAR and keep it as a sorting tool.

Nothing in this document has ever touched a phone. Every number the app has produced so far was
synthetic. Treat whatever the screen says during this test as a rumour until the PC confirms it.
If a step here does not match what you see, the step is wrong, not you: write down what happened.

## 1. Before you start

**You need**

- The iPhone, charged, in its case, and the USB cable.
- A roll of quarters. You will stack up to 24. A quarter is 1.58 mm thick, which is 2/32 inch
  to half a percent, so one, two and three quarters high are 2/32, 4/32 and 6/32 exactly enough.
  Do not use nickels (1.76 mm, which is 2.2/32).
- Masking tape.
- A flat, matte, dark board about the size of a sheet of paper: a black rubber floor mat laid on a
  bench, or a piece of plywood painted flat black. Not glossy, not metal, not a bare pale board.
- The dial tread gauge, reading in 32nds.
- A pen and a sheet of paper. You will write down about fifteen numbers.
- The repo unzipped on the Windows PC at `C:\scotia` (GitHub, green **Code** button,
  **Download ZIP**), Python 3 installed with "Add python.exe to PATH" ticked, and in a terminal
  `pip install numpy` run once.

**Install the app** following `SIDELOAD.md` in this folder. Do not skip step 4 (Developer Mode
and Trust) or the app will not open.

**First launch.** Open Tread Scanner, tap **+**, type any unit number, pick **Tractor (3 axle)**,
tap **Start**, then tap the scope icon beside the LF Centre groove. The phone asks whether Tread
Scanner may use the camera: tap **Allow**. If you tap Don't Allow by mistake, the scan screen
shows an orange message "Camera access is off for Tread Scanner" and an **Open Settings**
button; use it, turn the camera on, come back. Tap Cancel to leave the scan screen.

**Find the Build number.** Menu (the circled dots, top left) → **Settings** → scroll to
**Scanner**. Write down the **Build** line, for example `0.1.0 (12) 00b616e`. It must match the
file name you installed. The same line is stored inside every capture you record today.
Also check **LiDAR** says **Available** on that screen; if it says "Not on this device", stop.

## 2. Test 1: the bald plate (2 minutes)

A flat surface has no groove. The scanner must refuse to give a number. If it gives one, it is
inventing depth out of noise and nothing else today can be trusted.

1. Put the bare board flat on the bench in shade. Nothing on it.
2. Menu → **Verify scanner vs gauge**. Tap **Scan**.
3. Hold the phone square over the board so the **Distance** box reads **20 to 22 cm** and the
   dashed box is full of board. Hold still.
4. What the screen should show: the box turns green, the hint says **Hold…**, the **Tilt**
   number reads **0° to 2°**, and then nothing more happens. The ring around the box stays
   empty, no number appears, and Accept stays greyed out. Hold for ten seconds, then Cancel.
5. Write down the Tilt number.

If the ring fills and a number appears (anything, even "1/32"), the scanner is lying. Stop the
test. Record one capture of the plate: menu → **Record raw LiDAR capture**, label `BALD`,
gauge `0`, tap Record and hold still at 20 cm until it finishes. Then skip to section 5 and send
that file. Do the same capture even if the plate refused correctly, so the PC can confirm it.

If Tilt reads **5° or more** while the phone is plainly square to a plainly flat board, the
depth maths has the wrong convention. Record the `BALD` capture anyway, and send it with a note.
Keep going with the rest; the board result will still tell us something.

If the box never turns green: the hint tells you why. **Move back** / **Move closer** is
distance (the gate is 20 to 30 cm). **Hold the phone flat to the tire** is tilt over 10°.
**Clean, dry tread reads best** means the sensor lost confidence in the surface: try a darker,
less shiny board.

## 3. Test 2: the quarter board (5 minutes)

The scanner measures *down* from the biggest flat surface it sees, so the quarters must be the
surface and the gap between them the groove. A coin lying on a board is a bump; the scanner
ignores bumps and would report nothing. Build a valley, not a hill.

**Build it.** On the board, lay **two rows of four quarters**, each row a straight line of coins
touching edge to edge, the two rows parallel with a **10 to 12 mm gap** between them (about the
width of your little finger; a 1/2 inch bolt makes a good spacer, then remove it). Tape a short
strip across each end of each row so the coins cannot slide. Do not tape over the middle. That is
one quarter high: the gap is a 2/32 groove, 12 mm wide, 95 mm long.

**Scan it live.** Menu → **Verify scanner vs gauge**. Label `BOARD_1Q`. Tap **Scan**. Turn the
phone so the gap runs up and down the screen, centre the gap in the box, Distance **20 to 22 cm**,
hold still. The ring fills in about two seconds and a number appears, with a ± under it.
White number: confident. Orange number and "Noisy reading": not. Write down the number, the ±,
and the colour. Type `2` in Gauge, tap **Save pair**. Do that **three times at 20 cm** and
**three times at 25 cm**, lowering the phone and re-aiming between each one. Six numbers.

**Record it.** Menu → **Record raw LiDAR capture**. Label exactly `BOARD_1Q`, gauge `2.0`,
tap **Record 150 frames (~5 s)**. Start at about 10 cm from the coins and move straight back to
about 40 cm over the five seconds (6 cm a second, slower than feels natural), phone flat to the
board. Every frame is kept, green or not, so do not chase the green. Tap Accept when it finishes.

**Then two high, then three high.** Put a second quarter under every coin (16 quarters), check
the gap is still 10 to 12 mm, repeat the six live scans and the capture with label `BOARD_2Q`,
gauge `4.0`. Then a third quarter under every coin (24), label `BOARD_3Q`, gauge `6.0`.

Labels matter: the PC groups files by them. Letters, digits and underscores only; the app turns
anything else into an underscore. Each file is named with the time and your label, for example
`20261002-143012_BOARD_2Q.treadcap`.

If the Quality box stays under 50% and the hint says **Clean, dry tread reads best** over the
coins, the shiny metal is the problem: lay one strip of masking tape along the top of each row
(it adds about 0.1 mm, under 0.15/32) and write "taped" on your sheet.

## 4. Test 3: one real tire (3 minutes)

Pick a steer tire's centre groove, in shade, dry, with the loose grit wiped out but not scrubbed.
A deep new tire is fine; what matters today is agreement with the gauge, not the pull point.

1. Mark a 5 cm length of the groove with chalk or a paint marker.
2. Gauge it **three times** along the mark, on the groove floor, not on a stone ejector or tie
   bar. Write down all three and their average, to the nearest half 32nd. Three readings are
   needed because the gauge itself scatters by about half a 32nd between spots.
3. Menu → **Verify scanner vs gauge**, label `TIRE_LF_C`. Scan the mark three times at 20 to
   22 cm, lowering the phone and re-aiming each time, saving each pair with the gauge average.
   Write down the three numbers and their ± bands.
4. Menu → **Record raw LiDAR capture**, label `TIRE_LF_C` (add the unit number if you like,
   `TIRE_U42_LF_C`), gauge = the average. Record, sweeping 10 cm out to 40 cm over the five
   seconds as before, phone flat to the tread.
5. On your sheet: which way the sun was (behind you, in front, overcast), wet or dry, and the
   tire position.

## 5. Getting the files to the PC

Each capture is about 45 MB. Email will not carry them.

**By cable (Windows).** Plug the phone in. Open **iTunes** (the web version Sideloadly made you
install; the Apple Devices app works the same way if you have it instead). Click the phone icon,
then **File Sharing** in the left column, then **Tread Scanner**. Select all the `.treadcap`
files, click **Save**, and save them into `C:\scotia\captures`.

**Without a cable.** On the phone, open **Files → On My iPhone → Tread Scanner → Captures**,
select all, share to Google Drive or OneDrive, then download them on the PC into
`C:\scotia\captures`.

Open a terminal (search for "cmd" or "PowerShell"), then:

```
cd C:\scotia
python3 tools/treadlab/treadlab.py info captures/*.treadcap
python3 tools/treadlab/treadlab.py pose captures/*.treadcap
python3 tools/treadlab/treadlab.py report captures/*.treadcap --csv captures/day1.csv
```

If Windows says `python3` is not recognised, type `py` in its place. The `*.treadcap` wildcard
works on Windows; the tool expands it itself.

**What `info` prints**, one block per file (these lines came from a synthetic capture; yours
will say your phone's name and iOS version in place of `synthetic` and `None`):

```
BOARD_2Q.treadcap: label='BOARD_2Q' gauge=4.0 frames=150 4.97 s @ 30.0 fps distance 10.0-32.0 cm distinct=150 (30.2 Hz new depth) depth=256x192 smoothed=True source=arkit device=synthetic iOS None
   map: nan 0.0 zero 0.0 step 0.0 mm float16=False noise lag1 0.4975 / lag8 0.4974 mm ratio 1.0 -> per-pixel
```

- `frames=150 4.97 s` and `distance 10.0-32.0 cm`: how long it really recorded and how far
  you swept. If every file stops short of 30 cm, the sweeps were too slow; it still counts.
- `distinct=150 (30.2 Hz new depth)`: how many of the frames carried a genuinely new depth
  map. A real phone may show far fewer than 150; that is a finding, not a fault.
- The last word is the one that matters: **per-pixel** means neighbouring points carry
  independent measurements; **mixed** is in between; **interpolated** means the map was
  stretched from a sparse grid of laser dots and the groove floor is partly guessed from the
  colour image. Write that word down for each file.

**What `pose` prints**: a table per file, one row per 2 cm of holding distance, then a verdict.

```
    dist cm  frames  usable  in gate  depth/32     sd     err   tilt   conf
      20-22      14      14       14      3.92   0.04   -0.08    2.0   0.95
      24-26      14      14       14      3.85   0.04   -0.15    2.0   0.95
   PASS: at 10-12 cm the phone read 3.99/32 against the gauge's 4/32 (off by -0.01/32, 14 frames, spread ±0.03).
   Bands within ±1/32 of the gauge: 10-12 cm, 12-14 cm, ... 30-32 cm. That is the working range; ...
```

- `usable` is how many frames at that distance produced a reading at all; `depth/32` is the
  average reading there, `err` is how far from the gauge you typed. A row with under 5 usable
  frames is ignored by the verdict. Find the **20-22** row for each file: that is the number
  the acceptance table below is about.
- **PASS** names the distance that read closest and lists every band within ±1/32.
  **FAIL** means no distance read within ±1/32 of the gauge. **NOT ENOUGH DATA** means it
  could not see a groove floor at any distance. On the bald plate NOT ENOUGH DATA is the
  right answer and the line reads `NOT ENOUGH DATA: 0 of 150 frames produced a groove reading`.

**What `report` prints**: one line per file and a summary, using only the frames inside the
20 to 30 cm gate (what a live scan would have averaged):

```
model=quadratic roi=0.35 smooth=1 inlier=0.6  n=4  bias -0.05/32  RMSE 0.08/32  within ±1/32: 100%  threshold disagreements: 0  skipped: 1
   BOARD_1Q.treadcap BOARD_1Q 2.0 1.87 0.04 -0.13 122 synthetic
   TIRE_U42_LF_C.treadcap TIRE_U42_LF_C 7.0 7.0 0.03 0.0 122 synthetic
```

The columns are file, label, gauge, scan, ±, error, frames used, phone. `skipped: 1` with the
warning `BALD.treadcap: skipped, no usable frames (0/150)` above it is the plate being refused
correctly. Ignore any row whose frames column is under 30: two lucky frames can give a tight ±
and a wrong number.

## 6. Reading the result

Use the `pose` 20-22 cm row for the board files and the gauge average for the tire.

| Verdict | When | Then |
|---|---|---|
| **SHIP IT** | `BOARD_1Q` reads **2.0 ± 0.5** at 20-22 cm with 5 or more usable frames, and `BOARD_2Q` and `BOARD_3Q` read 4 and 6 within ±0.5; **and** the bald plate gave no number on screen and `NOT ENOUGH DATA` on the PC; **and** the tire's 20-22 cm row is within **±1/32** of the gauge average. | Start the two-week Verify trial in the app (same Verify screen, 20 more grooves). Not invoices yet. Send the files anyway. |
| **TUNE IT** | The board passes as above but the tire misses by more than 1/32, or reads nothing. The sensor can see a quarter-height step on a plate but not on black rubber. | Send the captures. The distance gate, the box size or the confidence rule gets adjusted on the PC against your files and a new build goes up. Also TUNE, not abandon, if the one-quarter board reads 1.3 to 1.6 with a small ± while two and three quarters read right: that is a known bias in the maths at the shallow end, and it is fixable. |
| **ABANDON LIDAR FOR MEASURING** | The one-quarter board gives no reading at any distance (`NOT ENOUGH DATA`) or the ring never fills on it, or the two-quarter board reads around **2.5 instead of 4**; `info` saying **interpolated** on those files is the reason why. The sensor cannot see 2/32 on a clean flat board in shade, so it will never see it on a tire, and no tuning changes physics. | The honest product is what already exists: scan to sort tires into "fine" and "check with the gauge", and the gauge for the number on the record. Send the files so the write-up is on evidence, not opinion. |

Two more things to look at whatever the verdict:

- The live scan numbers you wrote down against the capture numbers. If three re-aimed scans
  of the same thing spread by more than twice the ± they showed, the ± is reporting how still
  your hand was, not how right the number is. Say so.
- The bald plate. Any number from it, however small, overrides a SHIP verdict.

## 7. Day two: three phones (only if day one was SHIP or TUNE)

Same board, same marked groove, same gauge average from day one. For each phone, in turn:

1. Install the same build (note each phone's Build line; they must match).
2. Bald plate: `BALD`, gauge 0, held still at 20 cm. Then `BOARD_1Q` and `BOARD_2Q` captures,
   sweeping 10 to 40 cm. Then the tire capture `TIRE_LF_C`. One live Verify scan of the
   one-quarter board at 20 cm, number written down.
3. Copy each phone's files into their own folder: `C:\scotia\captures\phoneA`, `phoneB`,
   `phoneC`.

Then `python3 tools/treadlab/treadlab.py report captures/*/*.treadcap --csv captures/day2.csv`.
Because the files came from different phones, the summary ends with a **by phone** block, one
line per hardware name with its own bias and RMSE. Phones within half a 32nd of each other share
one set of settings. A phone more than 1/32 away from the others, or one that fails the
one-quarter board when the others pass, gets its own line in the write-up and possibly its own
settings. Run `pose` on the three `BOARD_1Q` files too: if the best distance moves between
phones, the distance gate needs to be per phone.

## 8. What to send me

- Every `.treadcap` file, in the folders above (a cloud-drive link is easiest; it is about
  half a gigabyte for day one).
- The `day1.csv` (and `day2.csv`).
- The Build line from Settings → Scanner, and which iPhone model each folder came from.
- Your sheet: the Tilt on the bald plate, the six live board numbers per height with their ±
  and colour, the three gauge readings and the three live scans on the tire, sun direction,
  wet or dry, and whether you taped the coins.
- A photo of the quarter board from above, and one of the marked groove.
- Anything that did not go the way this document said it would.

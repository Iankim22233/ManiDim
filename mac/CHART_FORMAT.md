# ManiDim chart format (`.mdc`)

A compact, hand-writable text format. A `.madim` file is a renamed zip containing the audio and one `.mdc` chart
(older packages that contain a `.json` chart still import).

```
ManiDimExport-<title>/
    chart/<title>.mdc
    audio/<title>.wav        (mp3 / m4a / flac / … also fine)
```

Everything after a `#` is a comment (except on the `T:` and `A:` lines).

## Song info

| line | meaning |
|---|---|
| `T:Neon Drive` | title |
| `A:Vector Hearts` | artist |
| `B:128` | BPM — quarter notes per minute |
| `O:0.459` | seconds from the start of the audio to **measure 1, beat 1** |
| `H:0.83` | accent colour (hue 0 – 1), optional |
| `AUDIO:song.wav` | audio file name inside the package, optional (the first audio file is used otherwise) |

## A chart

```
[Hard]                     # starts a chart (omit for a single chart)
4,3                        # keys (1–8), difficulty level (each chart may use its own key count)
4:4                        # time signature (default 4:4). Change later with  @12 3:4
K1 1,1 0 0                 # a tap
K2 1,3.5 1 0 E:2,1         # a hold from 1,3.5 to 2,1
K2 1,3.5 1 1|L|2,2 E:3,2   # a hold with a slide to the left at 2,2
```

A note is `K<lane> <measure>,<beat> <hold> <slide> [E:<measure>,<beat>]`:

| field | meaning |
|---|---|
| `K2` | lane — `K1` is the leftmost lane |
| `1,3.5` | measure and beat; **both start at 1**; beats can be fractional (`3.5` = half-way between beat 3 and 4). Measures before 1 are allowed (they extend backwards) |
| `0` / `1` | hold? |
| `0` | no slide |
| `1\|L\|2,2` | slide: `L` (left) or `R` (right) at measure 2, beat 2. Chain several: `1\|L\|2,2\|R\|2,4` |
| `E:3,2` | where the hold ends. Required when hold = `1` |

Rules: slides only on holds, and must happen *inside* the hold; each slide moves one lane and may not leave the lanes.
The fields may be spread over several lines (one per line, as in the original sketch) — only the order matters.

With a time signature of `n:d` a measure has `n` beats and each beat is a `1/d` note (so `6:8` has six eighth-note beats).

## Extras

```
FX sparkles 5,1                  # chart effect at measure 5, beat 1
FX lasers 9,1 hue=0.6 len=8      # optional hue (0–1) and length in seconds
LS 3,2 slideRight|Slide notes|Keep holding the lane key…   # tutorial lesson: key|title|text (\n = new line)
```

Effect kinds: `sparkles flash shake pulse fireworks lasers tint`. Lesson keys: `space slideLeft slideRight`.

## Full example

```
T:Example
A:Me
B:120
O:0
AUDIO:example.wav

[Normal]
4,3         # keys, difficulty
4:4         # time signature
K1 1,1 0 0
K2 1,2 0 0
K3 1,3 1 0 E:2,1
K4 1,3.5 1 1|L|2,1 E:3,1
FX flash 2,1
```

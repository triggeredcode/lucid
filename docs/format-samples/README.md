# Format samples

One sample note for each of the five note formats, as the PDF Lucid makes of it. The pictures show every page side by side.
The notes are written for the pictures: the numbers in them are made up to show the format, they are not measurements.

| Format | Note | Picture |
| --- | --- | --- |
| Concept note | [concept-note.lmd](concept-note.lmd) | [format-concept-note.png](format-concept-note.png) |
| System design note | [system-design.lmd](system-design.lmd) | [format-system-design.png](format-system-design.png) |
| Comparison | [comparison.lmd](comparison.lmd) | [format-comparison.png](format-comparison.png) |
| Inference engineering note | [inference-math.lmd](inference-math.lmd) | [format-inference-math.png](format-inference-math.png) |
| Benchmark note | [benchmark.lmd](benchmark.lmd) | [format-benchmark.png](format-benchmark.png) |

The `.lmd` files are plain notes in Lucid Markdown, the text form of a page (a diagram is a `graph` block, a chart a `chart`
block). `samples.json` holds each sample's title and the fields shown under it. A test checks that each sample fills every
section of its format.

To make the pictures again (after a change to a format or to how a PDF looks):

```bash
pnpm build
node scripts/format-samples.mjs            # all five; or name some: concept-note benchmark
```

The script puts each note into the built app as a page of its format and clicks Download PDF, so the pictures are what a
person gets, with real diagrams. It needs `pdftoppm` (poppler) and Python with Pillow to put the pages side by side.

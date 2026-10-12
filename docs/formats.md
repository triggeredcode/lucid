# Note formats

A **note format** is the skeleton of a page: its sections, a hint for each saying what belongs there, and which blocks suit it.
Start a page from one with **New from a format…**; Lucid suggests one from what you say, and you always choose. A page of a
format starts as its section headings, and what you dictate goes under the right one. Sections left empty are not printed.

| Format | For | Sections |
|---|---|---|
| **Concept note** | one computer-science or system-design idea | Definition · Intuition · How it works · Example · Pitfalls and gotchas · Related concepts |
| **System design** | designing a system end to end | Requirements · Capacity estimates · API · High-level design · Data model · Deep dives · Trade-offs and decisions · Open questions |
| **Comparison** | choosing between technologies | Context · Options · Comparison · Pros and cons · Decision |
| **Inference engineering** | KV cache, FLOPs, bandwidth, batching | Intuition · The math · Numbers to remember · Hardware implications · Pitfalls |
| **Benchmark** | recording an experiment | Goal and hypothesis · Setup · Method · Results · Observations · Next experiments |

## What the PDFs look like

Each picture is the PDF of a sample note, made with the real app ([how](format-samples/README.md); the numbers in them are made up).

**Concept note**

![A concept note as a PDF: definition, a diagram, a worked example and pitfalls](format-samples/format-concept-note.png)

**System design**

![A system design note as a PDF](format-samples/format-system-design.png)

**Comparison**

![A comparison note as a PDF](format-samples/format-comparison.png)

**Inference engineering**

![An inference engineering note as a PDF](format-samples/format-inference-math.png)

**Benchmark**

![A benchmark note as a PDF with a table and a chart](format-samples/format-benchmark.png)

## Open to other fields

The formats lean towards engineering because that is what Lucid was made for, but nothing else in Lucid does. A format is a
small data entry in [`packages/kit/src/formats/index.ts`](../packages/kit/src/formats/index.ts): an id, a description, keywords
for the suggestion, the sections and the blocks that suit them. A lab notebook, a reading log or a study plan is one more
entry. New block types (one folder each) work the same way. See [CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-note-format).

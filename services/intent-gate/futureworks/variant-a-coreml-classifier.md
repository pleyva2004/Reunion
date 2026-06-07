# Future work — Variant A: CoreML custom intent classifier

> **Status:** deferred (time-constrained). The shipped demo uses **Variant B**
> (Apple Foundation Models, zero training data). This document is the build guide
> for replacing it with a purpose-trained CoreML classifier when we want the
> "runs on the Apple Neural Engine" story and tighter control over precision/recall.

## Why Variant A (and why later)

| | Variant A — CoreML classifier | Variant B — Foundation Models (shipped) |
|---|---|---|
| Training data | **required** (label hundreds of examples) | none (prompted) |
| Pitch line | "runs on the Neural Engine" | "uses Apple's on-device LLM" |
| Accuracy control | high (you own the data + threshold) | prompt-tuned only |
| Runs on older / non-Apple-Intelligence Macs | yes | no (needs macOS 26 + Apple Intelligence) |
| Effort | data pipeline + training + eval | a prompt |

Variant A wins when we need offline robustness, deterministic behavior, or a tuned
precision/recall curve. It costs a data + training pipeline, which is why it's
deferred past the hackathon sprint.

## The key constraint that makes this cheap to adopt

The shipped sidecar speaks a **stable line protocol** (see
`sidecar/Sources/intent-sidecar/main.swift`):

```
stdin  : {"window": "<recent conversation text>"}
stdout : {"isTravelIntent": bool, "confidence": 0..1, "location": "..."}
```

Variant A must keep this exact contract. Then `src/classifier.ts` and
`src/index.ts` are **unchanged** — Variant A is a drop-in swap of the sidecar's
internals only.

## Step 1 — Data

Travel-intent classification is binary (extend to signal-strength later: none /
weak / strong, matching PRD FR1).

- **Schema:** `{ "window": string, "label": "travel" | "not", "location": string }`
  (`window` = last N concatenated messages, to match runtime input).
- **Sources:**
  1. **Mine your own `chat.db`** (your data → privacy OK; it is the exact runtime
     distribution). Export windows, hand-label.
  2. **LLM-synthesize** volume: "generate group-chat snippets where friends drift
     toward planning a trip" + an equal pile of unrelated chatter.
  3. **Hard negatives are the priority** — place names that are not intent
     ("I'm *from* Lisbon", "that's such a *Vegas* outfit", "let's go to Mars lol",
     "my flight *for work* got delayed"). These are what make a demo whiff.
- **Split:** hold out a **real-chat** test set (never synthesized) for an honest
  precision / recall number and threshold tuning toward the low-noise NFR.

## Step 2 — Train

Two interchangeable paths:

- **Apple Create ML (recommended, native).** Train an `MLTextClassifier` either in
  the Create ML app (drag in labeled CSV/JSON) or programmatically:
  ```swift
  import CreateML
  let data = try MLDataTable(contentsOf: trainingCSV)
  let model = try MLTextClassifier(trainingData: data, textColumn: "window", labelColumn: "label")
  try model.write(to: URL(fileURLWithPath: "TravelIntent.mlmodel"))
  ```
- **Python + coremltools.** Train any sklearn / PyTorch / sentence-transformers
  model, then `coremltools.convert(...)` to a `.mlmodel`/`.mlpackage`. Use this if
  you want embeddings + logistic regression or a fine-tuned transformer.

## Step 3 — Inference in the sidecar (Neural Engine)

Swap the Foundation Models call for the CoreML model via `NaturalLanguage`:

```swift
import NaturalLanguage

let model = try NLModel(contentsOf: Bundle.module.url(forResource: "TravelIntent", withExtension: "mlmodelc")!)
let label = model.predictedLabel(for: window)              // "travel" / "not"
let scores = model.predictedLabelHypotheses(for: window, maximumCount: 2)  // confidence
```

- Bundle the compiled `.mlmodelc` as a package resource (`.copy`/`.process` in
  `Package.swift` `resources:`).
- Map `label`/`scores` into the existing `{isTravelIntent, confidence, location}`
  JSON. `NLModel` runs on the Neural Engine automatically.

## Step 4 — Location extraction (separate from intent)

A text *classifier* gives intent only, not slots. Extract destination separately:

- **`NLTagger` named entities:** tag the window for `.placeName`, take the most
  recent place mention.
  ```swift
  let tagger = NLTagger(tagSchemes: [.nameType])
  tagger.string = window
  tagger.enumerateTags(in: window.startIndex..<window.endIndex, unit: .word,
                       scheme: .nameType, options: [.omitWhitespace]) { tag, range in
    if tag == .placeName { /* candidate destination */ }
    return true
  }
  ```
- Or keep a **gazetteer** (city/country list) and match. Combine with `NLTagger`
  to cut false positives.

## Step 5 — Eval & rollout

- Tune the decision threshold on the held-out real set for the low-noise target
  (favor precision; a missed trip is cheaper than an annoying false fire).
- A/B against the Variant B baseline on the same test windows.
- Decide per-device: Variant A where Apple Intelligence is unavailable or where
  deterministic behavior matters; Variant B where zero-data speed wins.

## Files this would touch

- `sidecar/Sources/intent-sidecar/main.swift` — replace the FM call; keep protocol.
- `sidecar/Package.swift` — add the bundled `.mlmodelc` resource.
- `src/classifier.ts`, `src/index.ts` — **no change** (same line protocol).
- New: a `training/` dir for data + the Create ML / coremltools script.

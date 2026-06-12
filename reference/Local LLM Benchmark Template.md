# 🧠 12 Small LLMs Benchmarked on 15 Reasoning Questions (16384 ctx) — Template

**Test:** [e.g., 5 Logic + 5 Coding + 5 Math questions]
**Context:** [e.g., 16384]
**Setup:** [e.g., all models tested locally with identical prompts]
**Date:** [YYYY-MM-DD]
**Hardware:** [GPU/CPU/RAM]

> **How to use this section:** Fill in the run metadata before testing so future comparisons are apples-to-apples.

## 🏆 Full Rankings (15 questions)

> **How to use this section:** Add one row per model. Use `X` rank for failed/incomplete runs, and explain in Notes.

| Rank | Model        |      Params |        Score         | Logic (5) | Code (5) | Math (5) |            Speed             | Notes           |
|:----:|--------------|------------:|:--------------------:|:---------:|:--------:|:--------:|:----------------------------:|-----------------|
| [1]  | [Model Name] |  [e.g., 4B] |       [__/15]        |  [__/5]   |  [__/5]  |  [__/5]  | [very fast/fast/normal/slow] | [optional]      |
| [2]  | [Model Name] |  [e.g., 8B] |       [__/15]        |  [__/5]   |  [__/5]  |  [__/5]  |           [speed]            | [optional]      |
| [X]  | [Model Name] | [e.g., 12B] | [Crashed/Incomplete] |    [-]    |   [-]    |   [-]    |      [failed/very slow]      | [what happened] |

## 🔥 Key Findings

> **How to use this section:** Summarize the top 3–5 takeaways from this run only. Keep each finding concise and evidence-based.

### 1. [Finding title]
- [Observation]
- [Supporting comparison]

### 2. [Finding title]
- [Observation]
- [Supporting comparison]

### 3. [Finding title]
- [Observation]
- [Supporting comparison]

### 4. Parameter efficiency (optional)

> **How to use this subsection:** Include only if active parameter data is known.

| Model     | Active Params | Score | Score/B |
|-----------|--------------:|:-----:|:-------:|
| [Model A] |    [e.g., 3B] | [__]  |  [__]   |
| [Model B] |    [e.g., 4B] | [__]  |  [__]   |

### 5. Hardest questions

> **How to use this subsection:** List the questions most frequently missed and how many models failed each.

- [Question ID + short label]: [x/y] models failed
- [Question ID + short label]: [x/y] models failed
- [Question ID + short label]: [x/y] models failed

## ⚡ Speed Notes

> **How to use this section:** Group models by practical inference speed at this context size. Keep labels consistent across reports.

- **Very fast:** [model names]
- **Fast:** [model names]
- **Normal:** [model names]
- **Slow:** [model names]
- **Too slow to test:** [model names]

## ❌ Models to Avoid

> **How to use this section:** Include only models with clearly poor outcomes (very low score, repeated failures, instability, or unusable latency).

- **[Model]** ([score]) - [reason]
- **[Model]** ([score/status]) - [reason]

---

## Test Details

> **How to use this section:** Keep prompts, question set, and grading key stable between benchmark runs.

### 📋 TEST QUESTIONS

> **How to use this section:** Replace with your exact test set. Keep IDs stable (`S1..S15`) so historical comparisons are easy.

#### GENERAL INTELLIGENCE (Logic & Reasoning)
S1. [Question text]

S2. [Question text]

S3. [Question text]

S4. [Question text]

S5. [Question text]

#### CODING
S6. [Question text]

```python
# Optional code snippet for S6
```

S7. [Question text]

```javascript
// Optional code snippet for S7
```

S8. [Question text]

S9. [Question text]

```sql
-- Optional code snippet for S9
```

S10. [Question text]

#### MATHEMATICS
S11. [Question text]

S12. [Question text]

S13. [Question text]

S14. [Question text]

S15. [Question text]

### ✅ ANSWER KEY

> **How to use this section:** Keep answers deterministic when possible. Update this first before scoring models.

| Question | Correct Answer |
|----------|----------------|
| S1       | [answer]       |
| S2       | [answer]       |
| S3       | [answer]       |
| S4       | [answer]       |
| S5       | [answer]       |
| S6       | [answer]       |
| S7       | [answer]       |
| S8       | [answer]       |
| S9       | [answer]       |
| S10      | [answer]       |
| S11      | [answer]       |
| S12      | [answer]       |
| S13      | [answer]       |
| S14      | [answer]       |
| S15      | [answer]       |

### Scoring Notes (optional)

> **How to use this section:** Define grading rules once and reuse them every run.

- [e.g., exact match required for numeric answers]
- [e.g., partial credit policy if used]
- [e.g., timeout/failure handling]

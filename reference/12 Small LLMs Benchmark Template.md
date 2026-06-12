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
S1. It is known that 5 machines produce 5 widgets in 5 minutes. How many minutes would it take for 100 machines to produce 100 widgets?

S2. Half of a lake surface is covered with water hyacinths. Every day, the covered area doubles. If it takes 48 days to completely cover the lake, how many days did it take to cover half of the lake?

S3. There are 3 fathers and 3 sons going to a doctor. What is the total number of people?

S4. Find the next number in the sequence: 2, 6, 12, 20, 30, 42, ?

S5. "Some doctors are surgeons. All surgeons are meticulous. Therefore, some doctors are meticulous." Is this inference valid?

#### CODING
S6. What does the following Python code return?

```python
def mystery(lst):
    return [x**2 for x in lst if x % 2 == 0]

print(mystery([1, 2, 3, 4, 5, 6]))
```

S7. What is the output of the following JavaScript code?

```javascript
const arr = [1, 2, 3];
const result = arr.reduce((acc, val) => acc + val, 10);
console.log(result);
```

S8. What is the most efficient approach to find the middle element of a linked list?

S9. What is the result of the following SQL query?

```sql

SELECT department, COUNT(*) as cnt
FROM employees
WHERE salary > 50000
GROUP BY department
HAVING COUNT(*) > 2
ORDER BY cnt DESC;
```

S10. When designing a REST API, which HTTP method and status code are correct for deleting a resource?

#### MATHEMATICS
S11. log₂(64) + log₂(8) = ?

S12. What is the derivative f'(x) of f(x) = 3x² + 2x − 1?

S13. A bag contains 3 red, 5 blue, and 2 green balls. If two balls are randomly selected, what is the probability that both are blue?

S14. Solve the equation: 3x − 7 = 5x + 1

S15. In the sequence where a₁ = 2 and aₙ = 2·aₙ₋₁ + 1, what is the value of a₄?


### ✅ ANSWER KEY

| Question | Correct Answer                                                |
|----------|---------------------------------------------------------------|
| S1       | 5                                                             |
| S2       | 47                                                            |
| S3       | 4                                                             |
| S4       | 56                                                            |
| S5       | Yes, valid                                                    |
| S6       | [4, 16, 36]                                                   |
| S7       | 16                                                            |
| S8       | Two pointers (tortoise and hare) — O(1) space                 |
| S9       | Departments with >2 employees earning >50k, sorted descending |
| S10      | DELETE + 204 No Content                                       |
| S11      | 9                                                             |
| S12      | 6x + 2                                                        |
| S13      | 2/9                                                           |
| S14      | x = −4                                                        |
| S15      | 23                                                            |

*Questions included: machine/widget ratio, exponential pond growth, father-son puzzle, sequence completion, syllogism, Python list comprehension, JS reduce, linked list middle, SQL aggregation, REST API, logarithms, derivatives, probability, linear equations, recurrence relations.*

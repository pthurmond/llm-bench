# 🧠 12 Small LLMs Benchmarked on 15 Reasoning Questions (16384 ctx)

**Test:** 5 Logic + 5 Coding + 5 Math questions
**Context:** 16384
**All models tested locally with identical prompts**


## 🏆 Full Rankings (15 questions)

| Rank | Model                                               |  Params |   Score    | Logic (5) | Code (5) | Math (5) |   Speed   |
|:----:|-----------------------------------------------------|--------:|:----------:|:---------:|:--------:|:--------:|:---------:|
|  1   | Qwen/Qwen3.6-35B-A3B (base)                         | 35B MoE |   14/15    |    4/5    |   5/5    |   5/5    |   fast    |
|  1   | Qwen/Qwen3.5-9B-Claude-Opus-4.7                     |      9B |   14/15    |    4/5    |   5/5    |   5/5    |   slow    |
|  2   | Qwen/Qwen3.5-4B-Claude-4.6-Opus-Reasoning-Distilled |      4B |   13/15    |    3/5    |   5/5    |   5/5    |   fast    |
|  3   | Google/Gemma-4-E2B                                  |   ~2-4B |   12/15    |    3/5    |   4/5    |   5/5    |  normal   |
|  3   | Nvidia/Nemotron-3-Nano-4B                           |      4B |   12/15    |    2/5    |   5/5    |   5/5    |   fast    |
|  3   | OpenAI/GPT-OSS-20B                                  |     20B |   12/15    |    2/5    |   5/5    |   5/5    |   slow    |
|  4   | MistralAI/Ministral-3B                              |      3B |   11/15    |    3/5    |   5/5    |   3/5    | very fast |
|  5   | Meta/Llama-3.1-8B-Instruct                          |      8B |   10/15    |    2/5    |   5/5    |   3/5    |  normal   |
|  5   | lfm2.5-8B                                           |      8B |   10/15    |    2/5    |   3/5    |   5/5    |  normal   |
|  6   | IBM/Granite-4-H-Tiny                                |   ~2-4B |    9/15    |    2/5    |   5/5    |   2/5    |  normal   |
|  6   | Qwen/Qwen3.6-14B                                    |     14B |    9/15    |    1/5    |   4/5    |   4/5    |  normal   |
|  7   | Microsoft/Phi-4-mini-reasoning                      |     ~4B |    5/15    |    0/5    |   2/5    |   1/5    |  normal   |
|  X   | Negentropy/Negentropy-Claude-Opus-4.7-4B            |      4B |  Crashed   |     -     |    -     |    -     |  failed   |
|  X   | Google/Gemma4-12B                                   |     12B | Incomplete |     -     |    -     |    -     | very slow |



## 🔥 Key Findings

### 1. Distillation is powerful but inconsistent

- Qwen3.5-4B-Distilled: **13/15** (great)
- Qwen3.6-35B-A3B-Claude-Apex: **11/15**


### 2. 4B models beat 20B models

- Qwen3.5-4B-Distilled (13/15) > GPT-OSS-20B (12/15)


### 3. Parameter efficiency champion (active params)

| Model                | Active | Score | Score/B |
|----------------------|--------|:-----:|:-------:|
| Qwen3.6-35B-A3B      | 3B     |  14   |  4.67   |
| Ministral-3B         | 3B     |  11   |  3.67   |
| Qwen3.5-4B-Distilled | 4B     |  13   |  3.25   |


### 4. Hardest questions

- S3 (father-son puzzle): 8/12 models failed
- S1 (machine/widget ratio): 7/12 failed
- S2 (pond growth): 5/12 failed


## ⚡ Speed Notes (16384 context)

- **Very fast:** Ministral-3B
- **Fast:** Qwen3.5-4B-Distilled, Nemotron-4B
- **Slow:** Qwen3.5-9B-Claude, GPT-OSS-20B
- **Too slow to test:** Gemma4-12B


## ❌ Models to Avoid

- **Phi-4-mini-reasoning** (5/15) - poor reasoning despite name
- **Negentropy-4B** - crashed on question 3
- **Gemma4-12B** - too slow to use on rtx 4050 -_-

---

## Test Details

**Tests run at 16384 context.

### 📋 TEST QUESTIONS (English)

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

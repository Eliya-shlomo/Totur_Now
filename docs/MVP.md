# TutorNow — MVP Specification

> A **per-question, real-time** tutoring marketplace — instead of pre-scheduled private lessons.

**Version:** 1.0 · **Team:** 2 developers + AI coding agents · **Dev window:** Aug 9–19 (feature close) · **Bug fixes + demo prep:** Aug 20

---

## Table of Contents

1. [Problem & Solution](#1-problem--solution)
2. [Target Users & Personas](#2-target-users--personas)
3. [Scope — In and Out](#3-scope--in-and-out)
4. [Core User Flows](#4-core-user-flows)
5. [Pricing Model & Economics](#5-pricing-model--economics)
6. [Teacher Onboarding & Standing](#6-teacher-onboarding--standing)
7. [Topic Taxonomy](#7-topic-taxonomy)
8. [The LLM Layer](#8-the-llm-layer)
9. [Matching Algorithm](#9-matching-algorithm)
10. [Session State Machine](#10-session-state-machine)
11. [Data Model](#11-data-model)
12. [Server Endpoints](#12-server-endpoints)
13. [Real-Time Events](#13-real-time-events)
14. [Screens & Navigation](#14-screens--navigation)
15. [Technical Architecture](#15-technical-architecture)
16. [Course Requirements Mapping](#16-course-requirements-mapping)
17. [Working Method: Agent-Assisted Development](#17-working-method-agent-assisted-development)
18. [Epics & PR Breakdown](#18-epics--pr-breakdown)
19. [Timeline & Checkpoints](#19-timeline--checkpoints)
20. [Risks](#20-risks)
21. [Future Scope](#21-future-scope)
22. [Appendix: System Constants](#appendix-system-constants)

---

## 1. Problem & Solution

### The Problem

High school students get stuck **while practicing** — 10 PM, a week before the Bagrut exam. Existing options fail at exactly that moment:

| Existing option | Why it fails right now |
|---|---|
| Private tutor | Scheduled in advance, full hour, ₪150–250, not available now |
| WhatsApp study group | Maybe an answer in two hours, often wrong |
| YouTube / solution sites | Doesn't address *this* exercise or *this* student's specific confusion |
| ChatGPT | Gives an answer, doesn't necessarily teach; the student can't verify it |

On the supply side: private tutors and math students are **fully booked during exam season** and can't take on more recurring students — but they *can* give 15 minutes between commitments.

### The Solution

A real-time marketplace that breaks the private lesson into small units:

```
Student gets stuck  →  photographs / describes the question  →  LLM classifies (topic, level, brief)
                    →  algorithm surfaces 5 available teachers  →  student picks one
                    →  teacher receives a brief and accepts  →  video call
                    →  10-minute opening block  →  5-minute extensions the student approves
                    →  end  →  "Was it solved?" + rating  →  rating feeds the algorithm
```

### One-line pitch

> **"Stuck on a problem? A tutor on screen in 60 seconds. Pay only for the minutes you need."**

### What makes this a product, not a feature

The closed loop: every question is LLM-classified → every rating attaches to that classification → the algorithm learns not "who is a good teacher" but **"who is good at integration by parts at the 5-unit level."** The more questions flow through, the better the matching gets. That is the compounding asset.

---

## 2. Target Users & Personas

### Student — "Avi", 12th grade, 4–5 unit math

- Studies at irregular hours (8 PM–1 AM), mostly weekends and before exams
- Works from phone/laptop, photographs exercises from the workbook
- Price-sensitive — usually parents' money, limited budget
- **The need:** don't stay stuck. Doesn't want a weekly lesson, wants an answer now

**Use cases:** register · load credit · post a question (text + image) · pick a teacher from a shortlist · video call · extend/end · rate · view history and balance

### Teacher — "Dana", 3rd-year math undergraduate

- Wants flexible income without committing to fixed hours
- Free in random windows — between lectures, in the evening
- **The need:** flip a switch to "available," get work, switch off whenever

**Use cases:** register · pick specialty topics, level and price · availability toggle · accept/reject offers · run a session · view earnings and ratings

### Guest — not logged in

**Use cases:** landing page · list of currently available teachers (no contact info) · reviews · pricing explanation

### Admin

**Use cases:** view sessions · block users

---

## 3. Scope — In and Out

### ✅ In MVP

| Area | What's included |
|---|---|
| Auth | Register/login, JWT + refresh, 3 roles (student / teacher / admin) |
| Teachers | Open signup, topic selection, self-declared level, teacher-set price, availability toggle, platform standing badge |
| Questions | Free text + image upload (external storage), automatic LLM classification |
| Matching | Ranking algorithm + selection screen showing 5 teachers |
| Offers | One live offer at a time, 60s TTL, atomic teacher locking |
| Sessions | Automatic Daily room creation, an **embedded** call, block timer, consent-based extension, auto-end |
| Money | Internal credit wallet, charge at block start, append-only ledger, teacher earnings balance |
| Feedback | "Resolved? yes/no" + stars + free text → per-topic rating update |
| Real-time | Socket.IO for presence, offers, timer, session end |
| Notifications | Email to teacher on new offer |
| General | Responsive, end-to-end error handling, validation, deployment |

### ❌ Out of MVP (documented in [§21](#21-future-scope))

Real payments (Stripe) · shared whiteboard · session recording · anti-stalling mechanism · full minor-safety program · mid-session topic change detection · question library / RAG · mobile app · additional subjects · **teacher entrance exam** · **document verification and the admin approval queue** · **academic email verification**

The last three were in MVP until the 8/11 revision. They were the platform deciding who may teach and what they may charge. The platform now describes teachers and lets students decide — see [§5.2](#52-price--teacher-set-within-bounds) and [§6](#6-teacher-onboarding--standing).

---

## 4. Core User Flows

### 4.1 Main flow — student gets stuck

```
[Dashboard]
    │  taps "I'm stuck"
    ▼
[Question form]  ← text: "I don't know how to start" + photo of the exercise
    │  Submit
    ▼
[Waiting screen]  ← "Analyzing your question..." (2–4 seconds)
    │  LLM classifies: topic=Calculus, subtopic=Integration by parts, level=5 units
    ▼
[Teacher list]  ← 5 cards: badge · rating · "12 questions in Integrals" · price · "your credit = 22 min"
    │  picks Dana → "Send request"
    ▼
[Awaiting response]  ← 60-second countdown
    │
    ├─ Dana accepted ─────────────► [Session]
    ├─ Dana rejected ─────┐
    └─ Timed out ─────────┤
                          ▼
              [Refreshed teacher list]  ← Dana still listed if she's available
                                          Button: "Show me more teachers"
```

### 4.2 The session

```
T=0    Charge 2 blocks (10 min) · create Daily room · start timer
T=9:00 Modal to student: "One minute left. Extend by 5 minutes (+₪12)?"
       ├─ Yes → charge one block · timer +5:00
       └─ No / no response → T=10:00 · 30s grace → auto-end
T=end  [Blocking screen] "Was your question resolved?" yes/no → stars → free text (optional)
       ← navigation blocked until answered; a "Skip" link appears after 10 seconds
```

### 4.3 The teacher

```
[Dashboard]  → toggle "Available" → status=ONLINE
    ▼
🔔 Incoming offer (Socket + email)
    ┌────────────────────────────────────────┐
    │  Math · Integrals · 5 units            │
    │                                        │
    │  📋 Brief:                              │
    │  "Integration by parts on x·ln(x).     │
    │   Student tried substitution and got   │
    │   stuck. Likely didn't recognize that  │
    │   u should be ln(x)."                  │
    │                                        │
    │  [exercise photo]                      │
    │  Expected earning: ₪24 for first 10 min │
    │                                        │
    │  [ Accept ]  [ Decline ]     ⏱ 47s     │
    └────────────────────────────────────────┘
```

**Important:** the moment an offer is sent, the teacher is locked (`status=OFFER_LOCKED`) and receives no further offers until they respond or the offer expires.

---

## 5. Pricing Model & Economics

### 5.1 Blocks

| Component | Value |
|---|---|
| Base unit | Block = **5 minutes** |
| Opening block | **10 minutes** (2 blocks) — charged immediately, non-cancellable |
| Extension | **5 minutes** (1 block) — only on active student approval |
| Decision point | 60 seconds before each block ends |
| Default behavior | **No response = session closes** |
| Budget cap | Student sets in advance (default ₪40) |

**Why blocks:** a second-by-second meter creates anxiety and cuts sessions short before learning happens. Blocks turn it into a series of discrete decisions. **And more importantly** — every extension is a vote of confidence, which makes the teacher dependent on satisfaction rather than on stretching time.

### 5.2 Price — teacher-set within bounds

**The teacher sets their own price.** Any whole number of credits per block between a floor and a ceiling:

| | Value |
|---|---|
| Floor | **₪5** / block |
| Ceiling | **₪20** / block |
| Default at signup | ₪10 / block |

The platform does not decide what a teacher is worth. A tutor with ten years of experience and no certificate may be the best teacher on the platform, and nothing in the product should price them as a beginner. What the platform does instead is *describe* — standing, rating, resolve rate, topics — and let the student weigh that against the price themselves.

**Why bounds at all, if the teacher decides?** The floor stops a race to the bottom, where undercutting rather than teaching becomes the way to get matched. The ceiling keeps the budget cap and the "can afford the opening block" filter meaningful — without it a single ₪200 teacher makes every balance display nonsense.

**Price changes** take effect for future sessions only. A session snapshots `price_per_block` when the offer is accepted, so the number the student saw on the selection screen is the number they are charged for the whole session, extensions included ([§11.2](#112-schema), `sessions.price_per_block`).

#### Price bands — a student filter, not a teacher property

The student filters the selection screen by price, choosing a band as a **ceiling**:

| Band | ₪ / block | Student picking this band sees |
|---|---|---|
| **A** | 5–9 | Band A only |
| **B** | 10–14 | Bands A and B |
| **C** | 15–20 | Everything |

Bands are derived from `price_per_block` at read time. They are not stored on the teacher, and a teacher never picks one — moving between bands is a side effect of changing price, nothing more.

The band is a **hard filter, never a score**. Price does not raise or lower a teacher's ranking ([§9.2](#92-scoring)): within whatever the student can afford, the order is quality alone. Cheapness is not a virtue and expensiveness is not a signal — the student has already expressed their price preference by choosing the band, and re-applying it in the ranking would charge them for that preference twice.

### 5.3 Commission & incentives

| Parameter | Value | Rationale |
|---|---|---|
| Platform commission | **15%** | Well below market — we need supply before profit |
| New teacher | **0% for 30 days** | Costs nothing, highly attractive |
| Low-demand hours (6 AM–2 PM) | **0%** | Availability incentive without paying for standby |
| New student | **First opening block free** | Platform absorbs it. The teacher is **still paid in full** |

### 5.4 Credits

- **1 credit = ₪1** (keeps everything simple)
- **Packages:** ₪50 / ₪100 / ₪200
- **Always displayed in minutes:** _"Your balance: ₪96 ≈ 40 minutes with Dana"_ — the student thinks in help remaining, not in money
- **Out of credit = no extension.** The current block finishes and the session closes. A top-up banner appears at the 60-second warning

### 5.5 Edge cases and money

| Scenario | Outcome |
|---|---|
| Teacher no-show / disconnected and didn't return within 60s | **Full refund** + `no_show` recorded |
| Platform technical failure | **Full refund** |
| Student closes within 60s of start | **Full refund** |
| Student disconnects/leaves after a minute | **Charged in full** |
| Student unhappy with the explanation | **Charged in full** — the rating is the penalty mechanism |
| Offer expired / rejected | No charge |

**Guiding principle:** the party responsible for the disconnect bears the cost. A failure belonging to neither party is absorbed by the platform.

### 5.6 Sanity check

Average student: 3 questions/week × 15 minutes × ₪12/block = **~₪108/week**, versus ₪150–250 for a single private lesson. At 15% commission → ~₪16/week platform revenue per active student.

---

## 6. Teacher Onboarding & Standing

### 6.1 Getting in — open to everyone

There is no entrance exam, no document to upload, and no approval to wait for. A teacher registers, declares what they teach, sets a price, and can go online in the same sitting.

| Step | What the teacher provides | Checked by |
|---|---|---|
| 1 | Topics they teach | nobody |
| 2 | Highest level they teach (3 / 4 / 5 units) | nobody |
| 3 | Price per block, ₪5–20 | bounds only |
| 4 | Bio — free text | nobody |

**Why open.** Credentials are a poor proxy for teaching. Plenty of excellent tutors hold no certificate and no degree, and a gate built from paperwork keeps exactly those people out while admitting anyone who can upload a PDF. The platform's real filter is the one that measures the thing it cares about: whether students got unstuck, and whether they said so afterwards.

**What replaces the gate.** Ratings and resolve rate, applied at the point that matters — the ranking. A teacher who does poor work stops being ranked, stops receiving offers, and stops earning. That loop is slower than a gate at signup, but it measures the right thing, and it never rejects a good teacher for lacking a document.

**The risk, stated plainly.** The first session with a bad teacher is real, and it happens to a real student. Two things bound it: `NEW` standing tells the student exactly how much history the platform has (see §6.2), and the no-show and refund rules in §5.5 cover the worst outcomes. This is a deliberate trade, not an oversight — [§21](#21-future-scope) carries the verification track for when supply quality needs a firmer floor.

### 6.2 Standing — earned on the platform, computed not stored

A single badge, derived from what the teacher has actually done here:

| Badge | Condition | Meaning to a student |
|---|---|---|
| 🟢 **New** | < 5 sessions | Little history yet — priced by themselves, judged by you |
| 🔵 **Active** | 5–24 sessions | Working regularly, has a rating worth reading |
| 🟣 **Experienced** | 25+ sessions | Substantial track record |
| ⭐ **Top** | 100+ sessions **and** rating ≥ 4.5 | Volume *and* satisfaction, not just volume |

Two properties of this table matter more than the numbers in it:

- **`Top` requires both.** A teacher with 300 sessions and a 4.1 rating stays `Experienced` forever. Volume alone is not excellence, and a badge that rewarded it would point students at the busiest teacher rather than the best one.
- **It is computed, never stored.** The badge is a function of `sessions_count`, `rating_sum` and `rating_count`, all of which the platform already maintains. A stored copy would be one more thing to recalculate, forget, and drift.

**`New` still gets the exposure boost** — 1.0 on `new_teacher_boost` for the first 5 sessions ([§9.2](#92-scoring)). Cold start is the same problem it always was: a teacher with no history cannot earn history without being shown.

### 6.3 What a student sees

Only facts the platform can stand behind: standing badge, star rating and count, per-topic resolve history, response time, topics, level, price. Everything a teacher says about themselves — degrees, years of experience, where they studied — lives in the free-text bio, presented as the teacher's own words and never as a platform claim.

The platform makes no statement it cannot verify. That is why "10 years experience" is not a badge.

---

## 7. Topic Taxonomy

A **two-level** structure: parent topic → subtopic. The LLM classifies to subtopic; ratings update the subtopic at weight 1.0 and the parent at weight **0.3**.

Upward propagation is critical: without it, a teacher would need 15 sessions specifically in integration-by-parts before having a meaningful rating. With it, 5 sessions in integrals already produce signal across the branch.

| # | Parent topic | Subtopics |
|---|---|---|
| 1 | Algebra | Quadratic equations · Systems · Inequalities · Parameters · Absolute value |
| 2 | Word problems | Motion · Work rate · Buy/sell · Mixtures |
| 3 | Sequences | Arithmetic · Geometric · Infinite series |
| 4 | Analytic geometry | Line · Circle · Distances and slopes |
| 5 | Euclidean geometry | Triangles · Quadrilaterals · Circle · Similarity |
| 6 | Trigonometry | Plane · Identities · Trig equations · 3D |
| 7 | Calculus — Functions | Polynomial · Rational · Radical · Trig · Exponential · Logarithmic |
| 8 | Calculus — Derivatives | Differentiation rules · Curve sketching · Optimization |
| 9 | Calculus — Integrals | Indefinite · Definite · Areas · Integration by parts |
| 10 | Probability & Statistics | Basic probability · Conditional · Normal distribution · Statistics |
| 11 | Vectors & 3D | Plane vectors · 3D vectors · 3D analytic geometry |

Plus: `topic_id = 0` → **"General / Unclassified"** — fallback when the LLM fails or is unsure.

---

## 8. The LLM Layer

The LLM's role in MVP is **not** to answer the student. It is **to classify and to brief**. This is a deliberate decision: it keeps the value with the teacher and produces exactly the metadata the algorithm needs.

### 8.1 Classification and brief — the only LLM call in MVP

**Input:** student's text + image (Vision) + declared level
**Output:** structured JSON only

```json
{
  "title": "Integration by parts on x·ln(x)",
  "topic_id": 9,
  "subtopic_id": 94,
  "difficulty": 3,
  "estimated_level": 5,
  "teacher_brief": "Integral of x·ln(x). The student tried substitution and got stuck. Likely didn't recognize this as an integration-by-parts case where u=ln(x). Consider starting by asking how they choose u.",
  "student_confirmation": "Looks like you're working on integration by parts at the 5-unit level. Correct?",
  "confidence": 0.91
}
```

**Guardrails:**
- `response_format: json_object` + server-side Zod schema
- Parse failure / `confidence < 0.5` → `topic_id = 0`, `teacher_brief` = student's raw text, **the flow continues**. Classification never blocks matching
- 8-second timeout → same fallback
- `student_confirmation` is shown to the student with a manual override — improves accuracy and creates a sense of control

> A second call generated the entrance exam bank until the 8/11 revision. The exam
> is out of MVP ([§6.1](#61-getting-in--open-to-everyone)), so classification is now
> the whole LLM surface — one call, one prompt, one failure mode to handle.

---

## 9. Matching Algorithm

### 9.1 Hard filters

A teacher enters the candidate pool only if **all** of these hold:

```
status == 'ONLINE'                          # not OFFLINE, IN_SESSION, or OFFER_LOCKED
level_max >= question.estimated_level       # the level the teacher says they teach
question.topic_id ∈ teacher.topics          # (topic_id == 0 → everyone passes)
price_per_block <= band_ceiling(student.price_band)   # §5.2 — student's price choice
student.wallet_balance >= price_per_block*2 # can afford the opening block
teacher_id ∉ student.blocked_teachers
teacher_id ∉ question.rejected_by           # hasn't already declined this question
```

`is_verified` was a filter here until the 8/11 revision. Signup is open ([§6.1](#61-getting-in--open-to-everyone)), so nothing sets it and nothing filters on it.

The price band is the **only** place price enters matching. It is a ceiling, so a student on band B sees bands A and B — never "band B exactly". A cheaper teacher is never hidden from someone willing to pay more.

### 9.2 Scoring

```
score = 0.35 · topic_fit
      + 0.20 · global_rating
      + 0.20 · resolve_rate
      + 0.10 · acceptance_rate
      + 0.10 · history_bonus
      + 0.05 · new_teacher_boost
```

`price_fit` carried 0.05 until the 8/11 revision. Price is a filter now, not a score
([§5.2](#52-price--teacher-set-within-bounds)), and its weight went to `resolve_rate`
— the component that measures whether the student actually got unstuck.

| Component | Computation | Meaning |
|---|---|---|
| `topic_fit` | Bayesian rating in the subtopic, normalized to [0,1] | The heavy component — topical fit |
| `global_rating` | Average stars / 5 | Cross-cutting quality |
| `resolve_rate` | `resolved_count / sessions_count` | **The real KPI** — was the question actually solved |
| `acceptance_rate` | `accepted_offers / offers_received` | Reliability. Measures responsiveness, **not** availability |
| `history_bonus` | 1.0 if this student rated them ≥4 before, else 0 | Continuity wins |
| `new_teacher_boost` | 1.0 for the first 5 sessions | Solves cold start |

### 9.3 Bayesian smoothing — the critical piece

A teacher with a single 5.0 rating **must** rank below one with 4.6 across 40 sessions. Otherwise the algorithm is noise.

```
smoothed_rating(topic) = (Σratings_topic + C · global_avg) / (n_topic + C)
```

with `C = 5`. `resolve_rate` and `acceptance_rate` are smoothed identically against the platform average.

### 9.4 Pseudocode

```js
async function matchTeachers(question, student, N = 5) {
  const candidates = await db.query(HARD_FILTERS_SQL, {
    level: question.estimated_level,
    subtopicId: question.subtopic_id,
    maxPrice: bandCeiling(student.priceBand),   // §5.2 — the student's price choice
    minBalance: student.wallet_balance,
    studentId: student.id,
    rejectedBy: question.rejected_by,
  });

  if (candidates.length === 0) return { teachers: [], reason: 'NO_AVAILABLE_TEACHERS' };

  const platformAvg = await getPlatformAverages();          // cached 5 min

  const scored = candidates.map(t => {
    const topicFit = bayesian(t.topicStats[question.subtopic_id], platformAvg.rating, 5);
    const resolve  = bayesian(t.resolveStats,  platformAvg.resolveRate, 5);
    const accept   = bayesian(t.acceptStats,   platformAvg.acceptRate,  5);

    return {
      ...t,
      score:
        0.35 * topicFit +
        0.20 * (t.globalRating / 5) +
        0.20 * resolve +
        0.10 * accept +
        0.10 * (t.hasPositiveHistoryWith(student.id) ? 1 : 0) +
        0.05 * (t.sessionsCount < 5 ? 1 : 0),
    };
  });

  return {
    teachers: scored.sort((a, b) => b.score - a.score).slice(0, N),
    reason: null,
  };
}
```

### 9.5 Deliberate decisions

- **Availability is a filter, not a score.** An offline teacher isn't a candidate — meaning availability already delivered 100% of its value. An additional bonus on top would promote "bad but available"
- **Price is a filter, not a score,** for the same reason. The student states a ceiling; inside it, ranking is quality only. Scoring price as well would mean the student pays for their own budget twice — once by narrowing the pool, and again by having the cheap end of it pushed to the top
- **The student chooses, not the algorithm.** The algorithm narrows 200 to 5; the final choice is human
- **One offer at a time.** Prevents three teachers accepting and two being frustrated. Costs time, buys trust on the supply side — and supply is the bottleneck

---

## 10. Session State Machine

```
                    ┌──────────────┐
                    │   PENDING    │  question created, LLM classified
                    └──────┬───────┘
                           │ student sends an offer
                           ▼
                    ┌──────────────┐
              ┌─────│  OFFER_SENT  │  60s TTL · teacher locked
              │     └──────┬───────┘
   reject /   │            │ teacher accepted
   timeout    │            ▼
              │     ┌──────────────┐
              │     │    ACTIVE    │  room created · 2 blocks charged · timer running
              │     └──────┬───────┘
              │            │ end / no credit / no extension / disconnect
              ▼            ▼
       ┌──────────┐  ┌──────────────┐
       │ PENDING  │  │    ENDED     │  → mandatory rating
       │ (back)   │  └──────┬───────┘
       └──────────┘         │
                            ▼
                     ┌──────────────┐
                     │    RATED     │  → teacher stats updated
                     └──────────────┘

Additional states: CANCELLED (student cancelled pre-start) · NO_SHOW (teacher absent → refund)
```

### Teacher states

```
OFFLINE  ──toggle──►  ONLINE  ──offer sent──►  OFFER_LOCKED
                        ▲                            │
                        │◄────rejected / TTL─────────┤
                        │                            │ accepted
                        │                            ▼
                        └────session ended────── IN_SESSION

Auto-away: ONLINE with no activity for 60 minutes → OFFLINE (with an "Still there?" modal at 55 min)
```

`OFFER_LOCKED` is enforced in the DB via `UPDATE ... WHERE status='ONLINE'` and a `rowCount` check — two offers arriving in the same millisecond, only one succeeds.

---

## 11. Data Model

**PostgreSQL.** The decision follows from money: the wallet needs transactions and row locks. A ledger in Mongo without transactions is a bug that mints money from nothing.

### 11.1 Diagram

```
users ──1:1── student_profiles ──1:1── wallets ──1:N── wallet_transactions
  │
  └──1:1── teacher_profiles ──1:N── teacher_topics ──N:1── topics
                  │                                          ▲
                  │                                          │
                  ├──1:N── teacher_topic_stats ──────────────┘
                  └──1:N── payouts

questions ──1:N── question_attachments
    │
    └──1:1── sessions ──1:N── offers
                 ├──1:N── session_blocks
                 └──1:1── reviews
```

### 11.2 Schema

```sql
-- ══════════ USERS ══════════

CREATE TYPE user_role AS ENUM ('student', 'teacher', 'admin');

CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          VARCHAR(255) UNIQUE NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  full_name      VARCHAR(100) NOT NULL,
  role           user_role NOT NULL,
  avatar_url     TEXT,
  is_active      BOOLEAN DEFAULT TRUE,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE student_profiles (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  grade       SMALLINT,               -- 10 / 11 / 12
  math_level  SMALLINT,               -- 3 / 4 / 5
  school      VARCHAR(120)
);

-- ══════════ TEACHERS ══════════

CREATE TYPE teacher_status AS ENUM ('OFFLINE','ONLINE','OFFER_LOCKED','IN_SESSION');

-- No badge or price_tier column. The standing badge (§6.2) is computed from
-- sessions_count and the rating columns below; the price band (§5.2) is computed
-- from price_per_block. Neither is stored, because both are already derivable and
-- a stored copy is a copy that drifts.

CREATE TABLE teacher_profiles (
  user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bio                 TEXT,
  price_per_block     INTEGER        NOT NULL DEFAULT 10
                        CHECK (price_per_block BETWEEN 5 AND 20),   -- §5.2
  status              teacher_status DEFAULT 'OFFLINE',
  level_max           SMALLINT       DEFAULT 3,   -- self-declared, §6.1
  zoom_personal_link  TEXT,   -- §18's escape hatch, unread. Kept under its old name
                              --   on purpose: see E6's README, "the column we did not rename"
  -- denormalized aggregates for performance
  sessions_count      INTEGER DEFAULT 0,
  resolved_count      INTEGER DEFAULT 0,
  offers_received     INTEGER DEFAULT 0,
  offers_accepted     INTEGER DEFAULT 0,
  rating_sum          INTEGER DEFAULT 0,
  rating_count        INTEGER DEFAULT 0,
  no_show_count       INTEGER DEFAULT 0,
  last_seen_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_teacher_available
  ON teacher_profiles (status, level_max, price_per_block)
  WHERE status = 'ONLINE';

CREATE TABLE topics (
  id         SERIAL PRIMARY KEY,
  parent_id  INTEGER REFERENCES topics(id),   -- NULL = parent topic
  name_he    VARCHAR(80) NOT NULL,
  name_en    VARCHAR(80) NOT NULL,
  slug       VARCHAR(80) UNIQUE NOT NULL
);

CREATE TABLE teacher_topics (
  teacher_id UUID REFERENCES teacher_profiles(user_id) ON DELETE CASCADE,
  topic_id   INTEGER REFERENCES topics(id),
  PRIMARY KEY (teacher_id, topic_id)
);

CREATE TABLE teacher_topic_stats (
  teacher_id     UUID REFERENCES teacher_profiles(user_id) ON DELETE CASCADE,
  topic_id       INTEGER REFERENCES topics(id),
  rating_sum     NUMERIC(8,2) DEFAULT 0,   -- NUMERIC because parent propagation is 0.3
  rating_count   NUMERIC(8,2) DEFAULT 0,
  resolved_count NUMERIC(8,2) DEFAULT 0,
  sessions_count NUMERIC(8,2) DEFAULT 0,
  PRIMARY KEY (teacher_id, topic_id)
);

-- No teacher_documents table. Documents, the admin approval queue and academic
-- email verification are out of MVP as of the 8/11 revision (§6.1, §21).

-- ══════════ QUESTIONS ══════════

CREATE TABLE questions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  raw_text           TEXT NOT NULL,
  title              VARCHAR(160),
  topic_id           INTEGER REFERENCES topics(id),
  subtopic_id        INTEGER REFERENCES topics(id),
  difficulty         SMALLINT,
  estimated_level    SMALLINT,
  teacher_brief      TEXT,
  llm_confidence     NUMERIC(3,2),
  classification_ok  BOOLEAN DEFAULT TRUE,
  rejected_by        UUID[] DEFAULT '{}',      -- teachers who declined
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE question_attachments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID REFERENCES questions(id) ON DELETE CASCADE,
  file_url    TEXT NOT NULL,
  mime_type   VARCHAR(60)
);

-- ══════════ SESSIONS ══════════

CREATE TYPE session_status AS ENUM
  ('PENDING','OFFER_SENT','ACTIVE','ENDED','RATED','CANCELLED','NO_SHOW');

CREATE TABLE sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id      UUID UNIQUE REFERENCES questions(id) ON DELETE CASCADE,
  student_id       UUID REFERENCES users(id),
  teacher_id       UUID REFERENCES users(id),
  status           session_status DEFAULT 'PENDING',
  price_per_block  INTEGER,                -- snapshot — price can't change mid-session
  budget_cap       INTEGER DEFAULT 40,
  blocks_used      SMALLINT DEFAULT 0,
  total_charged    INTEGER DEFAULT 0,
  platform_fee     INTEGER DEFAULT 0,
  teacher_earning  INTEGER DEFAULT 0,
  video_room_url   TEXT,                   -- the Daily room URL the client joins
  video_room_name  VARCHAR(120),           -- Daily's room id, needed to mint tokens
  started_at       TIMESTAMPTZ,
  ends_at          TIMESTAMPTZ,            -- when the current block ends
  ended_at         TIMESTAMPTZ,
  end_reason       VARCHAR(40),            -- student_ended|no_extension|no_credit|budget_cap|teacher_no_show|error
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_active ON sessions(status) WHERE status = 'ACTIVE';

CREATE TABLE session_blocks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID REFERENCES sessions(id) ON DELETE CASCADE,
  block_number SMALLINT,
  minutes      SMALLINT,          -- 10 for opening, 5 for extensions
  amount       INTEGER,
  started_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE offers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID REFERENCES sessions(id) ON DELETE CASCADE,
  teacher_id   UUID REFERENCES users(id),
  status       VARCHAR(20) DEFAULT 'PENDING',  -- PENDING|ACCEPTED|REJECTED|EXPIRED
  expires_at   TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_offers_pending ON offers(expires_at) WHERE status = 'PENDING';

-- ══════════ FEEDBACK ══════════

CREATE TABLE reviews (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  student_id  UUID REFERENCES users(id),
  teacher_id  UUID REFERENCES users(id),
  is_resolved BOOLEAN NOT NULL,         -- the core KPI
  stars       SMALLINT CHECK (stars BETWEEN 1 AND 5),
  comment     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════ MONEY ══════════

CREATE TABLE wallets (
  user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance    INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TYPE tx_type AS ENUM
  ('TOPUP','SESSION_CHARGE','REFUND','TEACHER_EARNING','PAYOUT','PROMO');

CREATE TABLE wallet_transactions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES users(id),
  type           tx_type NOT NULL,
  amount         INTEGER NOT NULL,        -- positive = credit, negative = debit
  balance_after  INTEGER NOT NULL,
  session_id     UUID REFERENCES sessions(id),
  note           TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
-- append-only. No UPDATE, no DELETE. Ever.

CREATE TABLE payouts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id   UUID REFERENCES users(id),
  amount       INTEGER NOT NULL,
  status       VARCHAR(20) DEFAULT 'PENDING',
  period_start DATE,
  period_end   DATE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- No entrance_questions or entrance_attempts. The entrance exam is out of MVP as
-- of the 8/11 revision — signup is open and level_max is self-declared (§6.1).
```

### 11.3 The three critical transactions

**A. Sending an offer — atomic teacher lock**

```sql
BEGIN;
  UPDATE teacher_profiles
     SET status = 'OFFER_LOCKED'
   WHERE user_id = $1 AND status = 'ONLINE';
  -- rowCount === 0  →  ROLLBACK + 409 "Teacher is no longer available"

  INSERT INTO offers (session_id, teacher_id, expires_at)
  VALUES ($2, $1, NOW() + INTERVAL '60 seconds');

  UPDATE sessions SET status = 'OFFER_SENT' WHERE id = $2;
COMMIT;
```

**B. Charging a block**

```sql
BEGIN;
  SELECT balance FROM wallets WHERE user_id = $student FOR UPDATE;
  -- balance < amount  →  ROLLBACK + end session

  UPDATE wallets SET balance = balance - $amount WHERE user_id = $student;
  INSERT INTO wallet_transactions (user_id, type, amount, balance_after, session_id) ...;

  INSERT INTO session_blocks (...) VALUES (...);
  UPDATE sessions
     SET blocks_used = blocks_used + 1,
         total_charged = total_charged + $amount,
         ends_at = ends_at + ($minutes || ' minutes')::INTERVAL
   WHERE id = $session;
COMMIT;
```

**C. Ending a session — crediting the teacher**

```sql
BEGIN;
  UPDATE sessions SET status='ENDED', ended_at=NOW(), end_reason=$r,
         platform_fee = $fee, teacher_earning = $earning WHERE id = $1;

  UPDATE wallets SET balance = balance + $earning WHERE user_id = $teacher;
  INSERT INTO wallet_transactions (...TEACHER_EARNING...);

  UPDATE teacher_profiles SET status='ONLINE', sessions_count = sessions_count+1
   WHERE user_id = $teacher;
COMMIT;
```

**Principle:** every balance change goes through `wallet_transactions`. If the balance in `wallets` doesn't equal the sum of transactions, that's a bug — and one query finds it.

---

## 12. Server Endpoints

**Base:** `/api/v1` · **Auth:** `Authorization: Bearer <access_token>`

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | — | Register (`role`: student/teacher) |
| POST | `/auth/login` | — | Returns access + refresh |
| POST | `/auth/refresh` | — | Token renewal |
| POST | `/auth/logout` | ✓ | |
| GET | `/auth/me` | ✓ | Current profile |

### Public / Guest

| Method | Path | Description |
|---|---|---|
| GET | `/public/teachers/online` | Currently available teachers (no PII) |
| GET | `/public/teachers/:id` | Public profile + reviews |
| GET | `/public/topics` | Topic tree |
| GET | `/public/pricing` | How blocks and pricing work (§5) |

### Student

| Method | Path | Description |
|---|---|---|
| GET | `/students/me` | Profile + balance |
| PATCH | `/students/me` | Update (grade, level) |
| GET | `/students/me/sessions` | Paginated history |

### Teacher

| Method | Path | Description |
|---|---|---|
| GET | `/teachers/me` | Full profile |
| PATCH | `/teachers/me` | Bio, `price_per_block` (₪5–20), `level_max` |
| PUT | `/teachers/me/topics` | Update specialty topics |
| PATCH | `/teachers/me/status` | `{status: ONLINE\|OFFLINE}` |
| POST | `/teachers/me/heartbeat` | Prevents auto-away |
| GET | `/teachers/me/earnings` | Earnings + breakdown |
| GET | `/teachers/me/stats` | Per-topic ratings |

### Questions & Matching

| Method | Path | Description |
|---|---|---|
| POST | `/questions` | **The core.** Create + LLM classify + create session in PENDING |
| POST | `/questions/:id/attachments` | Image upload |
| PATCH | `/questions/:id/classification` | Student's manual correction |
| GET | `/questions/:id/matches` | **Top 5 ranked teachers.** `?priceBand=A\|B\|C` applies the student's price ceiling (§5.2). Re-callable = "show me more teachers" |

### Sessions & Offers

| Method | Path | Description |
|---|---|---|
| POST | `/sessions/:id/offer` | `{teacherId}` → atomic lock + socket + email |
| POST | `/offers/:id/accept` | ← teacher. Creates the Daily room, charges 2 blocks, `ACTIVE` |
| POST | `/offers/:id/reject` | ← teacher. Releases lock, appends to `rejected_by` |
| GET | `/sessions/:id` | Full state + time remaining |
| GET | `/sessions/:id/video` | `{roomUrl, token}` — a short-lived meeting token for **this** caller. `404` unless they are a participant in an `ACTIVE` session |
| POST | `/sessions/:id/extend` | ← student. Charge block + extend `ends_at` |
| POST | `/sessions/:id/end` | Manual end |
| POST | `/sessions/:id/report-no-show` | ← student, within 60s. Full refund |
| POST | `/sessions/:id/review` | `{isResolved, stars, comment}` → update stats |

### Wallet

| Method | Path | Description |
|---|---|---|
| GET | `/wallet` | Balance + "≈ X minutes" |
| POST | `/wallet/topup` | `{packageId}` — mock, credits immediately |
| GET | `/wallet/transactions` | Paginated ledger |

### Admin

| Method | Path | Description |
|---|---|---|
| GET | `/admin/sessions` | All sessions + filters |
| PATCH | `/admin/users/:id/status` | Block/unblock |

### Unified error format

```json
{
  "success": false,
  "error": {
    "code": "TEACHER_UNAVAILABLE",
    "message": "That teacher is no longer available. Here are others.",
    "details": null
  }
}
```

**Primary error codes:** `VALIDATION_ERROR` · `UNAUTHORIZED` · `FORBIDDEN` · `NOT_FOUND` · `TEACHER_UNAVAILABLE` · `INSUFFICIENT_CREDIT` · `OFFER_EXPIRED` · `SESSION_NOT_ACTIVE` · `BUDGET_CAP_REACHED` · `LLM_FAILED` · `EXTERNAL_SERVICE_ERROR` · `INTERNAL_ERROR`

---

## 13. Real-Time Events

**Socket.IO**, authenticated in the handshake with the JWT. Rooms: `user:{userId}` · `session:{sessionId}`.

### Server → Client

| Event | Recipient | Payload |
|---|---|---|
| `offer:new` | teacher | `{offerId, questionTitle, brief, topic, level, expectedEarning, expiresAt}` |
| `offer:expired` | teacher | `{offerId}` |
| `offer:accepted` | student | `{offerId, sessionId}`. **No room URL on the wire** — the student's screen fetches `GET /sessions/:id/video`, because a token is per-caller and an event is not |
| `offer:rejected` | student | `{sessionId}` |
| `session:block_warning` | student | `{secondsLeft: 60, extensionPrice, balanceAfter}` |
| `session:extended` | both | `{blocksUsed, endsAt, totalCharged}` |
| `session:ended` | both | `{reason, totalCharged, duration}` |
| `teacher:status` | students in selection | `{teacherId, status}` |
| `wallet:updated` | user | `{balance}` |

### Client → Server

| Event | Payload |
|---|---|
| `teacher:heartbeat` | `{}` |
| `session:join` | `{sessionId}` |

### Background jobs (`node-cron`, every 10 seconds)

1. **Offer Expiry** — expired `offers` → `EXPIRED`, release teacher, emit `offer:expired`
2. **Block Warning** — sessions at `ends_at - 60s` → emit `session:block_warning`
3. **Session Auto-End** — sessions past `ends_at + 30s` → end + credit teacher
4. **Auto-Away** — ONLINE teachers with `last_seen_at` > 60 min → OFFLINE

---

## 14. Screens & Navigation

### 14.1 Route tree

```
/                          Landing (guest)
/teachers                  Available teachers (guest)
/teachers/:id              Teacher profile + reviews (guest)
/pricing                   Pricing explanation (guest)
/login  /register

── Student (ProtectedRoute role=student) ──
/app                       Dashboard: balance · "I'm stuck" · recent sessions
/app/ask                   Question form (text + image)
/app/ask/:id/matching      Classification waiting screen
/app/ask/:id/teachers      Teacher selection (5 cards)
/app/session/:id           Active session
/app/session/:id/review    Rating (mandatory)
/app/wallet                Balance · top-up · transactions
/app/history               Question history

── Teacher (ProtectedRoute role=teacher) ──
/teach                     Dashboard: availability toggle · earnings · rating
/teach/onboarding          Topics + level + price
/teach/session/:id         Active session
/teach/earnings            Earnings breakdown
/teach/profile             Edit bio · price · level · topics

── Admin ──
/admin/sessions            All sessions
```

### 14.2 The critical screen — teacher selection

This screen determines whether the product works. Worth more investment than any other screen.

```
┌──────────────────────────────────────────────────────┐
│  📐 Integration by parts · 5 units      [edit topic]  │
│  💰 Your balance: ₪96                                 │
│  Price up to:  [ ₪9 ]  [ ₪14 ]  [ ₪20 ✓ ]            │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌────────────────────────────────────────────────┐ │
│  │ ⭐ Dana K.       ⭐ 4.8 (32)                    │ │
│  │ Top · solved 12 questions in Integrals          │ │
│  │ ✅ 91% resolved · ⏱ responds in ~20s            │ │
│  │ ₪16 / 5 min      Your credit = 30 minutes       │ │
│  │                              [ Send request ]   │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  ┌────────────────────────────────────────────────┐ │
│  │ 🔵 Yossi M.      ⭐ 4.6 (18)   💙 studied with   │ │
│  │ Active · solved 7 questions in Integrals        │ │
│  │ ₪12 / 5 min      Your credit = 40 minutes       │ │
│  │                              [ Send request ]   │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  ... 3 more ...                                       │
│                                                      │
│              [ 🔄 Show me more teachers ]             │
└──────────────────────────────────────────────────────┘
```

**Design decisions:**
- Credit is **always translated into minutes** — the student thinks "how much help," not "how much money"
- Specialty shown **per topic**, not globally — this is what justifies the algorithm
- 💙 "studied with" badge — continuity is the strongest selection signal
- **No algorithm scores on screen.** The student sees an order, not grades
- The price control is a **ceiling, expressed in money** — "up to ₪14", not "band B". The student is choosing a budget, and the band letters are an implementation detail they never need to learn
- Badges say what the teacher has **done here** (§6.2), never what they claim to be. Anything self-reported sits in the bio on the profile screen, in the teacher's own words

### 14.3 Active session screen

```
┌──────────────────────────────────────────────────────┐
│  🎥 In session with Dana              ⏱  03:42        │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░  block 1 of 2                 │
│                                                      │
│  [ the call, embedded — Daily prebuilt iframe ]      │
│                                                      │
│  💰 Charged so far: ₪32  ·  Balance: ₪64             │
│  🎯 Budget cap: ₪40                                   │
│                                                      │
│  [ We're done — end session ]                        │
└──────────────────────────────────────────────────────┘

── at T-60 seconds ──
┌────────────────────────────────────┐
│  ⏱ One minute left                 │
│  Extend by 5 minutes?  (+₪16)      │
│  Balance after: ₪48                 │
│  [ Yes, extend ]   [ No, we're done ]│
│  No choice — the session will close │
└────────────────────────────────────┘
```

### 14.4 Responsive

Mobile-first. The student arrives from a phone while working from a notebook.

| Breakpoint | Adaptation |
|---|---|
| `< 768px` | Single column · bottom navigation · full-width teacher cards · camera as default for image upload |
| `768–1024px` | 2 columns · collapsible sidebar |
| `> 1024px` | 3 columns · fixed sidebar |

---

## 15. Technical Architecture

### 15.1 Stack

| Layer | Technology |
|---|---|
| Client | React 18 + Vite · React Router v7 · **Zustand** · Mantine v7 · Socket.IO client · Axios |
| Server | Node 24 + Express · MVC · Socket.IO · **Zod** · JWT + bcrypt · node-cron |
| DB | PostgreSQL 16 + **Prisma** |
| Storage | Cloudinary (question images) |
| AI | Anthropic Claude API (Vision + JSON mode) |
| Video | **Daily** — REST (`/rooms`, `/meeting-tokens`) server-side, `@daily-co/daily-js` + `@daily-co/daily-react` prebuilt iframe on the client |
| Email | Resend / Nodemailer |
| Deploy | Client → Vercel · Server → Render · DB → Neon |

**Why Zustand over Redux:** genuinely complex state (timer, socket, wallet) without boilerplate. Still fully satisfies the "State Management" requirement.

### 15.2 Server structure — strict layering

```
server/
├── src/
│   ├── config/            env, db, video, cloudinary
│   ├── routes/            route definitions only
│   ├── controllers/       req/res only. Zero business logic
│   ├── services/          ★ all business logic
│   │   ├── auth.service.js
│   │   ├── matching.service.js      ← the algorithm
│   │   ├── session.service.js       ← the state machine
│   │   ├── wallet.service.js        ← all money. Single entry point
│   │   ├── llm.service.js
│   │   ├── video.service.js
│   │   └── rating.service.js
│   ├── repositories/      DB access only
│   ├── middlewares/       auth, role, validate, errorHandler, rateLimit
│   ├── validators/        Zod schemas
│   ├── sockets/           handlers + emitters
│   ├── jobs/              cron
│   ├── utils/             AppError, logger, constants
│   └── app.js
```

**Iron rules:**
1. Controllers never touch the DB. Ever
2. Services never know about `req`/`res`
3. **Every balance change goes through `wallet.service`.** No exceptions
4. Every session state change goes through `session.service`

### 15.3 End-to-end error handling

**Server:**

```js
// utils/AppError.js
class AppError extends Error {
  constructor(code, message, statusCode = 400, details = null) {
    super(message);
    this.code = code; this.statusCode = statusCode;
    this.details = details; this.isOperational = true;
  }
}

// middlewares/errorHandler.js — last in app.js
export function errorHandler(err, req, res, next) {
  const isOp = err.isOperational;
  if (!isOp) logger.error({ err, path: req.path, userId: req.user?.id });

  res.status(err.statusCode || 500).json({
    success: false,
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: isOp ? err.message : 'Something went wrong. Please try again.',
      details: err.details ?? null,
    },
  });
}
```

`asyncHandler` wraps every controller so rejections reach the middleware. Zod validation → `VALIDATION_ERROR` with per-field `details`.

**Client:**

| Layer | Handling |
|---|---|
| Axios interceptor | 401 → refresh, and on failure → logout · others → normalized `AppError` |
| ErrorBoundary | React crash → fallback screen |
| Notifications (Mantine) | Every server `error.message` shown as a toast |
| Inline | `VALIDATION_ERROR.details` → message under the field |
| Empty states | "No teachers available right now" + CTA to be notified |
| Socket | Disconnect → "Reconnecting..." banner + auto reconnect |

### 15.4 Scale-up principles

Things built correctly now that won't need rewriting:

| Decision | Why it holds |
|---|---|
| `matching.service` isolated | Swapping to ML or Elasticsearch = one file |
| Append-only ledger | Full financial auditability from day one |
| Denormalized `teacher_topic_stats` | Matching doesn't compute aggregations at runtime |
| Partial index on `status='ONLINE'` | A teacher table growing to 100K doesn't slow the query |
| `price_per_block` snapshot on session | Price changes don't rewrite history |
| Topics in a table, not a code enum | Adding a subject = DB rows, not a deploy |
| Cron isolated in `jobs/` | Moving to BullMQ/Redis is swapping the runner |
| Per-user socket rooms | Redis adapter for multiple instances = 3 lines |
| `llm.service` behind an interface | Changing AI provider doesn't touch the rest |

**What breaks first at scale (known and documented):**
1. Cron every 10s on a single instance → BullMQ + Redis
2. In-memory Socket.IO → Redis adapter
3. In-memory cached `getPlatformAverages()` → Redis
4. Matching computed in code → materialized view / dedicated search

### 15.5 Security

bcrypt (12 rounds) · 15-minute access token + 7-day refresh in an httpOnly cookie · `authorize(...roles)` middleware · rate limiting on login/register/questions · Helmet + CORS whitelist · Prisma (prevents SQL injection) · file type and size limits · **no secrets on the client** — Daily, LLM, and Cloudinary calls go through the server only, and a meeting token is minted per caller and never reused

---

## 16. Course Requirements Mapping

### Client (React)

| Requirement | Implementation |
|---|---|
| React Router | 20+ routes · role-based `ProtectedRoute` · nested layouts · post-login redirect |
| State Management | Zustand: `authStore` · `sessionStore` (timer + socket) · `walletStore` · `matchingStore` |
| Mantine | Cards, Modal, Notifications, Stepper (onboarding), FileInput, Progress, Badge, Rating, AppShell |
| Responsive | Mobile-first · 3 breakpoints · bottom nav on mobile |
| Full error handling | Interceptor + ErrorBoundary + toasts + inline errors + empty states |

### Server (Express)

| Requirement | Implementation |
|---|---|
| MVC | routes → controllers → services → repositories, strictly layered |
| Auth & Authorization | JWT + refresh · 3 roles · `authorize()` middleware · resource ownership checks |
| Data Validation | Zod on every body/params/query, schemas in `validators/` |
| Unified error handling | `AppError` + `asyncHandler` + single errorHandler + error codes |
| SQL | PostgreSQL + Prisma · 15 tables · transactions · partial indexes |
| External storage | Cloudinary — question images |

### General

| Requirement | Implementation |
|---|---|
| Deployment | Vercel + Render + Neon |
| External API | **Daily API** (room + meeting-token creation) + **Cloudinary** + email service |
| AI Integration | **Claude API** — question classification (Vision + JSON) and teacher briefs |
| Innovation | The algorithm: a closed LLM→rating→matching loop. Not CRUD |

---

## 17. Working Method: Agent-Assisted Development

This project is built by **2 developers working with AI coding agents**. That is a deliberate methodology choice, and it shapes the repository structure, the PR sizing, and the review process.

### 17.1 Core principle

> **Agents write code. Humans own the contracts.**

An agent is excellent at implementing a well-specified unit and poor at inventing conventions. Therefore: every shared contract — DB schema, error format, API shapes, constants, type definitions — is written by a human **first**, and every agent works against it. Without this, two agents produce two incompatible codebases within a day.

### 17.2 Repository setup (Day 1, before any feature work)

These land before a single feature PR:

| Artifact | Purpose |
|---|---|
| `docs/MVP.md` | **This document.** The context every agent gets |
| `prisma/schema.prisma` | Generates the types every agent codes against |
| `src/utils/constants.js` | Every magic number in the system. No literals in code |
| `src/utils/AppError.js` + error codes | Without this, each agent invents its own error format |
| `src/types/api.d.ts` | Request/response shapes shared by client and server |
| `CONVENTIONS.md` | Naming, folder rules, import order, commit format |
| `.env.example` | So agents never guess env var names |
| ESLint + Prettier | Non-negotiable. Removes an entire class of review comments |

### 17.3 The agent workflow per PR

```
1. HUMAN    Reads the epic, picks the next PR from the list
2. HUMAN    Writes the PR brief:
              - which files may be touched
              - which contract it implements (endpoint / event / table)
              - acceptance criteria
              - explicit "do not touch" list
3. AGENT    Implements on a dedicated branch
4. HUMAN    Reviews against the checklist below
5. HUMAN    Manually tests the acceptance criteria
6. MERGE    Squash into main. Main is always deployable
```

### 17.4 Review checklist (every PR)

- [ ] No magic numbers — everything from `constants.js`
- [ ] No DB access in a controller
- [ ] No `req`/`res` in a service
- [ ] Every error thrown is an `AppError` with a known code
- [ ] Every endpoint has a Zod validator
- [ ] Every balance change goes through `wallet.service`
- [ ] No secrets or API keys reached the client bundle
- [ ] Loading and error states exist on any new screen
- [ ] Tested on a 375px viewport
- [ ] Doesn't touch files outside the declared scope

### 17.5 What agents must not write unassisted

| Area | Why | Rule |
|---|---|---|
| `wallet.service.js` | A bug here creates or destroys real money | **Human-written.** Agent may write tests for it |
| The three critical transactions | Race conditions are invisible in code review and only appear under concurrency | **Human-written**, manually tested with two browsers |
| `prisma/schema.prisma` | Every agent depends on it; a change ripples everywhere | **Human-owned.** Migrations only by agreement between both developers |
| Auth middleware | Security-critical, and a subtle bug is silent | Human-written, agent may extend |
| Prompts in `llm.service` | Output shape is a contract the algorithm depends on | Human-written and iterated by hand |

Everything else — screens, controllers, repositories, forms, tables, cron jobs, seeds — is agent territory.

### 17.6 Working with two people

| Track | Owner A | Owner B |
|---|---|---|
| Primary | **Client** — React, Router, Zustand, Mantine, all screens, responsive, error UX | **Server + Integrations** — Express MVC, Prisma, auth, wallet, LLM, video, Socket.IO, cron, matching, deployment |
| Also owns | Client contracts (`api.d.ts` consumption), demo script | DB schema, `constants.js`, `AppError` |

Track B is heavier, so **client PRs are the ones to hand to agents most aggressively** — screens are the most agent-friendly work in the repo, and Owner A spends their time on review and on the two screens that actually matter (teacher selection, active session).

> **If there is a third team member:** split Track B into **Server** (Express, Prisma, auth, wallet, admin) and **Integrations** (LLM, video, Socket.IO, cron, matching, deployment). Epics E4, E5, E6, and the LLM parts of E3 move to the Integrations owner. The epic list below is written to make this split clean — each epic already sits on one side of that line.

### 17.7 Conflict avoidance

- **One epic in flight per owner.** Two agents editing the same folder is the single fastest way to lose a day
- **Feature-flag partial work** rather than long-lived branches. A branch older than 24 hours is a merge problem
- **Sync at the start and end of each day** — 10 minutes, on contracts only: did anything change in the schema, constants, or endpoint shapes
- **Main is always deployable.** If it isn't, that's the only priority

---

## 18. Epics & PR Breakdown

Eleven epics. Each PR is sized **S** (< 2 hours), **M** (2–4 hours), or **L** (half a day+).

---

### E0 — Foundation & Infrastructure
**Owner:** B · **Blocks:** everything · **Definition of done:** both developers can run the project locally, and a hello-world deploy is live

| # | PR | Size | Notes |
|---|---|---|---|
| 0.1 | Monorepo scaffold (client + server), ESLint, Prettier, `CONVENTIONS.md` | M | |
| 0.2 | `prisma/schema.prisma` — full schema, first migration | L | **Human-written.** Everything depends on it |
| 0.3 | `constants.js`, `AppError`, error codes, `asyncHandler`, `errorHandler` | M | **Human-written** |
| 0.4 | Express skeleton, health endpoint, CORS, Helmet, rate limiting | S | |
| 0.5 | React skeleton, Mantine theme, router shell, Axios instance + interceptor | M | |
| 0.6 | Seed script: topics tree, 15 demo teachers with history | M | Critical for the demo |
| 0.7 | Deploy pipeline — Vercel + Render + Neon, `.env.example` | M | Do it now, not on day 10 |

---

### E1 — Auth & Users
**Owner:** B (server) + A (client) · **Depends on:** E0

| # | PR | Size | Notes |
|---|---|---|---|
| 1.1 | Register/login/refresh/logout + bcrypt + JWT | L | **Human-written** |
| 1.2 | `authenticate` + `authorize(...roles)` middlewares | S | **Human-written** |
| 1.3 | Zod validators for auth + wiring into the error format | S | Sets the pattern for all later validators |
| 1.4 | Auth screens (login, register with role selection) | M | Agent |
| 1.5 | `authStore` (Zustand) + `ProtectedRoute` + post-login redirect | M | Agent |
| 1.6 | Wallet auto-created on registration | S | |

**Acceptance:** a student registers, logs in, refreshes the page, and stays logged in. A student hitting `/teach` is redirected.

---

### E2 — Teacher Onboarding
**Owner:** B · **Depends on:** E1

Halved by the 8/11 revision: the exam, academic email and document queue are out of
MVP (§6.1), so this epic is now profile, topics, price and standing.

| # | PR | Size | Notes |
|---|---|---|---|
| 2.1 | Teacher profile CRUD + topic selection + `price_per_block` (₪5–20) + `level_max` | M | |
| 2.2 | Standing badge computed from `sessions_count` + rating (§6.2) | S | Pure function, easy to unit-test |
| 2.3 | Onboarding UI — Mantine Stepper: topics → level → price | M | Agent |
| 2.4 | Teacher profile edit screen | M | Agent |

**Acceptance:** a new teacher registers, picks topics, declares a level, sets a price, goes online, and appears in the teacher list carrying the `New` badge.

---

### E3 — Question Intake & LLM Classification
**Owner:** B (LLM) + A (form) · **Depends on:** E1

| # | PR | Size | Notes |
|---|---|---|---|
| 3.1 | Cloudinary integration + image upload endpoint | M | |
| 3.2 | `llm.service` — classification prompt + Zod output schema + timeout | L | **Human-written prompt** |
| 3.3 | Fallback path — parse failure / low confidence → `topic_id=0`, flow continues | S | Never let classification block |
| 3.4 | `POST /questions` — create + classify + create session in PENDING | M | |
| 3.5 | `PATCH /questions/:id/classification` — manual student override | S | |
| 3.6 | Question form UI — text + image, camera-first on mobile | M | Agent |
| 3.7 | Classification waiting screen + confirmation step | M | Agent |

**Acceptance:** a student photographs an exercise and within 5 seconds sees a correct topic/level classification, with the option to correct it.

---

### E4 — Matching Engine
**Owner:** B · **Depends on:** E2, E3 · **This is the differentiator**

| # | PR | Size | Notes |
|---|---|---|---|
| 4.1 | Hard-filter SQL + partial index | M | |
| 4.2 | `bayesian()` helper + `getPlatformAverages()` with 5-min cache | S | |
| 4.3 | `matching.service` — full scoring per §9.2 | L | |
| 4.4 | `GET /questions/:id/matches` + `rejected_by` exclusion | M | |
| 4.5 | **Teacher selection screen** — the most important screen in the product | L | Agent, but reviewed hard |
| 4.6 | Credit-to-minutes translation across all teacher cards | S | |

**Acceptance:** with 15 seeded teachers, an integrals question surfaces integrals specialists first, and a teacher with one 5-star rating ranks below a teacher with 4.6 across 40.

---

### E5 — Offers & Real-Time Presence
**Owner:** B · **Depends on:** E4

| # | PR | Size | Notes |
|---|---|---|---|
| 5.1 | Socket.IO setup + JWT handshake auth + per-user rooms | M | |
| 5.2 | Availability toggle + heartbeat + `last_seen_at` | S | |
| 5.3 | **`POST /sessions/:id/offer` — atomic teacher lock** | M | **Human-written.** Test with two browsers |
| 5.4 | Accept / reject + lock release + `rejected_by` | M | |
| 5.5 | Cron: offer expiry + auto-away | M | |
| 5.6 | Email notification to teacher on new offer | S | |
| 5.7 | Teacher dashboard — availability toggle + incoming offer modal with brief | L | Agent |
| 5.8 | Student "awaiting response" screen + 60s countdown + refresh | M | Agent |

**Acceptance:** two students send an offer to the same teacher simultaneously — exactly one succeeds, the other gets `TEACHER_UNAVAILABLE` and a refreshed list.

---

### E6 — Session Lifecycle & Video
**Owner:** B, wearing all three hats · **Depends on:** E5 (5.1–5.11 merged) · **Does not depend on E7** — see the amendment below

| # | PR | Size | Notes |
|---|---|---|---|
| 6.0 | Migration: `zoom_*` → `video_room_name` / `video_room_url` | S | Hand-edited `RENAME COLUMN`, not Prisma's drop-and-add |
| 6.1 | Import `origin/dev-c/daily-video` — `video.service`, `VideoRoom.jsx` | S | **Not L.** The provider code is written and reviewed; this PR carries it and drops its two unauthenticated endpoints |
| 6.2 | `session.service` — full state machine, frozen routes and repository | L | **Human-written.** The epic's blocking core PR |
| 6.3 | Session activation + `createSessionVideo` persistence | M | Room created **after** commit, never inside the transaction |
| 6.4 | `getSessionVideoContext` + `GET /sessions/:id/video` | S | The seam. `404`, never `403`, for a non-participant |
| 6.5 | `wallet.service` + opening charge + `POST /sessions/:id/extend` + the two meter crons | L | **Human-written.** Money |
| 6.6 | End, no-show refund, review → `RATED`, teacher earning credited | M | **Human-written.** Money |
| 6.7 | The session room — one screen, both roles, `<VideoRoom/>` mounted | L | Agent. `ends_at` is server truth |
| 6.8 | Error-state hardening (`SESSION_NOT_ACTIVE`, no API key, dead token, walk-out) + E2E lifecycle tests | M | Agent |
| 6.9 | E6 close: verification + retro, and E5's four deferred items | S | Human |

**Acceptance:** a full session runs end to end: the two participants see and hear each other **inside the page**, the timer counts down, the extension modal appears at T-60s, declining ends the session, the charge matches what was displayed, and the rating moves the teacher's aggregates.

**Amendment 1 — the provider is Daily, not Zoom, and it is already written.** `origin/dev-c/daily-video` creates private rooms and mints per-caller meeting tokens against Daily's REST API, and embeds the call with `@daily-co/daily-react`. 6.1 imports it rather than writing it, which is why E6 is a *smaller* epic than §18 first estimated and why the "highest-risk PR in the project" label is retired (§20). The seam between the video layer and the session layer is `OWNERSHIP.md` §2.1.

**Amendment 2 — E6 does not wait for E7, it creates the part of E7 it needs.** §18 wrote E6 as depending on E7, and E7 does not exist. Rather than block the epic or fake the charge, **6.5 creates `wallet.service.js` with exactly three operations** — charge a student for a block, credit a teacher's earning, refund a session — each one transaction against `wallets` plus one append to `wallet_transactions`. It is human-written per §17.5. E7 then adds top-up, the ledger endpoints and the wallet screen **on top of** that service rather than beside it.

**Amendment 3 — a minimal review write is E6's, not E8's.** §10's diagram makes `ENDED → RATED` mandatory, so a session cannot reach its terminal state without one. 6.6 writes the `reviews` row and bumps `resolved_count`, `rating_sum` and `rating_count`. **E8 keeps everything that reads them** — the badge, the history screen, the reputation surfaces — and E6 adds no screen beyond the modal that blocks the way out of a session.

### E7 — Wallet & Billing
**Owner:** B · **Depends on:** E1 · **Highest-care epic**

| # | PR | Size | Notes |
|---|---|---|---|
| 7.1 | `wallet.service` — single money entry point + ledger | L | **Human-written, no agent** |
| 7.2 | Block charging transaction with `FOR UPDATE` | M | **Human-written** |
| 7.3 | Teacher earnings + platform fee + commission rules | M | |
| 7.4 | Refunds — no-show, technical failure, early exit | M | |
| 7.5 | `POST /wallet/topup` (mock) + packages | S | |
| 7.6 | Reconciliation query — balance vs. transaction sum | S | Run it before the demo |
| 7.7 | Wallet UI — balance in minutes, top-up, transaction list | M | Agent |
| 7.8 | Teacher earnings screen | M | Agent |

**Acceptance:** after 20 mixed operations, `wallets.balance` equals the sum of `wallet_transactions.amount` for every user. No exceptions.

---

### E8 — Ratings & Reputation
**Owner:** B · **Depends on:** E6 · **Closes the loop**

| # | PR | Size | Notes |
|---|---|---|---|
| 8.1 | `POST /sessions/:id/review` + validation | S | |
| 8.2 | `rating.service` — update `teacher_topic_stats` with 0.3 parent propagation | M | |
| 8.3 | Update denormalized aggregates on `teacher_profiles` | S | |
| 8.4 | Mandatory rating screen — blocked navigation, skip after 10s | M | Agent |
| 8.5 | Public teacher profile + reviews (guest-accessible) | M | Agent |
| 8.6 | Session history screen (student) | M | Agent |

**Acceptance:** rating a teacher 5 stars on an integrals question measurably raises their rank for the next integrals question — and slightly raises it for other calculus questions.

---

### E9 — Admin & Moderation
**Owner:** B · **Depends on:** E2

| # | PR | Size | Notes |
|---|---|---|---|
| 9.1 | Admin endpoints — sessions list, block/unblock user | S | |
| 9.2 | Admin session table with filters | S | Agent |

**Acceptance:** an admin blocks a user, and that user can no longer log in or be matched.

---

### E10 — Responsive, Error UX & Polish
**Owner:** A · **Depends on:** E4, E6, E8 · **Do not defer to the last day**

| # | PR | Size | Notes |
|---|---|---|---|
| 10.1 | Landing page + pricing page (guest) | M | Agent |
| 10.2 | Public online-teachers list (guest) | S | Agent |
| 10.3 | Mobile pass — bottom nav, 375px audit on every screen | L | |
| 10.4 | Global error UX — toasts, ErrorBoundary, inline field errors | M | |
| 10.5 | Empty states + loading skeletons across all lists | M | Agent |
| 10.6 | Socket disconnect banner + auto-reconnect | S | |

**Acceptance:** every screen is usable at 375px, and every failure path shows something human-readable rather than a blank screen.

---

### E11 — Deployment & Demo
**Owner:** A + B · **Depends on:** everything

| # | PR | Size | Notes |
|---|---|---|---|
| 11.1 | Production env config + secrets + CORS for the real domain | M | |
| 11.2 | Production seed — demo teachers with plausible histories | M | |
| 11.3 | Full E2E smoke test on production | M | Both developers, two laptops |
| 11.4 | Demo script + slide deck | M | |

**Demo narrative (7 minutes):** two laptops · student photographs an exercise → classification → 5 ranked teachers → teacher receives the brief → accepts → the call opens in the page → extension modal → end → credit moves → rating → the teacher's integrals ranking visibly changes.

---

### Epic dependency graph

```
E0 ──┬── E1 ──┬── E2 ──┬── E4 ── E5 ── E6 ──┬── E7 ── E10 ── E11
     │        │        │                     │
     │        ├── E3 ──┘                     └── E8 ──┘
     │        │
     └────────┴───────── E9 (parallel, low priority)
```
**The E6 ← E7 arrow is reversed as of E6's planning.** §18's E6 block has the reasoning:
E7 did not exist when E6 needed to charge a block, so 6.5 creates the three wallet
operations a session needs and E7 builds its top-up, ledger and screen on top of them.
E8 likewise now follows E6 rather than needing to precede its rating write.

**Critical path:** E0 → E1 → E3 → E4 → E5 → E6 → E8. Anything off this path is cuttable.

---

## 19. Timeline & Checkpoints

| Date | Owner A (Client) | Owner B (Server + Integrations) |
|---|---|---|
| **Sun 8/9** | E0.5 — React skeleton, Mantine theme, router | E0.1–0.4 — schema, migration, constants, AppError |
| **Mon 8/10** | E1.4–1.5 — auth screens, authStore | E0.6–0.7, E1.1–1.3 — seed, deploy, auth |
| **Tue 8/11** | E2.3–2.4 — onboarding stepper, profile edit | E2.1–2.2 — profile CRUD, standing badge |
| **Wed 8/12** | E3.6–3.7 — question form, waiting screen | E3.1–3.5 — Cloudinary, LLM, questions |
| **Thu 8/13** | **E4.5 — teacher selection screen** | E4.1–4.4 — matching engine |
| **Fri–Sat** | Buffer / catch-up | Buffer / catch-up |
| **Sun 8/16** | E5.7–5.8 — teacher dashboard, awaiting screen | E5.1–5.6 — sockets, offers, atomic lock, cron |
| **Mon 8/17** | E6.7–6.8 — session screens, timer | E6.1–6.6, E7.1–7.4 — video, state machine, wallet |
| **Tue 8/18** | E8.4–8.6, E7.7–7.8 — rating, wallet, history | E7.5–7.6, E8.1–8.3, E9 — billing, ratings, admin |
| **Wed 8/19** | **E10 — responsive + error UX** | **E11.1–11.3 — deploy + E2E** · **FEATURE CLOSE** |
| **Thu 8/20** | Bug fixes · demo seed · rehearsals · slide deck | |

### Checkpoints

- **8/13 EOD:** a student posts a question and sees 5 ranked teachers. If not → cut E2 down to profile CRUD and seed the rest
- **8/17 EOD:** a full session runs end to end with charging. If not → cut E9 (admin) and E6.6 (refunds)
- **8/19 EOD:** production is live. No new code after this point

---

## 20. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| ~~Zoom API harder than expected~~ **— retired.** The provider is Daily and the integration is written | 🟢 Low | `origin/dev-c/daily-video` already creates rooms and mints meeting tokens against Daily's REST API in ~150 lines. E6 imports it (PR 6.1). The fallback — a static room link on `teacher_profiles.zoom_personal_link` — is still there and is now genuinely unlikely to be needed |
| Race condition in offers | 🔴 High | `UPDATE ... WHERE status='ONLINE'` + `rowCount`. Manually test with two browsers |
| Wallet bug (money duplicated/lost) | 🔴 High | Single transaction + `FOR UPDATE` + `CHECK (balance >= 0)` + reconciliation query |
| Two agents colliding in the same folder | 🔴 High | One epic in flight per owner. Daily contract sync |
| Inconsistent LLM classification | 🟡 Medium | JSON mode + Zod + `topic_id=0` fallback. The flow **never** blocks |
| Demo with no real teachers | 🟡 Medium | Seed 15 teachers with history. Script to flip a teacher online on demand |
| `DAILY_API_KEY` unset or Daily unreachable at accept time | 🟡 Medium | The room is created **after** the accept commits, never inside the transaction. A failure logs, leaves `video_room_*` null, and the session still starts; `GET /sessions/:id/video` retries the creation once on first join. Same shape as E5's email fallback (§17.3) |
| Timer desync | 🟡 Medium | **`ends_at` on the server is the source of truth.** Client only renders `ends_at - now` |
| LLM classification latency | 🟢 Low | Animated waiting screen. 3 seconds with visual feedback feels fine |
| Schedule overrun | 🟡 Medium | Checkpoints on 8/13 and 8/17 with a predefined cut list |

---

## 21. Future Scope

Documented explicitly — part of the value of this document is showing the decisions were deliberate.

### Phase 2 — Near term

1. **Real payments** — Stripe / Tranzila, including teacher payouts
2. **Shared whiteboard** — embedded Excalidraw. Essential for high-quality math instruction
3. **Native video** — LiveKit / Daily.co instead of an external link, including **session recording** for a personal library
4. **Push notifications** — Web Push for teachers instead of email
5. **Anti-stalling mechanism** — `efficiency_score` based on platform median per subtopic: `median_blocks(subtopic, difficulty) / avg_blocks(teacher, subtopic)`. Deliberately deferred because without data mass it would penalize teachers who worked with weaker students
6. **Mid-session topic change detection** — splitting a `Session` into multiple `Question` records. The current model already supports it (`questions` is separate from `sessions`)

### Phase 3 — Safety & trust

**The verification track — everything cut on 8/11, kept together because it is one feature, not three:**

- **Credential verification** — document upload (teaching certificate / transcript) → admin queue → approve or reject with a reason. Surfaces as an additional badge *alongside* standing, never as a gate on signup and never as a price tier. A teacher without a certificate stays a first-class teacher
- **Academic email verification** — 6-digit code to a known academic domain (`tau.ac.il`, `technion.ac.il`, `huji.ac.il`, `bgu.ac.il`, `openu.ac.il`, `biu.ac.il`, `ariel.ac.il`, `hit.ac.il`). Near-zero work, near-impossible to fake, and the cheapest trust signal available
- **Entrance exam** — an LLM-generated bank sampled per attempt, scoring into a `level_max` cap rather than pass/fail. Worth revisiting only if self-declared levels turn out to be inflated in practice, which the rating data will show

Why they were cut: each one is the platform deciding who may teach. The MVP bets that measuring outcomes beats checking paperwork. If that bet fails, this is the ordered list of what to add back — cheapest and least exclusionary first.

7. **Minor safety program** — ID + selfie verification · criminal-record declaration · police clearance certificate · parental consent at registration · post-session summary email to parents · persistent report button · automatic suspension
8. **Private channel blocking** — filter phone numbers and social handles in chat. Protects minors **and** prevents off-platform leakage of students

### Phase 4 — Expansion

9. **Question library + RAG** — every solved question stored with its summary. Produces SEO content, a searchable base, and context for future questions
10. **Personal learning path** — mapping weak topics over time + suggested practice
11. **Additional subjects** — physics, chemistry, English. The taxonomy is already generic
12. **Monthly subscription** — X minutes per month at a fixed price
13. **Dynamic pricing** — demand-based pricing at peak hours
14. **Waiting queue** — when no teacher is available: notify when a matching teacher comes online
15. **Mobile app** — React Native

---

## Appendix: System Constants

```js
// utils/constants.js — every magic number in the system lives here

export const BLOCK_MINUTES        = 5;
export const OPENING_BLOCKS       = 2;      // 10 minutes
export const EXTENSION_BLOCKS     = 1;      // 5 minutes
export const WARNING_SECONDS      = 60;
export const GRACE_SECONDS        = 30;
export const OFFER_TTL_SECONDS    = 60;
export const AUTO_AWAY_MINUTES    = 60;
export const NO_SHOW_WINDOW_SEC   = 60;
export const DEFAULT_BUDGET_CAP   = 40;
export const MATCH_COUNT          = 5;

// §5.2 — the teacher picks any whole number in this range.
export const MIN_PRICE_PER_BLOCK     = 5;
export const MAX_PRICE_PER_BLOCK     = 20;
export const DEFAULT_PRICE_PER_BLOCK = 10;

// Student-side price filter. A band is a ceiling: picking B means A and B.
// Derived from price_per_block at read time, never stored on the teacher.
export const PRICE_BANDS = {
  A: { maxPrice: 9 },
  B: { maxPrice: 14 },
  C: { maxPrice: 20 },
};

// §6.2 — standing, computed from sessions_count and the rating columns.
// Ordered high to low: the first match wins. TOP needs volume AND satisfaction.
export const STANDING_BANDS = [
  { badge: 'TOP',         minSessions: 100, minRating: 4.5 },
  { badge: 'EXPERIENCED', minSessions: 25,  minRating: 0 },
  { badge: 'ACTIVE',      minSessions: 5,   minRating: 0 },
  { badge: 'NEW',         minSessions: 0,   minRating: 0 },
];

export const PLATFORM_FEE_PCT     = 0.15;
export const NEW_TEACHER_FEE_DAYS = 30;
export const LOW_DEMAND_HOURS     = [6, 14];   // 0% commission. [start, end) — Israel
                                               // time, never the host's. Compare via
                                               // isLowDemandHour() in utils/time.js.

export const MATCH_WEIGHTS = {
  topicFit:        0.35,
  globalRating:    0.20,
  resolveRate:     0.20,   // was 0.15 — absorbed priceFit on the 8/11 revision
  acceptanceRate:  0.10,
  history:         0.10,
  newTeacherBoost: 0.05,
};

export const BAYES_C              = 5;
export const PARENT_TOPIC_WEIGHT  = 0.3;
export const NEW_TEACHER_SESSIONS = 5;

export const TOPUP_PACKAGES = [50, 100, 200];
export const LLM_TIMEOUT_MS = 8000;
export const MIN_CONFIDENCE = 0.5;
```
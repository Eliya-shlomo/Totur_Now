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
6. [Teacher Verification & Tiers](#6-teacher-verification--tiers)
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

**Use cases:** register + entrance exam · pick specialty topics and price tier · availability toggle · accept/reject offers · run a session · view earnings and ratings

### Guest — not logged in

**Use cases:** landing page · list of currently available teachers (no contact info) · reviews · pricing explanation

### Admin

**Use cases:** approve/reject teacher documents · view sessions · block users

---

## 3. Scope — In and Out

### ✅ In MVP

| Area | What's included |
|---|---|
| Auth | Register/login, JWT + refresh, 3 roles (student / teacher / admin) |
| Teachers | Automated entrance exam (LLM-generated bank), topic selection, price tier, availability toggle, academic email verification, manual admin approval, colored badges |
| Questions | Free text + image upload (external storage), automatic LLM classification |
| Matching | Ranking algorithm + selection screen showing 5 teachers |
| Offers | One live offer at a time, 60s TTL, atomic teacher locking |
| Sessions | Automatic Zoom meeting creation, block timer, consent-based extension, auto-end |
| Money | Internal credit wallet, charge at block start, append-only ledger, teacher earnings balance |
| Feedback | "Resolved? yes/no" + stars + free text → per-topic rating update |
| Real-time | Socket.IO for presence, offers, timer, session end |
| Notifications | Email to teacher on new offer |
| General | Responsive, end-to-end error handling, validation, deployment |

### ❌ Out of MVP (documented in [§21](#21-future-scope))

Real payments (Stripe) · shared whiteboard · session recording · anti-stalling mechanism · full minor-safety program · mid-session topic change detection · question library / RAG · mobile app · additional subjects

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
T=0    Charge 2 blocks (10 min) · create Zoom · start timer
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

### 5.2 Price tiers

The platform defines three tiers. Teachers pick one, subject to verification.

| Tier | ₪ / block | Opening block (10 min) | Hourly equivalent | Requirement |
|---|---|---|---|---|
| 🟢 **Base** | 8 | 16 | 96 | Default for new teachers |
| 🔵 **Regular** | 12 | 24 | 144 | Verified academic email + entrance score ≥ 80 |
| 🟣 **Pro** | 16 | 32 | 192 | Admin-approved teaching certificate **or** rating ≥ 4.5 after 20 sessions |

Tiers instead of free pricing because: prevents a race to the bottom · dramatically simplifies the selection screen (students compare teachers, not price lists) · turns price into a quality signal rather than noise.

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

## 6. Teacher Verification & Tiers

### 6.1 Stage 0 — Entrance exam (mandatory for everyone)

1. Teacher selects levels to teach (3 / 4 / 5 units) and topics
2. 10 multiple-choice questions at the requested level, 20-minute limit
3. **The score determines which levels they're authorized for** — not a binary pass/fail:

| Score | Authorization |
|---|---|
| < 60 | Rejected. Retry after 30 days |
| 60–79 | 3 units only |
| 80–89 | 3–4 units |
| ≥ 90 | 3–5 units |

In MVP: a bank of ~40 questions pre-generated by the LLM and stored in the DB, sampled randomly. Simple, deterministic, and no risk of a live LLM call during an exam.

### 6.2 Stage 1 — Academic email (optional, unlocks "Regular" tier)

Send a 6-digit code to a known academic domain (`tau.ac.il`, `technion.ac.il`, `huji.ac.il`, `bgu.ac.il`, `openu.ac.il`, `biu.ac.il`, `ariel.ac.il`, `hit.ac.il`). The best cost-to-value item in this document: almost zero work, almost impossible to fake.

### 6.3 Stage 2 — Admin approval (unlocks "Pro" tier)

Upload a document (teaching certificate / transcript) → admin queue → approve or reject with a reason.

### 6.4 Badges

| Badge | Meaning | Allowed tiers |
|---|---|---|
| 🟣 Purple — **Certified** | Approved teaching certificate | All |
| 🔵 Blue — **Student** | Verified academic email | Base / Regular |
| 🟢 Green — **New** | Passed the exam only | Base |

**"New teacher"** is shown for the first 5 sessions and receives an **exposure boost** in the algorithm — this solves teacher cold start without harming students (low price + calibrated expectations).

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

### 8.1 Call 1 — Classification and brief (the core call)

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

### 8.2 Call 2 — Generating the entrance exam bank

**Runs offline once** (a dev-time script); results stored in `entrance_questions`. Zero runtime cost and zero latency.

---

## 9. Matching Algorithm

### 9.1 Hard filters

A teacher enters the candidate pool only if **all** of these hold:

```
status == 'ONLINE'                          # not OFFLINE, IN_SESSION, or OFFER_LOCKED
is_verified == true
level_max >= question.estimated_level       # authorized for this level
question.topic_id ∈ teacher.topics          # (topic_id == 0 → everyone passes)
student.wallet_balance >= price_per_block*2 # can afford the opening block
teacher_id ∉ student.blocked_teachers
teacher_id ∉ question.rejected_by           # hasn't already declined this question
```

### 9.2 Scoring

```
score = 0.35 · topic_fit
      + 0.20 · global_rating
      + 0.15 · resolve_rate
      + 0.10 · acceptance_rate
      + 0.10 · history_bonus
      + 0.05 · price_fit
      + 0.05 · new_teacher_boost
```

| Component | Computation | Meaning |
|---|---|---|
| `topic_fit` | Bayesian rating in the subtopic, normalized to [0,1] | The heavy component — topical fit |
| `global_rating` | Average stars / 5 | Cross-cutting quality |
| `resolve_rate` | `resolved_count / sessions_count` | **The real KPI** — was the question actually solved |
| `acceptance_rate` | `accepted_offers / offers_received` | Reliability. Measures responsiveness, **not** availability |
| `history_bonus` | 1.0 if this student rated them ≥4 before, else 0 | Continuity wins |
| `price_fit` | `1 - (price / max_price)` | Slight preference for lower price |
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
        0.15 * resolve +
        0.10 * accept +
        0.10 * (t.hasPositiveHistoryWith(student.id) ? 1 : 0) +
        0.05 * (1 - t.pricePerBlock / MAX_PRICE) +
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
              │     │    ACTIVE    │  Zoom created · 2 blocks charged · timer running
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
                  ├──1:N── teacher_documents
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
CREATE TYPE teacher_badge  AS ENUM ('NEW','STUDENT','CERTIFIED');
CREATE TYPE price_tier     AS ENUM ('BASE','REGULAR','PRO');

CREATE TABLE teacher_profiles (
  user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bio                 TEXT,
  badge               teacher_badge  DEFAULT 'NEW',
  price_tier          price_tier     DEFAULT 'BASE',
  price_per_block     INTEGER        NOT NULL DEFAULT 8,
  status              teacher_status DEFAULT 'OFFLINE',
  level_max           SMALLINT       DEFAULT 3,
  entrance_score      SMALLINT,
  academic_email      VARCHAR(255),
  academic_verified   BOOLEAN DEFAULT FALSE,
  admin_verified      BOOLEAN DEFAULT FALSE,
  zoom_personal_link  TEXT,
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
  ON teacher_profiles (status, level_max)
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

CREATE TABLE teacher_documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id   UUID REFERENCES teacher_profiles(user_id) ON DELETE CASCADE,
  file_url     TEXT NOT NULL,
  doc_type     VARCHAR(40),                    -- teaching_certificate | transcript
  status       VARCHAR(20) DEFAULT 'PENDING',  -- PENDING|APPROVED|REJECTED
  reject_note  TEXT,
  reviewed_by  UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

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
  zoom_join_url    TEXT,
  zoom_meeting_id  VARCHAR(60),
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

-- ══════════ ENTRANCE EXAM ══════════

CREATE TABLE entrance_questions (
  id            SERIAL PRIMARY KEY,
  level         SMALLINT,
  topic_id      INTEGER REFERENCES topics(id),
  body          TEXT NOT NULL,
  options       JSONB NOT NULL,
  correct_index SMALLINT NOT NULL
);

CREATE TABLE entrance_attempts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id  UUID REFERENCES users(id),
  score       SMALLINT,
  answers     JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
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
| GET | `/public/pricing` | Price tiers |

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
| PATCH | `/teachers/me` | Bio, price tier |
| PUT | `/teachers/me/topics` | Update specialty topics |
| PATCH | `/teachers/me/status` | `{status: ONLINE\|OFFLINE}` |
| POST | `/teachers/me/heartbeat` | Prevents auto-away |
| GET | `/teachers/me/earnings` | Earnings + breakdown |
| GET | `/teachers/me/stats` | Per-topic ratings |
| POST | `/teachers/me/documents` | Document upload → cloud storage |
| POST | `/teachers/me/academic-email` | Send code |
| POST | `/teachers/me/academic-email/verify` | Verify code |
| GET | `/teachers/entrance-exam` | 10 questions |
| POST | `/teachers/entrance-exam` | Submit → score + `level_max` |

### Questions & Matching

| Method | Path | Description |
|---|---|---|
| POST | `/questions` | **The core.** Create + LLM classify + create session in PENDING |
| POST | `/questions/:id/attachments` | Image upload |
| PATCH | `/questions/:id/classification` | Student's manual correction |
| GET | `/questions/:id/matches` | **Top 5 ranked teachers.** Re-callable = "show me more teachers" |

### Sessions & Offers

| Method | Path | Description |
|---|---|---|
| POST | `/sessions/:id/offer` | `{teacherId}` → atomic lock + socket + email |
| POST | `/offers/:id/accept` | ← teacher. Creates Zoom, charges 2 blocks, `ACTIVE` |
| POST | `/offers/:id/reject` | ← teacher. Releases lock, appends to `rejected_by` |
| GET | `/sessions/:id` | Full state + time remaining |
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
| GET | `/admin/documents/pending` | Approval queue |
| POST | `/admin/documents/:id/review` | `{approve, note}` |
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
| `offer:accepted` | student | `{sessionId, zoomUrl, teacherName, endsAt}` |
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
/teach/onboarding          Entrance exam + topics + tier
/teach/session/:id         Active session
/teach/earnings            Earnings breakdown
/teach/profile             Edit + documents

── Admin ──
/admin/documents           Approval queue
/admin/sessions            All sessions
```

### 14.2 The critical screen — teacher selection

This screen determines whether the product works. Worth more investment than any other screen.

```
┌──────────────────────────────────────────────────────┐
│  📐 Integration by parts · 5 units      [edit topic]  │
│  💰 Your balance: ₪96                                 │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌────────────────────────────────────────────────┐ │
│  │ 🟣 Dana K.       ⭐ 4.8 (32)                    │ │
│  │ Certified · solved 12 questions in Integrals    │ │
│  │ ✅ 91% resolved · ⏱ responds in ~20s            │ │
│  │ ₪16 / 5 min      Your credit = 30 minutes       │ │
│  │                              [ Send request ]   │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  ┌────────────────────────────────────────────────┐ │
│  │ 🔵 Yossi M.      ⭐ 4.6 (18)   💙 studied with   │ │
│  │ Student · solved 7 questions in Integrals       │ │
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

### 14.3 Active session screen

```
┌──────────────────────────────────────────────────────┐
│  🎥 In session with Dana              ⏱  03:42        │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░  block 1 of 2                 │
│                                                      │
│  [ Open Zoom call ↗ ]                                │
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
| Storage | Cloudinary (question images and teacher documents) |
| AI | Anthropic Claude API (Vision + JSON mode) |
| Video | Zoom API (Server-to-Server OAuth) |
| Email | Resend / Nodemailer |
| Deploy | Client → Vercel · Server → Render · DB → Neon |

**Why Zustand over Redux:** genuinely complex state (timer, socket, wallet) without boilerplate. Still fully satisfies the "State Management" requirement.

### 15.2 Server structure — strict layering

```
server/
├── src/
│   ├── config/            env, db, zoom, cloudinary
│   ├── routes/            route definitions only
│   ├── controllers/       req/res only. Zero business logic
│   ├── services/          ★ all business logic
│   │   ├── auth.service.js
│   │   ├── matching.service.js      ← the algorithm
│   │   ├── session.service.js       ← the state machine
│   │   ├── wallet.service.js        ← all money. Single entry point
│   │   ├── llm.service.js
│   │   ├── zoom.service.js
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

bcrypt (12 rounds) · 15-minute access token + 7-day refresh in an httpOnly cookie · `authorize(...roles)` middleware · rate limiting on login/register/questions · Helmet + CORS whitelist · Prisma (prevents SQL injection) · file type and size limits · **no secrets on the client** — Zoom, LLM, and Cloudinary calls go through the server only

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
| SQL | PostgreSQL + Prisma · 18 tables · transactions · partial indexes |
| External storage | Cloudinary — question images + teacher documents |

### General

| Requirement | Implementation |
|---|---|
| Deployment | Vercel + Render + Neon |
| External API | **Zoom API** (meeting creation) + **Cloudinary** + email service |
| AI Integration | **Claude API** — question classification (Vision + JSON), teacher briefs, entrance exam generation |
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
| Primary | **Client** — React, Router, Zustand, Mantine, all screens, responsive, error UX | **Server + Integrations** — Express MVC, Prisma, auth, wallet, LLM, Zoom, Socket.IO, cron, matching, deployment |
| Also owns | Client contracts (`api.d.ts` consumption), demo script | DB schema, `constants.js`, `AppError` |

Track B is heavier, so **client PRs are the ones to hand to agents most aggressively** — screens are the most agent-friendly work in the repo, and Owner A spends their time on review and on the two screens that actually matter (teacher selection, active session).

> **If there is a third team member:** split Track B into **Server** (Express, Prisma, auth, wallet, admin) and **Integrations** (LLM, Zoom, Socket.IO, cron, matching, deployment). Epics E4, E5, E6, and the LLM parts of E3 move to the Integrations owner. The epic list below is written to make this split clean — each epic already sits on one side of that line.

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

### E2 — Teacher Onboarding & Verification
**Owner:** B · **Depends on:** E1

| # | PR | Size | Notes |
|---|---|---|---|
| 2.1 | Offline script: LLM generates 40 entrance questions → `entrance_questions` | M | Run once |
| 2.2 | `GET/POST /teachers/entrance-exam` + scoring → `level_max` | M | |
| 2.3 | Teacher profile CRUD + topic selection + price tier | M | |
| 2.4 | Academic email verification (send code + verify) | M | Best cost/value item in the project |
| 2.5 | Document upload → Cloudinary + admin queue record | M | |
| 2.6 | Onboarding UI — Mantine Stepper: exam → topics → tier | L | Agent |
| 2.7 | Teacher profile edit screen + document upload | M | Agent |

**Acceptance:** a new teacher registers, takes the exam, gets a `level_max`, selects topics, and appears in the online teacher list.

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
**Owner:** B · **Depends on:** E5, E7

| # | PR | Size | Notes |
|---|---|---|---|
| 6.1 | `zoom.service` — Server-to-Server OAuth + create meeting | L | **Highest-risk PR in the project** |
| 6.2 | `session.service` — full state machine | L | **Human-written** |
| 6.3 | Session start: charge opening block + create Zoom + set `ends_at` | M | |
| 6.4 | `POST /sessions/:id/extend` + budget cap enforcement | M | |
| 6.5 | Cron: block warning at T-60s + auto-end at T+30s | M | |
| 6.6 | No-show reporting + refund path | M | |
| 6.7 | Active session screen (student) — timer, charges, extend modal | L | Agent. `ends_at` is server truth |
| 6.8 | Active session screen (teacher) — brief, image, earnings, end | M | Agent |

**Acceptance:** a full session runs end to end: Zoom opens, the timer counts down, the extension modal appears at T-60s, declining ends the session, and the charge matches what was displayed.

**Fallback if 6.1 slips past half a day:** drop to a static personal Zoom room link stored on the teacher profile. 3 days → 2 hours, with almost no demo impact.

---

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
| 9.1 | Admin endpoints — document queue, review, sessions, block user | M | |
| 9.2 | Admin UI — approval queue with document preview | M | Agent |
| 9.3 | Admin session table with filters | S | Agent |

**Acceptance:** an admin approves a teaching certificate and the teacher's badge turns purple and the Pro tier unlocks.

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

**Demo narrative (7 minutes):** two laptops · student photographs an exercise → classification → 5 ranked teachers → teacher receives the brief → accepts → Zoom opens → extension modal → end → credit moves → rating → the teacher's integrals ranking visibly changes.

---

### Epic dependency graph

```
E0 ──┬── E1 ──┬── E2 ──┬── E4 ── E5 ── E6 ── E8 ── E10 ── E11
     │        │        │              │
     │        ├── E3 ──┘              │
     │        │                       │
     │        └── E7 ─────────────────┘
     │
     └────────────────── E9 (parallel, low priority)
```

**Critical path:** E0 → E1 → E3 → E4 → E5 → E6 → E8. Anything off this path is cuttable.

---

## 19. Timeline & Checkpoints

| Date | Owner A (Client) | Owner B (Server + Integrations) |
|---|---|---|
| **Sun 8/9** | E0.5 — React skeleton, Mantine theme, router | E0.1–0.4 — schema, migration, constants, AppError |
| **Mon 8/10** | E1.4–1.5 — auth screens, authStore | E0.6–0.7, E1.1–1.3 — seed, deploy, auth |
| **Tue 8/11** | E2.6 — onboarding stepper | E2.1–2.5 — entrance exam, verification |
| **Wed 8/12** | E3.6–3.7 — question form, waiting screen | E3.1–3.5 — Cloudinary, LLM, questions |
| **Thu 8/13** | **E4.5 — teacher selection screen** | E4.1–4.4 — matching engine |
| **Fri–Sat** | Buffer / catch-up | Buffer / catch-up |
| **Sun 8/16** | E5.7–5.8 — teacher dashboard, awaiting screen | E5.1–5.6 — sockets, offers, atomic lock, cron |
| **Mon 8/17** | E6.7–6.8 — session screens, timer | E6.1–6.6, E7.1–7.4 — Zoom, state machine, wallet |
| **Tue 8/18** | E8.4–8.6, E7.7–7.8 — rating, wallet, history | E7.5–7.6, E8.1–8.3, E9 — billing, ratings, admin |
| **Wed 8/19** | **E10 — responsive + error UX** | **E11.1–11.3 — deploy + E2E** · **FEATURE CLOSE** |
| **Thu 8/20** | Bug fixes · demo seed · rehearsals · slide deck | |

### Checkpoints

- **8/13 EOD:** a student posts a question and sees 5 ranked teachers. If not → cut E2 (entrance exam) to a stub
- **8/17 EOD:** a full session runs end to end with charging. If not → cut E9 (admin) and E6.6 (refunds)
- **8/19 EOD:** production is live. No new code after this point

---

## 20. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Zoom API harder than expected | 🔴 High | Fallback: static personal room link on the teacher profile. 3 days → 2 hours |
| Race condition in offers | 🔴 High | `UPDATE ... WHERE status='ONLINE'` + `rowCount`. Manually test with two browsers |
| Wallet bug (money duplicated/lost) | 🔴 High | Single transaction + `FOR UPDATE` + `CHECK (balance >= 0)` + reconciliation query |
| Two agents colliding in the same folder | 🔴 High | One epic in flight per owner. Daily contract sync |
| Inconsistent LLM classification | 🟡 Medium | JSON mode + Zod + `topic_id=0` fallback. The flow **never** blocks |
| Demo with no real teachers | 🟡 Medium | Seed 15 teachers with history. Script to flip a teacher online on demand |
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

export const PRICE_TIERS = {
  BASE:    { pricePerBlock: 8,  badge: 'NEW' },
  REGULAR: { pricePerBlock: 12, badge: 'STUDENT' },
  PRO:     { pricePerBlock: 16, badge: 'CERTIFIED' },
};

export const PLATFORM_FEE_PCT     = 0.15;
export const NEW_TEACHER_FEE_DAYS = 30;
export const LOW_DEMAND_HOURS     = [6, 14];   // 0% commission

export const MATCH_WEIGHTS = {
  topicFit:        0.35,
  globalRating:    0.20,
  resolveRate:     0.15,
  acceptanceRate:  0.10,
  history:         0.10,
  priceFit:        0.05,
  newTeacherBoost: 0.05,
};

export const BAYES_C              = 5;
export const PARENT_TOPIC_WEIGHT  = 0.3;
export const NEW_TEACHER_SESSIONS = 5;

export const TOPUP_PACKAGES = [50, 100, 200];
export const LLM_TIMEOUT_MS = 8000;
export const MIN_CONFIDENCE = 0.5;
```
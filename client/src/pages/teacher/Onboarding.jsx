import { Badge, Button, Card, Group, Stack, Stepper, Text, Title } from '@mantine/core';
import { IconCheck, IconWorld } from '@tabler/icons-react';
import { ERROR_CODES } from '@tutor/shared';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { getPricing, getTopics } from '@/api/public.api';
import { getTeacherMe, updateTeacherMe } from '@/api/teacher.api';
import ErrorState from '@/components/state/ErrorState';
import LoadingState from '@/components/state/LoadingState';
import LevelPicker from '@/components/teacher/LevelPicker';
import PriceSlider from '@/components/teacher/PriceSlider';
import TopicPicker from '@/components/teacher/TopicPicker';
import { notify } from '@/lib/notify';

/**
 * `/teach/onboarding` — topics, then level, then price. MVP.md §14.1, PR 2.4.
 *
 * **One `PATCH` per step, not one at the end.** A teacher who closes the tab after
 * step two comes back to step three, not to step one. That is the entire reason this
 * screen is a stepper rather than a form, and it is why every step's Next is an
 * awaited request whose failure keeps the stepper where it is.
 *
 * This page owns every value on the screen. The three pickers are controlled and
 * stateless, so a rejected save cannot leave a control showing something the draft
 * does not hold — and a retry is the same button pressed twice, with the teacher's
 * input still in place.
 *
 * No authentication logic here: `ProtectedRoute role="teacher"` wraps the whole
 * `/teach` subtree in `routes.teacher.jsx`, so a student who reaches this URL is sent
 * to `/app` before this component renders. Confirmed, not reimplemented.
 */

/**
 * The three steps, in order. Each one names the single field it writes and the guard
 * it runs before spending a request.
 *
 * The guard is not a second validation layer: every rule below has a counterpart in
 * `server/src/validators/teacher.me.schema.js`, and the server is what enforces them.
 * It exists to fail on the phone rather than after a round trip — the same reasoning
 * `components/auth/authRules.js` documents for the register form.
 */
const STEPS = [
  {
    field: 'topicIds',
    label: 'Topics',
    description: 'What you teach',
    // Mirrors `.min(1, 'Choose at least one topic.')` on the server.
    guard: (draft) => (draft.topicIds.length === 0 ? 'Choose at least one topic.' : null),
  },
  {
    field: 'levelMax',
    label: 'Level',
    description: 'How far you go',
    guard: (draft) => (draft.levelMax ? null : 'Choose the highest level you can teach.'),
  },
  {
    field: 'pricePerBlock',
    label: 'Price',
    description: 'What you charge',
    // The slider cannot produce a value outside `price.min`–`price.max`, so there is
    // nothing to guard that the control has not already made unreachable.
    guard: () => null,
  },
];

/** `active === STEPS.length` is Mantine's "all done", and this screen's summary. */
const SUMMARY_STEP = STEPS.length;

/**
 * Where this browser left off, per teacher — the resume hint, and the one piece of
 * state this screen keeps outside the server.
 *
 * It exists because `onboardingComplete` cannot answer "which step is next".
 * `utils/teacherView.js` computes it as "has at least one topic", deliberately and
 * with the reasoning written down: `pricePerBlock` and `levelMax` are `NOT NULL` with
 * defaults written at registration, so nothing in the payload distinguishes a teacher
 * who chose 10 credits from one who was handed 10 credits. A teacher who has finished
 * only step 1 is therefore already `onboardingComplete: true`.
 *
 * So the server value stays the authority on *whether* onboarding is done — this
 * screen never recomputes it — and this marker answers only *where this browser got
 * to*. Losing it (a different device, cleared storage, private mode) degrades to the
 * summary rather than to a wrong step, which is the safe direction: the record really
 * is complete by the server's definition, and the summary offers an edit.
 *
 * Revisit when a column worth reading exists — that is a schema change and a
 * serializer change, not a stepper change.
 */
const PROGRESS_KEY_PREFIX = 'tutor.onboarding.';

/** @returns {number} how many steps this browser has saved for `teacherId`, 0–3. */
function readProgress(teacherId) {
  try {
    const saved = Number(window.localStorage.getItem(`${PROGRESS_KEY_PREFIX}${teacherId}`));

    if (!Number.isInteger(saved) || saved < 0) return 0;

    return Math.min(saved, SUMMARY_STEP);
  } catch {
    // Safari in private mode throws on access, not on write. A teacher who cannot
    // store the hint still gets a working stepper — they just start at the summary
    // if their record is already complete.
    return 0;
  }
}

/** Never regresses: walking back to edit step 1 does not un-finish step 3. */
function writeProgress(teacherId, steps) {
  try {
    const next = Math.max(readProgress(teacherId), steps);

    window.localStorage.setItem(`${PROGRESS_KEY_PREFIX}${teacherId}`, String(next));
  } catch {
    // Storage full or blocked. The save itself succeeded, which is the part that
    // matters; this teacher resumes one step earlier than ideal.
  }
}

/**
 * Which step to open on.
 *
 * Three cases, and the middle one is the whole point:
 *
 *   not complete            step 1. Nothing has been saved, whatever storage says.
 *   complete, marker 1–2    the first step this browser has not saved — the
 *                           "reopen after step 2, resume at step 3" criterion.
 *   complete, no marker     the summary. Either they finished, or they are on a
 *   or marker at 3          different device and the record is complete by the only
 *                           definition the system has.
 */
function startStepFor(record, progress) {
  if (!record.onboardingComplete) return 0;

  if (progress === 0 || progress >= SUMMARY_STEP) return SUMMARY_STEP;

  return progress;
}

export default function Onboarding() {
  const navigate = useNavigate();

  const [record, setRecord] = useState(null);
  const [options, setOptions] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);

  const [step, setStep] = useState(0);

  /**
   * The teacher's answers, and the only thing the pickers read.
   *
   * Never cleared by a failed save — that is what makes "retry without losing the
   * step's input" true rather than aspirational. It is seeded once, from the record,
   * and a successful `PATCH` does not re-seed it: the response necessarily agrees
   * with what was just sent, and re-seeding would fight a teacher who edited the next
   * control while the request was in flight.
   */
  const [draft, setDraft] = useState({ topicIds: [], levelMax: null, pricePerBlock: null });

  const [saving, setSaving] = useState(false);
  /** Field-level, from `VALIDATION_ERROR.details`. Keyed by the step's field. */
  const [fieldErrors, setFieldErrors] = useState({});
  /** Everything else — network, timeout, 500. Rendered as `ErrorState` under the step. */
  const [saveError, setSaveError] = useState(null);

  const load = useCallback(() => {
    let cancelled = false;

    setLoading(true);
    setLoadError(null);

    // One round trip's worth of latency instead of three. The record decides where
    // the stepper opens and the two public payloads fill the controls, so there is no
    // useful screen to render until all three have answered.
    Promise.all([getTeacherMe(), getTopics(), getPricing()])
      .then(([teacher, topicData, pricingData]) => {
        if (cancelled) return;

        setRecord(teacher);
        setOptions({ topics: topicData.topics, pricing: pricingData });
        setDraft({
          topicIds: teacher.topics.map((topic) => topic.id),
          levelMax: teacher.levelMax,
          pricePerBlock: teacher.pricePerBlock,
        });
        setStep(startStepFor(teacher, readProgress(teacher.id)));
      })
      .catch((err) => {
        // Everything from the api layer is an ApiError, so `err.message` is already
        // safe to show — see client/src/api/ApiError.js.
        if (!cancelled) setLoadError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(load, [load]);

  /**
   * Save one field and move on. The only writer on this screen apart from
   * {@link goOnline}.
   *
   * Sends unconditionally, even when the value is unchanged: "one `PATCH` per step"
   * is what makes the resume marker mean something, and a skipped request would leave
   * it claiming the server holds something it was never sent.
   *
   * A rejection never advances the stepper. That is the failure this screen is most
   * likely to see — the free Render instance sleeps and answers the first request
   * after a quiet period past the client's 15s timeout (docs/DEPLOYMENT.md §7) — and
   * a stepper that advanced anyway would tell a teacher their price was saved when
   * nothing received it.
   */
  const saveStep = useCallback(async (patch, stepIndex, nextStep) => {
    const { field } = STEPS[stepIndex];

    setSaving(true);
    setSaveError(null);
    setFieldErrors({});

    try {
      const updated = await updateTeacherMe(patch);

      setRecord(updated);
      writeProgress(updated.id, nextStep);
      setStep(nextStep);
    } catch (err) {
      const detail = err?.is?.(ERROR_CODES.VALIDATION_ERROR) ? err.details?.[field] : null;

      // Inline on the control that caused it when the server named a field, and as
      // an `ErrorState` beside the step's own button otherwise. No toast in either
      // case: both land within a few pixels of the button just pressed, and a
      // second copy of one failure is noise rather than information — the same call
      // `Teachers.jsx` makes about its two error surfaces.
      if (detail) setFieldErrors({ [field]: detail });
      else setSaveError(err);
    } finally {
      setSaving(false);
    }
  }, []);

  const goNext = useCallback(() => {
    const current = STEPS[step];
    const message = current.guard(draft);

    if (message) {
      setFieldErrors({ [current.field]: message });

      return;
    }

    saveStep({ [current.field]: draft[current.field] }, step, step + 1);
  }, [draft, saveStep, step]);

  /**
   * Back, and the same thing by way of a step heading. Neither saves: the draft keeps
   * whatever the teacher typed, and the step they return to is re-saved when they
   * walk forward again.
   */
  const goToStep = useCallback((index) => {
    setFieldErrors({});
    setSaveError(null);
    setStep(index);
  }, []);

  const goBack = useCallback(() => goToStep(Math.max(step - 1, 0)), [goToStep, step]);

  /**
   * The one action on the summary. `PATCH { status: 'ONLINE' }` and out to `/teach`.
   *
   * A toast here rather than an inline error, because the summary has content and
   * this is an action on it — the distinction `lib/notify.js` documents. There is no
   * control to hang the message under, and the teacher stays on a screen whose button
   * they can press again.
   */
  const goOnline = useCallback(async () => {
    setSaving(true);

    try {
      await updateTeacherMe({ status: 'ONLINE' });

      navigate('/teach');
    } catch (err) {
      notify.apiError(err);
    } finally {
      setSaving(false);
    }
  }, [navigate]);

  if (loading) return <LoadingState label="Loading your profile…" minHeight={320} />;

  if (loadError) {
    return (
      <ErrorState
        error={loadError}
        title="Could not load your profile"
        onRetry={load}
        minHeight={320}
      />
    );
  }

  return (
    <Stack gap="lg" maw={720}>
      <Stack gap="xs">
        <Title order={1}>Set up your teaching profile</Title>
        <Text c="dimmed">
          Three steps. Each one saves as you go, so you can stop here and pick it up later.
        </Text>
      </Stack>

      <Stepper
        active={step}
        onStepClick={goToStep}
        // Forward is earned by saving, not by clicking a heading: allowing it would
        // let a teacher reach the price step without the topics behind it ever
        // reaching the server. Back is always allowed — see `allowStepSelect` below.
        allowNextStepsSelect={false}
        size="sm"
        iconSize={32}
      >
        {STEPS.map((definition, index) => (
          <Stepper.Step
            key={definition.field}
            label={definition.label}
            description={definition.description}
            allowStepSelect={!saving && index < step}
          >
            <Stack gap="md" mt="xl">
              <StepBody
                index={index}
                draft={draft}
                setDraft={setDraft}
                options={options}
                fieldErrors={fieldErrors}
                saving={saving}
              />

              {saveError && (
                // Under the controls rather than in place of them: the draft is still
                // on screen and still editable, so "Try again" is exactly the request
                // that just failed, with nothing retyped.
                <ErrorState
                  error={saveError}
                  title="Could not save this step"
                  onRetry={goNext}
                  minHeight={0}
                />
              )}

              <Group justify="space-between" mt="md" wrap="nowrap">
                <Button variant="default" onClick={goBack} disabled={index === 0 || saving}>
                  Back
                </Button>

                <Button onClick={goNext} loading={saving}>
                  {index === STEPS.length - 1 ? 'Finish' : 'Save and continue'}
                </Button>
              </Group>
            </Stack>
          </Stepper.Step>
        ))}

        <Stepper.Completed>
          <Summary
            record={record}
            onGoOnline={goOnline}
            onEdit={() => goToStep(0)}
            onSkip={() => navigate('/teach')}
            busy={saving}
          />
        </Stepper.Completed>
      </Stepper>
    </Stack>
  );
}

/**
 * The step's control, by index.
 *
 * A switch rather than three conditionals inside the map, so adding a step is a `STEPS`
 * entry plus a case, and the layout above stays a layout.
 */
function StepBody({ index, draft, setDraft, options, fieldErrors, saving }) {
  if (index === 0) {
    return (
      <TopicPicker
        topics={options.topics}
        value={draft.topicIds}
        onChange={(topicIds) => setDraft((current) => ({ ...current, topicIds }))}
        error={fieldErrors.topicIds}
        disabled={saving}
      />
    );
  }

  if (index === 1) {
    return (
      <LevelPicker
        value={draft.levelMax}
        onChange={(levelMax) => setDraft((current) => ({ ...current, levelMax }))}
        error={fieldErrors.levelMax}
        disabled={saving}
      />
    );
  }

  return (
    <PriceSlider
      value={draft.pricePerBlock}
      onChange={(pricePerBlock) => setDraft((current) => ({ ...current, pricePerBlock }))}
      min={options.pricing.price.min}
      max={options.pricing.price.max}
      bands={options.pricing.bands}
      error={fieldErrors.pricePerBlock}
      disabled={saving}
    />
  );
}

/**
 * What the teacher sees once all three steps are saved, and what they see if they
 * open this URL again afterwards.
 *
 * A summary with an edit affordance rather than a wizard restarting: reopening a
 * finished setup and being asked the first question again reads as "none of that
 * saved", which is the opposite of what per-step saving bought.
 *
 * Read from `record`, not from `draft`. This is the server's answer after the last
 * `PATCH`, so what it shows is what a student will see.
 *
 * "Not now" is a real option and stays one. A teacher finishing this screen on a bus
 * should not be online, and going online is what makes them reachable for an offer.
 */
function Summary({ record, onGoOnline, onEdit, onSkip, busy }) {
  const isOnline = record.status === 'ONLINE';

  return (
    <Stack gap="lg" mt="xl">
      <Stack gap="xs">
        <Group gap="xs">
          <IconCheck size={20} color="var(--mantine-color-teal-6)" />
          <Title order={3}>Your profile is ready</Title>
        </Group>
        <Text c="dimmed" size="sm">
          Students can find you in the teacher list. Go online when you are ready to take questions
          — you can switch off again at any time.
        </Text>
      </Stack>

      <Card withBorder radius="md" padding="lg">
        <Stack gap="md">
          <Fact label="Topics">
            <Group gap={6}>
              {record.topics.map((topic) => (
                <Badge key={topic.id} variant="default" size="sm" radius="sm">
                  {topic.nameEn}
                </Badge>
              ))}
            </Group>
          </Fact>

          <Fact label="Teaches up to">
            <Text size="sm">Level {record.levelMax}</Text>
          </Fact>

          <Fact label="Price">
            <Text size="sm">₪{record.pricePerBlock} per block</Text>
          </Fact>
        </Stack>
      </Card>

      <Group gap="sm" wrap="wrap">
        {isOnline ? (
          <Button onClick={onSkip}>Go to your dashboard</Button>
        ) : (
          <Button leftSection={<IconWorld size={16} />} onClick={onGoOnline} loading={busy}>
            Go online
          </Button>
        )}

        {!isOnline && (
          <Button variant="default" onClick={onSkip} disabled={busy}>
            Not now
          </Button>
        )}

        <Button variant="subtle" onClick={onEdit} disabled={busy}>
          Edit answers
        </Button>
      </Group>
    </Stack>
  );
}

/** A labelled row. Stacks at 375px, sits side by side once there is room. */
function Fact({ label, children }) {
  return (
    <Group align="flex-start" gap="xs" wrap="wrap">
      <Text size="sm" c="dimmed" w={110}>
        {label}
      </Text>
      {children}
    </Group>
  );
}

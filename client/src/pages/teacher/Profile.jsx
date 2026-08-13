import {
  Alert,
  Anchor,
  Button,
  Card,
  Divider,
  Group,
  Modal,
  Stack,
  Switch,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { IconExternalLink, IconInfoCircle } from '@tabler/icons-react';
import { ERROR_CODES } from '@tutor/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useBeforeUnload, useBlocker } from 'react-router-dom';

import { getPricing, getTopics } from '@/api/public.api';
import { getTeacherMe, updateTeacherMe } from '@/api/teacher.api';
import ErrorState from '@/components/state/ErrorState';
import LoadingState from '@/components/state/LoadingState';
import LevelPicker from '@/components/teacher/LevelPicker';
import PriceSlider from '@/components/teacher/PriceSlider';
import TeacherCard from '@/components/teacher/TeacherCard';
import TopicPicker from '@/components/teacher/TopicPicker';
import { notify } from '@/lib/notify';

/**
 * `/teach/profile` — the teacher editing their own record. MVP.md §14.1, PR 2.6.
 *
 * The same four fields the onboarding stepper (2.4) sets, and the same endpoint
 * behind it, in the opposite shape. A stepper is a one-time linear flow that saves
 * per step so a teacher can abandon it halfway; this is a form a teacher returns to
 * for a year, and it saves **once, on submit**. A `PATCH` per keystroke against a free
 * instance that sleeps (docs/DEPLOYMENT.md §7) is a screen that spends thirty seconds
 * saving a bio nobody asked it to save yet.
 *
 * Nothing on this screen is built twice. The three controls are DEV-B's from 2.4,
 * imported unchanged; the preview is our own `TeacherCard` from 2.5, which takes
 * `linkTo={false}` for exactly this. That reuse is why the epic gave the edit screen
 * and the public screens to the same developer (the epic README → The split): a card
 * built twice is a card that disagrees with itself about what a teacher looks like.
 *
 * No authentication logic here. `ProtectedRoute role="teacher"` wraps the whole
 * `/teach` subtree in `routes.teacher.jsx`, so a student who reaches this URL is sent
 * to `/app` before this component renders.
 */

/**
 * How long a bio may be — the client mirror of `BIO_MAX_LENGTH` in
 * `server/src/config/constants/teacher.js`, which is what actually enforces it
 * (`teacher.me.schema.js`).
 *
 * Copied rather than imported because the constant is not published: `@tutor/shared`
 * carries types and error codes, and no `/public` endpoint exposes the teacher
 * bounds. This is the same gap `LEVEL_OPTIONS` in `LevelPicker.jsx` and
 * `TeacherFilters.jsx` document for `TEACHING_LEVELS`, and it closes the same way —
 * by publishing the constants, which is a shared-contract change and therefore 2.7's,
 * not a screen PR's. Named here so the set stays greppable.
 *
 * The number is a counter and a `maxLength`, never a validation verdict: the server's
 * message is what a teacher reads if the two ever disagree.
 */
const BIO_MAX_LENGTH = 500;

/** The fields this form owns. `status` is not one of them — see {@link StatusControl}. */
const FORM_FIELDS = ['bio', 'topicIds', 'levelMax', 'pricePerBlock'];

/**
 * A bio as the server will store it.
 *
 * `teacher.me.schema.js` trims and turns `''` into `null`, so a teacher who clears the
 * textarea and one whose bio was already `null` have made the same change: none. Doing
 * the same normalisation here is what stops "select all, delete, retype it identically"
 * from arming the submit button.
 */
function normalizeBio(value) {
  const trimmed = (value ?? '').trim();

  return trimmed === '' ? null : trimmed;
}

/** Same ids, order ignored — the picker's order is the taxonomy's, not the teacher's. */
function sameTopicIds(a, b) {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

/**
 * The record as an editable draft. Called on load and again after every successful
 * save, which is what resets the dirty state without a second copy of "what is clean".
 */
function draftFrom(record) {
  return {
    // The textarea is a controlled input and cannot be handed `null`.
    bio: record.bio ?? '',
    topicIds: record.topics.map((topic) => topic.id),
    levelMax: record.levelMax,
    pricePerBlock: record.pricePerBlock,
  };
}

/**
 * Only what actually changed — the body of the one `PATCH` this screen sends.
 *
 * A full-object save would be four fields where one moved, and `topicIds` replaces the
 * whole set on the server (the contract freeze), so resending an untouched selection
 * means deleting and rewriting the join rows for nothing. It is also what makes the
 * empty result meaningful: no keys means nothing to save, and the server answers an
 * empty body with `VALIDATION_ERROR` rather than a success.
 *
 * `topicIds` is filtered to leaves on the way out, and that is not defensive
 * programming — it is the one place this screen has to reconcile two rules that
 * disagree. The seed wrote parent rows into `teacher_topics` (20 of 50) and 2.2's
 * `assertLeafTopics` now rejects parent ids, so an affected teacher's record contains
 * ids the picker cannot render and the server will not accept. Sending them back
 * unfiltered makes every topic edit a 400 the teacher has no control to fix: verified
 * against the seeded `dana.k@demo.tutornow.il`, whose ids 37 and 41 come back as
 * "Pick subtopics rather than whole subjects". Filtering means a topic edit saves the
 * boxes the teacher can actually see and drops what they could never have unticked,
 * which is the direction 2.2's rule points. The screen says so out loud rather than
 * doing it quietly — see {@link StrandedTopicsNotice}. The real fix is the seed, and
 * it belongs to 2.7.
 */
function changedFields(record, draft, leafIds) {
  const patch = {};
  const bio = normalizeBio(draft.bio);

  if (bio !== (record.bio ?? null)) patch.bio = bio;

  if (
    !sameTopicIds(
      draft.topicIds,
      record.topics.map((topic) => topic.id),
    )
  ) {
    patch.topicIds = draft.topicIds.filter((id) => leafIds.has(id));
  }

  if (draft.levelMax !== record.levelMax) patch.levelMax = draft.levelMax;

  if (draft.pricePerBlock !== record.pricePerBlock) patch.pricePerBlock = draft.pricePerBlock;

  return patch;
}

/**
 * Every topic this screen may have to render a chip for, by id.
 *
 * The taxonomy's leaves, plus whatever the teacher's record actually holds. Those two
 * sets should be identical and are not: the seed writes parent rows into
 * `teacher_topics` (20 of the 50 seeded rows) while 2.2's `assertLeafTopics` now
 * rejects parent ids, so several existing teachers carry a topic the picker has no
 * checkbox for.
 *
 * The record's own entries are therefore the fallback rather than an omission — a
 * preview that silently dropped them would under-report what a student sees on
 * `/teachers/:id` today, which is the one thing this preview exists to be right about.
 * They stay in the draft as well (Mantine's `Checkbox.Group` carries values it does not
 * render), and {@link changedFields} is what keeps them out of a save. Leaves win on
 * collision so the labels stay the taxonomy's.
 */
function topicsById(taxonomy, recordTopics) {
  const byId = new Map(recordTopics.map((topic) => [topic.id, topic]));

  for (const parent of taxonomy) {
    for (const child of parent.children ?? []) byId.set(child.id, child);
  }

  return byId;
}

/** The ids the picker can render and the server will accept. */
function leafIdsOf(taxonomy) {
  return new Set(taxonomy.flatMap((parent) => (parent.children ?? []).map((child) => child.id)));
}

/**
 * What a student would see if the draft were saved right now.
 *
 * Built by overlaying the draft on the server's record rather than by assembling a
 * card from scratch: `badge`, `rating` and `ratingCount` are computed server-side and
 * are not this screen's to invent, and spreading the record means a field added to
 * `TeacherCard` later shows up in the preview with no edit here.
 *
 * Topics are sorted by id because that is the order the record comes back in —
 * `orderBy: { topicId: 'asc' }` in the frozen repository. Without it the preview would
 * reshuffle its chips the moment the teacher saved, which reads as a bug in the save.
 */
function previewCard(record, draft, topicIndex) {
  return {
    ...record,
    bio: normalizeBio(draft.bio),
    pricePerBlock: draft.pricePerBlock,
    levelMax: draft.levelMax,
    topics: [...draft.topicIds]
      .sort((a, b) => a - b)
      .map((id) => topicIndex.get(id))
      .filter(Boolean),
    isOnline: record.status === 'ONLINE',
  };
}

export default function Profile() {
  const [record, setRecord] = useState(null);
  const [options, setOptions] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);

  /**
   * The teacher's edits, and the only thing the controls read.
   *
   * Never cleared by a failed save. That is what makes "a rejected save keeps the
   * typed values" true rather than aspirational: the retry button sends the same draft
   * again, with nothing retyped. It is re-seeded only from a server response — the
   * initial `GET`, or the record a successful `PATCH` returns.
   */
  const [draft, setDraft] = useState(null);

  const [saving, setSaving] = useState(false);
  /** Field-level, from `VALIDATION_ERROR.details`, keyed by the contract's field names. */
  const [fieldErrors, setFieldErrors] = useState({});
  /** Everything else — network, timeout, 500. Rendered beside the submit button. */
  const [saveError, setSaveError] = useState(null);

  const load = useCallback(() => {
    let cancelled = false;

    setLoading(true);
    setLoadError(null);

    // One round trip's worth of latency instead of three, and no half-rendered form:
    // the record fills the fields, the taxonomy fills the picker, and the pricing
    // payload supplies the slider's bounds. None of the three is optional.
    Promise.all([getTeacherMe(), getTopics(), getPricing()])
      .then(([teacher, topicData, pricingData]) => {
        if (cancelled) return;

        setRecord(teacher);
        setOptions({ topics: topicData.topics, pricing: pricingData });
        setDraft(draftFrom(teacher));
      })
      .catch((err) => {
        // Everything from the api layer is an `ApiError`, so `err.message` is already
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

  const leafIds = useMemo(() => leafIdsOf(options?.topics ?? []), [options]);

  const patch = useMemo(
    () => (record && draft ? changedFields(record, draft, leafIds) : {}),
    [record, draft, leafIds],
  );
  const dirty = Object.keys(patch).length > 0;

  /**
   * Closing the tab, reloading, or following a link out of the app.
   *
   * The browser shows its own wording here and ignores ours; `preventDefault` is the
   * whole API. It covers what {@link useBlocker} cannot see, and neither covers the
   * other, so this screen needs both.
   */
  useBeforeUnload(
    useCallback(
      (event) => {
        if (dirty) event.preventDefault();
      },
      [dirty],
    ),
  );

  /**
   * Navigating away inside the app — the sidebar, the header, the back button.
   *
   * `useBlocker` needs a data router, which `router/index.jsx` has used since 0.5.
   * Blocked while there are unsaved edits and a save is not already in flight: a
   * teacher who presses Save and immediately clicks a nav item should not be asked
   * about work the server is in the middle of accepting.
   */
  const blocker = useBlocker(dirty && !saving);

  const setField = useCallback((field, value) => {
    setDraft((current) => ({ ...current, [field]: value }));

    // The message described the value that was there when the server rejected it.
    // Leaving it under a control the teacher has since changed is stale advice.
    setFieldErrors((current) => {
      if (!(field in current)) return current;

      return Object.fromEntries(Object.entries(current).filter(([key]) => key !== field));
    });
  }, []);

  /**
   * One `PATCH`, carrying only the changed fields.
   *
   * The guard mirrors `.min(1, 'Choose at least one topic.')` in
   * `teacher.me.schema.js`; the server is what enforces it. Checking here spends no
   * request on a rejection the form can already see — the same reasoning
   * `components/auth/authRules.js` documents for the register form.
   */
  const submit = useCallback(async () => {
    if (!dirty || saving) return;

    if (patch.topicIds && patch.topicIds.length === 0) {
      setFieldErrors({ topicIds: 'Choose at least one topic.' });

      return;
    }

    setSaving(true);
    setSaveError(null);
    setFieldErrors({});

    try {
      const updated = await updateTeacherMe(patch);

      // The response is the record as it now is, so re-seeding from it both clears
      // the dirty state and shows the teacher what the server actually stored — a
      // trimmed bio comes back trimmed.
      setRecord(updated);
      setDraft(draftFrom(updated));
      notify.success('Your profile has been updated.');
    } catch (err) {
      const details = err?.is?.(ERROR_CODES.VALIDATION_ERROR) ? err.details : null;
      const inline = Object.fromEntries(
        FORM_FIELDS.filter((field) => details?.[field]).map((field) => [field, details[field]]),
      );

      // Inline on the controls the server named, and beside the submit button
      // otherwise. No toast in either case: both land within a few pixels of the
      // button just pressed, and a second copy of one failure is noise rather than
      // information — the same call `Onboarding.jsx` makes about its two surfaces.
      if (Object.keys(inline).length > 0) setFieldErrors(inline);
      else setSaveError(err);
    } finally {
      setSaving(false);
    }
  }, [dirty, patch, saving]);

  /** Throw the edits away and go back to the server's version. */
  const discard = useCallback(() => {
    setDraft(draftFrom(record));
    setFieldErrors({});
    setSaveError(null);
  }, [record]);

  /**
   * Availability, saved on its own the moment it is switched — deliberately not part
   * of the form's single submit.
   *
   * Going offline is the one change on this screen with a consequence in the next
   * minute: a teacher listed as available while they are not is the worst state this
   * platform can put a student in (`TeacherStatusToggle.jsx` makes the same call for
   * the header control). A switch that only takes effect after a separate Save is a
   * teacher who believes they are offline and is not, so this one writes immediately
   * and the four form fields keep the deferred save the brief asks for.
   */
  const setStatus = useCallback(async (online) => {
    setSaving(true);

    try {
      const updated = await updateTeacherMe({ status: online ? 'ONLINE' : 'OFFLINE' });

      // Only `record` — the draft holds the teacher's unsaved edits and re-seeding it
      // here would discard them for pressing an unrelated switch.
      setRecord(updated);
      notify.success(
        online
          ? 'You are online — students can send you questions.'
          : 'You are offline — you will not receive new requests.',
      );
    } catch (err) {
      // The switch still shows the status the server last confirmed, because `record`
      // is untouched. A toast rather than an inline error: the screen has content and
      // this was an action on it (lib/notify.js).
      notify.apiError(err);
    } finally {
      setSaving(false);
    }
  }, []);

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

  const topicIndex = topicsById(options.topics, record.topics);

  return (
    <Stack gap="lg" maw={720}>
      <Stack gap="xs">
        <Title order={1}>Your profile</Title>
        <Text c="dimmed">
          This is what students see when they find you. Changes are saved when you press Save.
        </Text>
      </Stack>

      <StatusControl record={record} busy={saving} onChange={setStatus} />

      <PreviewSection card={previewCard(record, draft, topicIndex)} teacherId={record.id} />

      <Divider />

      <Textarea
        label="About you"
        description="A short paragraph a student reads before choosing you. Optional."
        placeholder="What you teach, how you explain it, anything a student should know before they ask."
        value={draft.bio}
        onChange={(event) => setField('bio', event.currentTarget.value)}
        error={fieldErrors.bio}
        // A hard stop rather than a rejection after a round trip. The server checks the
        // same bound on the trimmed value and its message wins if the two disagree.
        maxLength={BIO_MAX_LENGTH}
        autosize
        minRows={4}
        maxRows={10}
        disabled={saving}
      />
      <Text size="xs" c="dimmed" mt={-8}>
        {draft.bio.length} / {BIO_MAX_LENGTH}
      </Text>

      <TopicPicker
        topics={options.topics}
        value={draft.topicIds}
        onChange={(topicIds) => setField('topicIds', topicIds)}
        error={fieldErrors.topicIds}
        disabled={saving}
      />

      <StrandedTopicsNotice topics={record.topics.filter((topic) => !leafIds.has(topic.id))} />

      <LevelPicker
        value={draft.levelMax}
        onChange={(levelMax) => setField('levelMax', levelMax)}
        error={fieldErrors.levelMax}
        disabled={saving}
      />

      <PriceSlider
        value={draft.pricePerBlock}
        onChange={(pricePerBlock) => setField('pricePerBlock', pricePerBlock)}
        min={options.pricing.price.min}
        max={options.pricing.price.max}
        bands={options.pricing.bands}
        error={fieldErrors.pricePerBlock}
        disabled={saving}
      />

      {saveError && (
        // Under the form rather than in place of it: every value is still on screen
        // and still editable, so "Try again" is exactly the request that just failed,
        // with nothing retyped.
        <ErrorState
          error={saveError}
          title="Could not save your profile"
          onRetry={submit}
          minHeight={0}
        />
      )}

      <Group justify="flex-end" gap="sm" wrap="wrap">
        <Button variant="default" onClick={discard} disabled={!dirty || saving}>
          Discard changes
        </Button>

        {/* Disabled until something actually differs from the server's record, which
            is the same computation that builds the request body — one definition of
            "changed", not two. */}
        <Button onClick={submit} disabled={!dirty} loading={saving}>
          Save changes
        </Button>
      </Group>

      <LeaveConfirm blocker={blocker} />
    </Stack>
  );
}

/**
 * Topics on the record that the picker has no checkbox for.
 *
 * Only ever the whole-subject rows the seed wrote before 2.2 ruled them out
 * (`assertLeafTopics`), so on a clean database this renders nothing. Where it does
 * render, it is because the next topic save will silently drop those rows —
 * {@link changedFields} filters them out so the save is possible at all — and a chip
 * disappearing from the card with no warning is exactly the kind of thing a teacher
 * reports as data loss. Naming them costs four lines and makes the drop a thing they
 * were told about.
 */
function StrandedTopicsNotice({ topics }) {
  if (topics.length === 0) return null;

  const one = topics.length === 1;

  return (
    <Alert icon={<IconInfoCircle size={16} />} color="gray" variant="light">
      {topics.map((topic) => topic.nameEn).join(', ')}{' '}
      {one
        ? 'is a whole subject rather than a subtopic'
        : 'are whole subjects rather than subtopics'}
      , so there is no box for {one ? 'it' : 'them'} above. The next time you save your topics,{' '}
      {one ? 'it' : 'they'} will be replaced by the subtopics you have ticked.
    </Alert>
  );
}

/**
 * Online / offline, and why the switch is sometimes unavailable.
 *
 * `OFFER_LOCKED` and `IN_SESSION` are the matching engine's (E4) and `PATCH
 * /teachers/me` rejects them, so the switch is disabled in those two states —
 * **disabled and explained, never hidden**. A teacher who cannot find the offline
 * switch mid-session closes the tab, and a teacher whose control has gone quiet with
 * no reason given assumes the page is broken.
 */
function StatusControl({ record, busy, onChange }) {
  const isOnline = record.status === 'ONLINE';
  const isEngineHeld = record.status === 'OFFER_LOCKED' || record.status === 'IN_SESSION';

  return (
    <Card withBorder radius="md" padding="md">
      <Stack gap="sm">
        <Group justify="space-between" align="center" wrap="nowrap" gap="md">
          <Stack gap={2}>
            <Text fw={600} size="sm">
              {isEngineHeld ? statusLabel(record.status) : isOnline ? 'Online' : 'Offline'}
            </Text>
            <Text size="xs" c="dimmed">
              {isOnline
                ? 'Students can send you questions right now.'
                : 'You will not receive new requests.'}
            </Text>
          </Stack>

          <Switch
            checked={isOnline}
            onChange={(event) => onChange(event.currentTarget.checked)}
            disabled={busy || isEngineHeld}
            size="md"
            aria-label="Availability"
          />
        </Group>

        {isEngineHeld && (
          <Alert icon={<IconInfoCircle size={16} />} color="gray" variant="light">
            {record.status === 'IN_SESSION'
              ? 'You are in a session. Your availability unlocks when it ends.'
              : 'You have an offer waiting. Your availability unlocks when you answer it.'}
          </Alert>
        )}

        <Text size="xs" c="dimmed">
          Availability saves the moment you switch it — it is not held back with the rest of the
          form.
        </Text>
      </Stack>
    </Card>
  );
}

/**
 * What the four statuses are called on this screen. Named for what they mean to the
 * teacher rather than by their enum value, the same wording the header control uses —
 * nobody should have to know the matching engine's vocabulary to read their own
 * availability.
 */
function statusLabel(status) {
  if (status === 'ONLINE') return 'Online';
  if (status === 'IN_SESSION') return 'In session';
  if (status === 'OFFER_LOCKED') return 'Offer pending';

  return 'Offline';
}

/**
 * The live preview — `TeacherCard` fed from the draft.
 *
 * The point of editing next to the thing being edited: a bio is three lines on a card
 * and a price is a band boundary, and neither is visible from the control that sets
 * it. `linkTo={false}` because a card that navigates away from a form holding unsaved
 * edits is a trap; the link to the real public profile is beside the heading, where it
 * is a deliberate choice rather than a mis-click.
 */
function PreviewSection({ card, teacherId }) {
  return (
    <Stack gap="xs">
      <Group justify="space-between" align="baseline" wrap="wrap" gap="xs">
        <Text fw={600} size="sm">
          How students see you
        </Text>

        <Anchor component={Link} to={`/teachers/${teacherId}`} target="_blank" size="xs">
          <Group gap={4} align="center">
            Open your public profile
            <IconExternalLink size={12} />
          </Group>
        </Anchor>
      </Group>

      {/* Capped rather than full width: the card is rendered in a grid cell on
          `/teachers`, and a preview stretched to the width of a form would not be the
          same object a student meets. */}
      <div style={{ maxWidth: 360 }}>
        <TeacherCard teacher={card} linkTo={false} />
      </div>
    </Stack>
  );
}

/**
 * The prompt before leaving with unsaved edits.
 *
 * Our own modal rather than `window.confirm`, because the blocker's two outcomes are
 * ours to name: "Leave" discards, "Stay" returns to the form with the edits intact.
 * `reset` is also what runs when the modal is dismissed by escape or the overlay —
 * an ambiguous dismissal must not throw work away.
 */
function LeaveConfirm({ blocker }) {
  const blocked = blocker.state === 'blocked';

  return (
    <Modal
      opened={blocked}
      onClose={() => blocker.reset?.()}
      title="You have unsaved changes"
      centered
    >
      <Stack gap="md">
        <Text size="sm">
          Your edits have not been sent to the server yet. Leaving this page will discard them.
        </Text>

        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={() => blocker.reset?.()}>
            Stay on this page
          </Button>
          <Button color="red" onClick={() => blocker.proceed?.()}>
            Leave and discard
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

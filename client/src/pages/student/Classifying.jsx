import { Alert, Button, Group, Stack, Text, Title } from '@mantine/core';
import { IconArrowRight, IconInfoCircle } from '@tabler/icons-react';
import { ERROR_CODES } from '@tutor/shared';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { getTopics } from '@/api/public.api';
import { getQuestion, patchClassification } from '@/api/question.classification.api';
import ClassificationCard from '@/components/question/ClassificationCard';
import TopicOverride from '@/components/question/TopicOverride';
import ErrorState from '@/components/state/ErrorState';
import LoadingState from '@/components/state/LoadingState';

/**
 * `/app/ask/:id/matching` — what the machine made of the question, and the student's
 * right to disagree. MVP.md §14.1, §8.1. PR 3.7.
 *
 * **Read from the server on mount, never from router state.** 3.6 navigates here with
 * the id in the URL and nothing else, deliberately: a reload must work, and a student
 * whose `POST /questions` timed out while the server carried on comes back to a real
 * question rather than an empty screen. That recovery is the reason 3.5 built
 * `GET /questions/:id` at all, and it is why there is no `questionStore` in this epic
 * — a second copy of server state owned by whichever screen created it first.
 *
 * **One screen, two paths, branching on `classificationOk`.** The card carries the
 * copy for both; this page decides where the override control sits — the primary
 * action when the model failed, an afterthought when it did not.
 *
 * **Confirming goes to `/app/ask/:id/teachers`, which is still a `Placeholder`.** E4's
 * PR 4.5 builds it and its brief is written against that route being untouched, so
 * this screen navigates and stops. Inventing an interim teacher list here would be
 * work E4 then has to delete.
 *
 * The route is called `matching` because §14.1 names it that. Renaming it to match
 * what the screen ended up doing would be an edit to a file both developers touch,
 * for no user-visible gain.
 */

/**
 * "Calculus · Integrals", or null.
 *
 * Resolved from `subtopicId` alone, which is what keeps the sentinel off the screen:
 * on the fallback path the question really is filed under `General / Unclassified`
 * with no leaf, and the honest rendering of that is no badge at all rather than a
 * topic name the model never chose. A leaf the taxonomy no longer has — F1 is going
 * to move rows — also answers null rather than a broken label.
 */
function topicLabelFor(topics, subtopicId) {
  if (subtopicId === null || subtopicId === undefined) return null;

  for (const parent of topics) {
    const leaf = (parent.children ?? []).find((child) => child.id === subtopicId);

    if (leaf) return `${parent.nameEn} · ${leaf.nameEn}`;
  }

  return null;
}

export default function Classifying() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [question, setQuestion] = useState(null);
  const [topics, setTopics] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);

  const [saving, setSaving] = useState(false);
  /** Field-level, from the server's `VALIDATION_ERROR.details.subtopicId`. */
  const [overrideError, setOverrideError] = useState(null);
  /**
   * Set when a `PATCH` came back `SESSION_NOT_ACTIVE`.
   *
   * **This is the only way this screen can know.** `QuestionResponse` carries
   * `sessionId` and not the session's status — that is the contract freeze, and
   * widening it would be a server change in an epic whose `api.d.ts` block is closed.
   * So the state is discovered by asking, once, and the control is dropped rather than
   * left to retry into the same 409. A reload before any attempt shows the control
   * again; the server refuses it, which is the layer that actually enforces the rule.
   */
  const [offerIsOut, setOfferIsOut] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;

    setLoading(true);
    setLoadError(null);

    // One round trip's worth of latency instead of two. Neither is expensive —
    // `/public/topics` is unauthenticated and cached — and there is no useful screen
    // to render until both have answered, because the topic label comes from one and
    // the id from the other.
    Promise.all([getQuestion(id), getTopics()])
      .then(([loaded, topicData]) => {
        if (cancelled) return;

        setQuestion(loaded);
        setTopics(topicData.topics);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(load, [load]);

  /**
   * Send the correction and re-render from what came back.
   *
   * The response is the whole question in the same shape `GET` returns, so there is
   * nothing to re-fetch and no window where the screen shows one thing and the
   * database holds another.
   */
  const saveOverride = useCallback(
    async (override) => {
      setSaving(true);
      setOverrideError(null);

      try {
        setQuestion(await patchClassification(id, override));
      } catch (error) {
        if (error?.is?.(ERROR_CODES.SESSION_NOT_ACTIVE)) {
          setOfferIsOut(true);
        } else if (error?.is?.(ERROR_CODES.VALIDATION_ERROR)) {
          // Under the picker rather than as a block at the bottom: the server names
          // the field, and a subtopic the taxonomy does not have is a message about
          // the control the student just used.
          setOverrideError(error.details?.subtopicId ?? error.message);
        } else {
          setOverrideError(error.message);
        }
      } finally {
        setSaving(false);
      }
    },
    [id],
  );

  if (loading) return <LoadingState label="Loading your question…" minHeight={320} />;

  if (loadError) {
    const isMissing = loadError?.is?.(ERROR_CODES.NOT_FOUND);

    return (
      <ErrorState
        // A stranger's question and a question that never existed are the same answer
        // here, deliberately: the server refuses to confirm which ids are real, and a
        // screen that said "that is not yours" would confirm it for them.
        error={isMissing ? 'We could not find that question. It may not be yours.' : loadError}
        title={isMissing ? 'Question not found' : 'Could not load your question'}
        onRetry={isMissing ? () => navigate('/app/ask') : load}
        retryLabel={isMissing ? 'Ask a new question' : 'Try again'}
        minHeight={320}
      />
    );
  }

  const topicLabel = topicLabelFor(topics, question.classification.subtopicId);
  const needsAnswer = !question.classification.classificationOk && !topicLabel;

  return (
    <Stack gap="lg" maw={640}>
      <Stack gap="xs">
        <Title order={1}>Your question</Title>
        <Text c="dimmed">
          Check this is right before we look for a teacher — it is what they will be matched on.
        </Text>
      </Stack>

      <ClassificationCard question={question} topicLabel={topicLabel} />

      {offerIsOut ? (
        <Alert
          icon={<IconInfoCircle size={16} />}
          color="blue"
          variant="light"
          title="This question is already with a teacher"
        >
          We have sent it out, so the topic is fixed now — a teacher is reading it as it stands. Ask
          a new question if this one needs a different topic.
        </Alert>
      ) : (
        <TopicOverride
          // Remounted whenever the saved answer changes, so the control re-seeds from
          // the server's value rather than keeping a draft that is now stale. The key
          // is the pair the student can move, not the whole question.
          key={`${question.classification.subtopicId}-${question.classification.estimatedLevel}`}
          topics={topics}
          subtopicId={question.classification.subtopicId}
          estimatedLevel={question.classification.estimatedLevel}
          onSave={saveOverride}
          saving={saving}
          error={overrideError}
          primary={needsAnswer}
        />
      )}

      <Group justify="flex-end">
        <Button
          size="md"
          rightSection={<IconArrowRight size={16} />}
          onClick={() => navigate(`/app/ask/${question.id}/teachers`)}
          // Not disabled on the fallback path: §8.1 is explicit that a failed
          // classification must not block the flow, and a question filed under the
          // sentinel is still matchable — worse ranked, not stuck. The picker above is
          // the primary action there, and this stays the way out.
          variant={needsAnswer ? 'default' : 'filled'}
        >
          {needsAnswer ? 'Find a teacher anyway' : 'Find me a teacher'}
        </Button>
      </Group>
    </Stack>
  );
}

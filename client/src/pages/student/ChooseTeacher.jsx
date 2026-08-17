import {
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { IconInfoCircle, IconRefresh, IconUsersGroup, IconWallet } from '@tabler/icons-react';
import { ERROR_CODES } from '@tutor/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { getMatches } from '@/api/matching.api';
import { getPricing, getTopics } from '@/api/public.api';
import { getQuestion } from '@/api/question.classification.api';
import MatchCard from '@/components/match/MatchCard';
import PriceCeiling from '@/components/match/PriceCeiling';
import EmptyState from '@/components/state/EmptyState';
import ErrorState from '@/components/state/ErrorState';
import LoadingState from '@/components/state/LoadingState';

/**
 * `/app/ask/:id/teachers` — the five teachers, and the choice. MVP.md §14.1, §14.2.
 * PR 4.7, on 4.5's endpoint and 4.4's two components.
 *
 * §14.2 calls this "the critical screen — worth more investment than any other
 * screen", and three of its rules are the ones a refactor loses first:
 *
 * **No score, no rank number, no percentage, no "best match".** The student sees an
 * order, not grades. `MatchesResponse` carries no score at all — 4.5 destructures it
 * away at the join — so the only way to break the rule is to invent one here by
 * numbering the cards or labelling the first. Nothing below does.
 *
 * **Credit is always minutes.** §5.4, and it is why `walletBalance` and `block` reach
 * every card: a price without the minutes it buys is the one number a student cannot
 * convert in their head.
 *
 * **The price ceiling lives in the query string, never in state.** A shared or
 * reloaded URL has to restore the list the student was looking at, and a `useState`
 * beside `useSearchParams` is a second source of truth that disagrees with the
 * address bar the first time somebody presses back. `Teachers.jsx` established the
 * pattern in 2.5 for the same reason.
 *
 * **Two fetch paths, because the three payloads have three lifetimes.** The question
 * is stable, the taxonomy and the pricing model are cached and unauthenticated, and
 * the match list goes stale the moment a teacher goes offline. So the first three are
 * loaded once on mount and the fourth re-runs whenever the ceiling changes or the
 * student asks to look again. Merging them would tie the cheapest of them to the
 * freshness of the most volatile.
 */

/**
 * The sentinel topic — "General / Unclassified", MVP.md §8.1.
 *
 * It is a real row and a real answer to a different question, so it is matched by id
 * and excluded from the heading rather than filtered by name. `getTopics` publishes
 * it as a childless root and deliberately does not special-case it (`topic.service.js`);
 * the consumer decides, and this consumer decides not to print it.
 */
const SENTINEL_TOPIC_ID = 0;

export default function ChooseTeacher() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  /**
   * The three stable payloads, loaded together and never reloaded by the controls.
   * One object rather than three states: no screen is renderable until all three have
   * answered — the heading needs the question and the taxonomy, the cards need the
   * block length — so three separate flags would be three ways to describe one wait.
   */
  const [context, setContext] = useState(null);
  const [contextError, setContextError] = useState(null);

  const [matches, setMatches] = useState(null);
  const [matchesError, setMatchesError] = useState(null);
  const [matchesLoading, setMatchesLoading] = useState(true);

  /**
   * The teacher the student pressed, or `null`.
   *
   * Doubles as the in-flight guard: while it is set, every send button on the screen
   * is disabled, so a second choice cannot be started from a neighbouring card. That
   * matters more than it looks — in E5 the callback below takes an atomic lock on a
   * teacher, and two open requests are the double-book §9.5 exists to prevent.
   */
  const [pendingChoice, setPendingChoice] = useState(null);

  /** `'A' | 'B' | 'C'`, or `null` for no band ceiling. The URL is the only copy. */
  const priceBand = searchParams.get('priceBand');

  const loadContext = useCallback(() => {
    let cancelled = false;

    setContextError(null);

    // One round trip's worth of latency instead of three, and there is no useful
    // screen to render until every one of them has answered. Two of the three are
    // unauthenticated and cached by the browser, so this is cheaper than it reads.
    Promise.all([getQuestion(id), getTopics(), getPricing()])
      .then(([question, topicData, pricing]) => {
        if (cancelled) return;

        setContext({ question, topics: topicData.topics, pricing });
      })
      .catch((error) => {
        if (!cancelled) setContextError(error);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  const loadMatches = useCallback(() => {
    let cancelled = false;

    setMatchesLoading(true);
    setMatchesError(null);

    // `priceBand` is passed as `undefined` rather than `null` when the URL has none:
    // axios drops an undefined param, and `matchesSchema` is strict about the rest.
    getMatches(id, { priceBand: priceBand ?? undefined })
      .then((data) => {
        if (!cancelled) setMatches(data);
      })
      .catch((error) => {
        if (!cancelled) setMatchesError(error);
      })
      .finally(() => {
        if (!cancelled) setMatchesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, priceBand]);

  useEffect(loadContext, [loadContext]);
  useEffect(loadMatches, [loadMatches]);

  /**
   * Move the ceiling, which means moving the URL.
   *
   * `replace: false` on purpose — each change is a history entry, because back is how
   * people undo a filter, and it is what makes a reloaded or shared link restore the
   * list somebody was actually looking at.
   */
  const changeBand = useCallback(
    (key) => {
      const next = new URLSearchParams(searchParams);

      next.set('priceBand', key);
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  /**
   * The E5 seam. **Frozen signature — `onChoose({ teacherId, pricePerBlock })`.**
   *
   * In this PR the body confirms the choice and stops. It creates no session, sends
   * no request and navigates nowhere, and that is deliberate rather than unfinished:
   * `POST /sessions/:id/offer`, the atomic teacher lock and the 60-second countdown
   * are all E5, 5.3 is human-written per §17.5, and §14.1 has no offer screen. A route
   * invented here would be a route E5 has to either honour or rename; a callback is
   * one function body E5 replaces in a file it already owns. The `sessionId` it will
   * need is already on the `QuestionResponse` this screen loaded.
   *
   * The functional update is the double-click guard: a second press in the same tick
   * keeps the first choice rather than replacing it, so the callback's effect happens
   * once even before the disabled prop has re-rendered.
   */
  const onChoose = useCallback((choice) => {
    setPendingChoice((current) => current ?? choice);
  }, []);

  if (contextError) {
    const isMissing = contextError?.is?.(ERROR_CODES.NOT_FOUND);

    return (
      <ErrorState
        // A stranger's question and a question that never existed are the same answer,
        // the same way 3.7 answers it: the server does not confirm which ids are real,
        // and a screen that said "that is not yours" would confirm it for them.
        error={isMissing ? 'We could not find that question. It may not be yours.' : contextError}
        title={isMissing ? 'Question not found' : 'Could not load your question'}
        onRetry={isMissing ? () => navigate('/app/ask') : loadContext}
        retryLabel={isMissing ? 'Ask a new question' : 'Try again'}
        minHeight={320}
      />
    );
  }

  if (!context) return <LoadingState label="Finding teachers for you…" minHeight={320} />;

  const { question, topics, pricing } = context;
  const heading = topicHeadingFor(topics, question.classification);
  const level = question.classification.estimatedLevel ?? question.declaredLevel;
  const offerIsOut = matchesError?.is?.(ERROR_CODES.SESSION_NOT_ACTIVE) === true;
  const chosen = pendingChoice
    ? matches?.teachers.find((match) => match.teacher.id === pendingChoice.teacherId)
    : null;

  return (
    <Stack gap="lg">
      <QuestionHeading
        questionId={question.id}
        heading={heading}
        level={level}
        walletBalance={matches?.walletBalance ?? null}
      />

      {!offerIsOut && (
        <Stack gap={6}>
          <PriceCeiling
            value={priceBand}
            onChange={changeBand}
            bands={pricing.bands}
            disabled={matchesLoading || pendingChoice !== null}
          />

          {/* "Why is Dana missing" has to have an answer on the page, and this is it.
              The ceiling the server actually applied is the lower of the band and what
              the balance affords, so it can sit below the button the student pressed —
              and when it does, the wallet is the reason and the control is not.

              Dropped for `INSUFFICIENT_CREDIT`, where the ceiling is ₪0 and the sentence
              would read as a filter the student set rather than as a balance they do not
              have. The empty state below says the true thing, with the amount. */}
          {matches && matches.reason !== ERROR_CODES.INSUFFICIENT_CREDIT && (
            <Text size="xs" c="dimmed">
              Showing teachers up to ₪{matches.priceCeiling} a block.
            </Text>
          )}
        </Stack>
      )}

      <MatchResults
        loading={matchesLoading}
        error={matchesError}
        offerIsOut={offerIsOut}
        matches={matches}
        pricing={pricing}
        subtopicName={heading.subtopicName}
        pendingChoice={pendingChoice}
        onChoose={onChoose}
        onRetry={loadMatches}
        onTopUp={() => navigate('/app/wallet')}
      />

      <ChoiceConfirmation
        match={chosen}
        block={pricing.block}
        onClose={() => setPendingChoice(null)}
      />
    </Stack>
  );
}

/**
 * §14.2's top block: what we are matching on, the way to change it, and the balance.
 *
 * `[edit topic]` is a link to 3.7's screen and not a picker of its own. That screen
 * owns the override, it already exists, and a second picker here would be a second
 * place for the student's correction to be written from.
 */
function QuestionHeading({ questionId, heading, level, walletBalance }) {
  return (
    <Stack gap="xs" maw={640}>
      <Title order={1}>Choose a teacher</Title>

      <Group gap="xs" wrap="wrap" align="center">
        {heading.label ? (
          // The label wraps rather than truncating. Mantine clips a `Badge` at its
          // container, and at 375px "Calculus — Integrals · Integration by parts"
          // clips to "…INTEGRATION BY PA…" — losing the leaf, which is the one thing
          // this line exists to say and the thing the whole match list was built on.
          <Badge
            variant="light"
            size="lg"
            radius="sm"
            h="auto"
            styles={{ label: { whiteSpace: 'normal', overflow: 'visible' } }}
            py={4}
          >
            {heading.label}
          </Badge>
        ) : (
          // Not "General / Unclassified". That is a real row and a real answer to a
          // different question, and printing it here would tell the student the
          // machine decided something when it decided nothing (§8.1). 3.7 makes the
          // same call on the previous screen and this wording agrees with it.
          <Text size="sm" c="dimmed">
            We could not work out this question&apos;s topic, so these are the teachers who are
            online and within your budget.
          </Text>
        )}

        {level && (
          <Badge variant="default" size="lg" radius="sm">
            {level} units
          </Badge>
        )}

        <Anchor component={Link} to={`/app/ask/${questionId}/matching`} size="sm">
          Edit topic
        </Anchor>
      </Group>

      {walletBalance !== null && (
        <Text size="sm" c="dimmed">
          Your balance:{' '}
          <Text span fw={600} c="var(--mantine-color-text)">
            ₪{walletBalance}
          </Text>
        </Text>
      )}
    </Stack>
  );
}

/**
 * Every state the list has, in one place so the screen above reads as a layout.
 *
 * The order of the checks is the order the states occur in, and the first one is the
 * one that keeps the screen still: `loading && !matches` means the whole-screen
 * spinner runs on the first load only. Pressing a price ceiling keeps the old cards
 * on screen with the control disabled, because blanking a list on every press makes a
 * filter feel broken even when it is fast.
 */
function MatchResults({
  loading,
  error,
  offerIsOut,
  matches,
  pricing,
  subtopicName,
  pendingChoice,
  onChoose,
  onRetry,
  onTopUp,
}) {
  if (offerIsOut) {
    // Not an error, and not a list. An offer is already out, so the pool this screen
    // would show is a way to double-book a student — the same rule 3.7 states on the
    // previous screen, in the same words.
    return (
      <Alert
        icon={<IconInfoCircle size={16} />}
        color="blue"
        variant="light"
        title="This question is already with a teacher"
      >
        We have sent it out and we are waiting for an answer, so there is nobody left to choose. Ask
        a new question if you need a different teacher.
      </Alert>
    );
  }

  if (error) {
    const isMissing = error?.is?.(ERROR_CODES.NOT_FOUND);

    return (
      <ErrorState
        error={isMissing ? 'We could not find that question. It may not be yours.' : error}
        title={isMissing ? 'Question not found' : 'Could not load teachers'}
        onRetry={onRetry}
        minHeight={320}
      />
    );
  }

  if (loading && !matches)
    return <LoadingState label="Finding teachers for you…" minHeight={320} />;

  if (!matches) return null;

  // Both reasons are read from `shared/errorCodes.js` rather than written as string
  // literals, for the reason `matching.service.js` gives on the other side of the
  // wire: they are values on a 200 payload and not thrown errors, and the catalogue
  // is the one place the two halves can agree on their spelling.
  if (matches.reason === ERROR_CODES.INSUFFICIENT_CREDIT) {
    // The product working exactly as designed for a student with no money, so it is
    // an empty state and not an alert. The number is concrete — an opening block at
    // the cheapest price anyone on the platform charges — because "not enough credit"
    // without an amount cannot be acted on.
    const cheapestOpening = pricing.price.min * pricing.block.openingBlocks;

    return (
      <EmptyState
        icon={IconWallet}
        title="Your balance does not cover an opening block"
        message={`The cheapest teacher on the platform starts at ₪${cheapestOpening} for the first ${pricing.block.openingMinutes} minutes, and you have ₪${matches.walletBalance}. Top up and they will all be here.`}
        actionLabel="Go to your wallet"
        onAction={onTopUp}
        minHeight={320}
      />
    );
  }

  if (matches.reason === ERROR_CODES.NO_AVAILABLE_TEACHERS) {
    // Two different sentences for two different empty pools, and neither is red. The
    // ceiling is only worth mentioning when raising it could change the answer — when
    // the wallet is what is binding, "raise your ceiling" is advice that does nothing.
    const canRaiseCeiling = matches.priceCeiling < highestBandCeiling(pricing.bands);

    return (
      <EmptyState
        icon={IconUsersGroup}
        title="Nobody who teaches this is online right now"
        message={
          canRaiseCeiling
            ? 'Teachers come online through the day. Try a higher price ceiling, or look again in a moment.'
            : 'Teachers come online through the day. Look again in a moment.'
        }
        actionLabel="Look again"
        onAction={onRetry}
        minHeight={320}
      />
    );
  }

  return (
    <Stack gap="lg">
      {/* Two columns from 768px (§14.4), one below it, so a card is full width on a
          375px phone and the row never scrolls sideways. */}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
        {matches.teachers.map((match) => (
          <MatchCard
            key={match.teacher.id}
            match={match}
            subtopicName={subtopicName}
            walletBalance={matches.walletBalance}
            block={pricing.block}
            onChoose={onChoose}
            disabled={pendingChoice !== null}
          />
        ))}
      </SimpleGrid>

      <Group justify="center">
        {/* §14.2's "🔄 show me more teachers", worded as what it actually does. There
            is no offset and no page two — `MATCH_COUNT` is 5 and the sixth-best
            teacher is not a product — so the honest promise is "look again": teachers
            go online and offline, and from E5 on the pool shrinks as offers are
            rejected. Promising *different* teachers would be promising a page that
            does not exist. */}
        <Button
          variant="light"
          leftSection={<IconRefresh size={16} />}
          onClick={onRetry}
          loading={loading}
          disabled={pendingChoice !== null}
        >
          Look again
        </Button>
      </Group>
    </Stack>
  );
}

/**
 * What pressing "Send request" does in E4: it says what would happen, and stops.
 *
 * The one thing this modal must not do is imply that anything was sent. Nothing was:
 * the offer flow is E5, and `MVP.md` §18's own note about half-built demos applies
 * exactly here — rendering a plausible "request sent!" instead of the honest state is
 * how a demo becomes a lie. So it names the teacher and the real opening-block cost,
 * both of which are true today, and says plainly that the sending part is not built.
 */
function ChoiceConfirmation({ match, block, onClose }) {
  const opened = Boolean(match);
  const openingCost = match ? match.teacher.pricePerBlock * block.openingBlocks : 0;

  return (
    <Modal opened={opened} onClose={onClose} title="Ready to send" centered>
      {match && (
        <Stack gap="sm">
          <Text>
            <Text span fw={600}>
              {match.teacher.fullName}
            </Text>{' '}
            costs ₪{match.teacher.pricePerBlock} a block, so the {block.openingMinutes}-minute
            opening block with them is ₪{openingCost}, charged when they accept.
          </Text>

          <Text size="sm" c="dimmed">
            We have not sent anything yet — this is where the request goes out, and that part is
            still being built.
          </Text>

          <Group justify="flex-end">
            <Button onClick={onClose}>Got it</Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

/**
 * The question's topic as a heading, and the leaf name the cards need.
 *
 * Resolved on the client on purpose: `MatchesResponse` carries no topic name, because
 * the taxonomy is already published, already cached, and already loaded twice by this
 * flow. A name in the match payload would be a fourth copy of a string the client can
 * look up for free.
 *
 * Three answers, in order of what the student actually chose or was told:
 *
 * - the leaf, as "Calculus · Integrals", plus its name on its own for the cards
 * - the parent alone, when a question has a real topic and no leaf under it
 * - nothing, for the sentinel — which the caller renders as a sentence rather than as
 *   a topic name
 *
 * A leaf id the taxonomy no longer has — F1 is going to move rows — falls through to
 * the parent rather than producing a broken label.
 *
 * @returns {{label: string|null, subtopicName: string|null}}
 */
function topicHeadingFor(topics, { topicId, subtopicId }) {
  for (const parent of topics) {
    const leaf = (parent.children ?? []).find((child) => child.id === subtopicId);

    if (leaf) return { label: `${parent.nameEn} · ${leaf.nameEn}`, subtopicName: leaf.nameEn };
  }

  if (topicId !== SENTINEL_TOPIC_ID) {
    const parent = topics.find((topic) => topic.id === topicId);

    if (parent) return { label: parent.nameEn, subtopicName: null };
  }

  return { label: null, subtopicName: null };
}

/** The most any band lets through — `bands` is cheapest first (`pricing.service.js`). */
function highestBandCeiling(bands) {
  return bands.length === 0 ? 0 : bands[bands.length - 1].maxPrice;
}

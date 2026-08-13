import { Badge, useMantineTheme } from '@mantine/core';

/**
 * A teacher's standing badge — MVP.md §6.2.
 *
 * The badge is the platform making a public claim about a person, on a screen a
 * stranger reads before deciding whether to trust them. So it is one component:
 * the list, the profile and the teacher's own edit preview render the identical
 * thing, and there is no second place for a colour or a label to drift.
 *
 * **The client never decides which badge a teacher carries.** `standingOf` on the
 * server computes it from sessions and ratings and sends it in the payload; this
 * file only decides what it looks like. Anything here that inspected
 * `sessionsCount` would be a second implementation of §6.2.
 *
 * Colours come from `theme.other.badgeColors`, which is frozen (PR 0.5). The four
 * were chosen to stay distinguishable from the primary teal at a glance, which is
 * the whole job on a list of twenty cards.
 */

/**
 * What each badge says out loud.
 *
 * English, like the rest of the UI — `client/index.html` fixes that in PR 0.5, and
 * a Hebrew label here would be the only one on the screen. Topic names carry both
 * languages from the database and are a separate decision.
 *
 * The wording is deliberately about the platform's own record rather than about the
 * person: "Experienced" is a claim we can support from session count, whereas
 * "Excellent" is one we cannot.
 */
const BADGE_LABELS = {
  TOP: 'Top rated',
  EXPERIENCED: 'Experienced',
  ACTIVE: 'Active',
  NEW: 'New',
};

/**
 * @param {'NEW'|'ACTIVE'|'EXPERIENCED'|'TOP'} badge  from the API, never computed here
 * @param {string} [size]  passed through to Mantine
 */
export default function TeacherBadge({ badge, size = 'sm' }) {
  const theme = useMantineTheme();

  // An unknown badge means the server grew a fifth band and this map did not.
  // Rendering nothing is better than rendering an uncoloured chip with a raw enum
  // in it, which is what a fallback label would produce.
  if (!BADGE_LABELS[badge]) return null;

  return (
    <Badge color={theme.other.badgeColors[badge]} variant="light" size={size}>
      {BADGE_LABELS[badge]}
    </Badge>
  );
}

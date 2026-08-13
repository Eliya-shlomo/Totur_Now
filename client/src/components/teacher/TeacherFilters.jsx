import { Button, Group, Select, Switch } from '@mantine/core';
import { IconFilterOff } from '@tabler/icons-react';

/**
 * The four filters on `GET /teachers` — topic, level, price band, online only.
 *
 * Controlled and stateless. The screen owns the values because they live in the URL
 * (`Teachers.jsx`), and a filter bar that kept its own copy would be a second source
 * of truth that disagrees with the address bar the moment somebody presses back.
 *
 * Every option list is passed in rather than written here. Topics come from
 * `GET /public/topics`, bands from `GET /public/pricing`, and the level list is the
 * only one with a literal — see below.
 *
 * @param {object} value                      the current filters, all optional
 * @param {(patch: object) => void} onChange   merged into the current filters
 * @param {() => void} onClear
 * @param {Array}  topics  the two-level tree from `/public/topics`
 * @param {Array<{key: string, minPrice: number, maxPrice: number}>} bands
 * @param {boolean} hasFilters  whether anything is set — drives the clear button
 */
export default function TeacherFilters({
  value,
  onChange,
  onClear,
  topics,
  bands,
  hasFilters,
  disabled = false,
}) {
  return (
    <Group gap="sm" align="flex-end" wrap="wrap">
      <Select
        label="Topic"
        placeholder="Any topic"
        data={toTopicGroups(topics)}
        value={value.topicId ?? null}
        onChange={(topicId) => onChange({ topicId })}
        disabled={disabled}
        clearable
        searchable
        w={{ base: '100%', xs: 220 }}
      />

      <Select
        label="Level"
        placeholder="Any level"
        data={LEVEL_OPTIONS}
        value={value.level ?? null}
        onChange={(level) => onChange({ level })}
        disabled={disabled}
        clearable
        w={{ base: '100%', xs: 160 }}
      />

      <Select
        label="Price"
        placeholder="Any price"
        data={toBandOptions(bands)}
        value={value.band ?? null}
        onChange={(band) => onChange({ band })}
        disabled={disabled}
        clearable
        w={{ base: '100%', xs: 200 }}
      />

      <Switch
        label="Online now"
        checked={value.onlineOnly === 'true'}
        onChange={(event) => onChange({ onlineOnly: event.currentTarget.checked ? 'true' : null })}
        disabled={disabled}
        mb={6}
      />

      {hasFilters && (
        <Button
          variant="subtle"
          leftSection={<IconFilterOff size={16} />}
          onClick={onClear}
          disabled={disabled}
          mb={2}
        >
          Clear filters
        </Button>
      )}
    </Group>
  );
}

/**
 * The taxonomy as Mantine option groups — parents become headings, leaves become
 * options.
 *
 * **Only leaves are selectable**, which is the same rule the server enforces on a
 * teacher's `topicIds` (2.2). A parent is not a teachable claim: the matching engine
 * scores on the subtopic (§9.3), so filtering by "Algebra" would ask a question the
 * ranking cannot answer. A childless root — the seeded `General / Unclassified`
 * sentinel (§8.1) — contributes no group at all rather than an empty one.
 *
 * Values are strings because that is what a `<select>` and a query string both hold.
 * The number conversion happens once, at the request, in `Teachers.jsx`.
 */
function toTopicGroups(topics) {
  return topics
    .filter((parent) => parent.children?.length > 0)
    .map((parent) => ({
      group: parent.nameEn,
      items: parent.children.map((child) => ({
        value: String(child.id),
        label: child.nameEn,
      })),
    }));
}

/**
 * The bands, labelled with the range they cover and the fact that they are a
 * ceiling.
 *
 * "Up to ₪14" rather than "₪10–14": a band is a ceiling, not a bracket (§5.2), and
 * a student who reads a bracket will wonder where the cheap teachers went. The
 * numbers come from `/public/pricing`, which derives them from `money.js`, so the
 * label cannot disagree with what the filter actually does.
 */
function toBandOptions(bands) {
  return bands.map((band) => ({
    value: band.key,
    label: `Up to ₪${band.maxPrice} / block`,
  }));
}

/**
 * The three self-declared teaching levels — §6.1.
 *
 * The one literal list in this file. `TEACHING_LEVELS` lives in the server's
 * `constants/teacher.js` and is not published through `@tutor/shared` or any public
 * endpoint, so importing it here is not available today. Exposing it is a change to
 * a shared contract, which is a chat message before code rather than something to
 * slip into a screen PR — noted for 2.7.
 *
 * The filter means "can teach at least this level", matching `levelMax >= level` on
 * the server, so the labels say so.
 */
const LEVEL_OPTIONS = [
  { value: '3', label: '3 units and up' },
  { value: '4', label: '4 units and up' },
  { value: '5', label: '5 units' },
];

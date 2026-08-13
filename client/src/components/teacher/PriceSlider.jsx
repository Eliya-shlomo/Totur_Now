import { Box, Group, Slider, Stack, Text } from '@mantine/core';

/**
 * The price per block — step 3 of the onboarding stepper (PR 2.4).
 *
 * Controlled and stateless, like the other two pickers.
 *
 * **Not one number in this file.** The bounds are `price.min` / `price.max` and the
 * bands are `bands`, both straight from `GET /public/pricing`, which derives them from
 * `server/src/config/constants/money.js` — the same module the wallet charges from.
 * That is the whole reason the endpoint exists (`pricing.service.js`): a screen that
 * can disagree with the billing code is worse than no screen, and the only way to
 * guarantee it cannot is to give it no numbers of its own. This is now the second
 * pricing surface in the app after `/pricing`, and the rule holds harder here — the
 * teacher is choosing a number the platform will enforce, not reading a marketing
 * page.
 *
 * The band is shown as the teacher moves, because the band is the part they cannot
 * see from the number: a student filters by ceiling (§5.2), so the difference between
 * the top of one band and the bottom of the next is a difference in who ever sees the
 * profile, and a teacher who does not know that will read a one-credit change as
 * cosmetic.
 *
 * @param {number} value  credits per block
 * @param {(price: number) => void} onChange
 * @param {number} min  `price.min` from `/public/pricing`
 * @param {number} max  `price.max` from `/public/pricing`
 * @param {Array<{key: string, minPrice: number, maxPrice: number}>} bands
 * @param {string} [error]
 * @param {boolean} [disabled]  while a save is in flight
 */
export default function PriceSlider({ value, onChange, min, max, bands, error, disabled = false }) {
  const band = bandOf(value, bands);

  return (
    <Stack gap="xs">
      <Stack gap={2}>
        <Text fw={500} size="sm">
          What do you charge per block?
        </Text>
        <Text size="xs" c="dimmed">
          A student pays this for each block of your time. You can change it whenever you like.
        </Text>
      </Stack>

      <Group justify="space-between" align="baseline" mt="xs">
        <Text fw={700} fz={32} lh={1}>
          ₪{value}
        </Text>
        <Text size="sm" c="dimmed">
          per block
        </Text>
      </Group>

      {/* The marks sit under the track and the outermost two are half-clipped by the
          container at 375px without this. */}
      <Box px="sm" pb="xl" pt="xs">
        <Slider
          value={value}
          onChange={onChange}
          min={min}
          max={max}
          // Credits are integers everywhere in this system (`money.js`), and the
          // server rejects a fractional price as "not a whole number".
          step={1}
          marks={toMarks(bands, min)}
          label={(price) => `₪${price}`}
          disabled={disabled}
          aria-label="Price per block, in credits"
        />
      </Box>

      <BandReadout band={band} />

      {error && (
        // `Slider` has no `error` prop, so the message is rendered here in the same
        // size and colour Mantine's inputs use for theirs.
        <Text size="xs" c="red">
          {error}
        </Text>
      )}
    </Stack>
  );
}

/**
 * Which band a price falls in — the client mirror of `bandOf` in
 * `server/src/utils/pricing.js`, computed over the payload rather than over a copy of
 * the boundaries.
 *
 * A band is a **ceiling**, not a bracket, so the first band the price fits under
 * wins. The last band is the fallback for the same reason the server uses `?? 'C'`:
 * the top band's ceiling is `MAX_PRICE_PER_BLOCK`, so a value above it is out of
 * range rather than in no band at all.
 */
function bandOf(price, bands) {
  return bands.find((band) => price <= band.maxPrice) ?? bands[bands.length - 1];
}

/**
 * A mark at the floor and at every band ceiling.
 *
 * The band boundaries are the only places on this track where moving one credit
 * changes who can find the teacher, so they are the only places worth labelling. The
 * values come from the payload — a boundary written here would be the second copy
 * `/public/pricing` exists to prevent.
 */
function toMarks(bands, min) {
  return [
    { value: min, label: `₪${min}` },
    ...bands.map((band) => ({ value: band.maxPrice, label: `₪${band.maxPrice}` })),
  ];
}

/**
 * The band the current price lands in, and what it means for being found.
 *
 * Phrased as who sees them rather than as a letter: `B` means nothing to a teacher on
 * their first day, and "students filtering up to ₪14" is the same fact in the form
 * they can act on.
 */
function BandReadout({ band }) {
  if (!band) return null;

  return (
    <Text size="sm" c="dimmed">
      Band {band.key} — students who filter for teachers up to ₪{band.maxPrice} per block will find
      you.
    </Text>
  );
}

import { createTheme } from '@mantine/core';

/**
 * Project theme. FROZEN after PR 0.5 — see docs/OWNERSHIP.md §2.
 *
 * Every later client PR reads from here and adds nothing to it. A component that
 * hardcodes a colour or a radius is a failed review; the value belongs in this file
 * or in `other` below.
 */
export const theme = createTheme({
  // Teal, deliberately: purple / blue / green / yellow are reserved for teacher
  // standing badges (MVP.md §6.2), so the brand colour must not collide with them.
  primaryColor: 'teal',
  primaryShade: { light: 6, dark: 5 },

  defaultRadius: 'md',

  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  headings: { fontWeight: '700' },

  // Must stay in sync with client/postcss.config.cjs, which feeds the same values
  // to Mantine's CSS mixins. MVP.md §14.4.
  breakpoints: {
    xs: '36em', // 576px
    sm: '48em', // 768px  — below this: single column + bottom nav
    md: '64em', // 1024px — below this: collapsible sidebar
    lg: '75em', // 1200px
    xl: '88em', // 1408px
  },

  other: {
    /**
     * Teacher standing badges — MVP.md §6.2. Single source so no screen invents its
     * own mapping. Standing is earned on the platform and computed from session
     * count and rating; the client never decides which badge a teacher carries, it
     * only decides what colour it is.
     *
     * Amended on the 8/11 revision: was CERTIFIED / STUDENT / NEW, which described
     * credentials the platform no longer checks (§6.1). Grape and blue stay because
     * both remain distinguishable from the primary teal at a glance on the
     * selection screen — the reason they were chosen in the first place.
     */
    badgeColors: {
      TOP: 'yellow', // ⭐ 100+ sessions AND rating ≥ 4.5
      EXPERIENCED: 'grape', // 🟣 25+ sessions
      ACTIVE: 'blue', // 🔵 5–24 sessions
      NEW: 'green', // 🟢 under 5 sessions — gets the cold-start boost
    },

    /** Session timer states — MVP.md §14.3. Used by the E6 session screens. */
    timerColors: {
      normal: 'teal',
      warning: 'orange', // T-60s, extension modal is up
      critical: 'red', // grace period before auto-end
    },

    /** Layout constants the shells share. */
    layout: {
      headerHeight: 60,
      sidebarWidth: 260,
      bottomNavHeight: 64,
    },
  },
});

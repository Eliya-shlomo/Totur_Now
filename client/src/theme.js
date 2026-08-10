import { createTheme } from '@mantine/core';

/**
 * Project theme. FROZEN after PR 0.5 — see docs/OWNERSHIP.md §2.
 *
 * Every later client PR reads from here and adds nothing to it. A component that
 * hardcodes a colour or a radius is a failed review; the value belongs in this file
 * or in `other` below.
 */
export const theme = createTheme({
  // Teal, deliberately: purple / blue / green are reserved for teacher tier badges
  // (MVP.md §6.4), so the brand colour must not collide with the tier signal.
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
     * Teacher tier badges — MVP.md §6.4. Single source so no screen invents its own
     * mapping. `Certified` is grape rather than plain violet because it has to stay
     * distinguishable from the primary teal at a glance on the selection screen.
     */
    badgeColors: {
      CERTIFIED: 'grape', // 🟣 approved teaching certificate
      STUDENT: 'blue', // 🔵 verified academic email
      NEW: 'green', // 🟢 passed the entrance exam only
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

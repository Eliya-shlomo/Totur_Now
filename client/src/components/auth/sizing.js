/**
 * The two numbers that make these screens usable on a phone.
 *
 * `theme.js` is frozen after PR 0.5, so there is no global component default to set
 * — every input and button on both screens takes `size={FIELD_SIZE}` explicitly, and
 * this constant is what stops the two screens from drifting apart one field at a time.
 *
 * `lg` rather than the `md` used elsewhere: Mantine's `md` input is 42px tall and
 * `lg` is 50px, and 44px is the floor for a tap target. These are the first screens a
 * real user meets, and they meet them on a phone.
 */
export const FIELD_SIZE = 'lg';

/**
 * 44px — the tap-target floor. Applied by hand to the controls Mantine sizes by text
 * content rather than by `size`, such as a text link.
 */
export const MIN_TAP_TARGET = 44;

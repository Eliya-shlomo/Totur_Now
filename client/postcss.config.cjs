// Required by Mantine v7. Without postcss-preset-mantine its mixins
// (light/dark schemes, rtl, hover) and the breakpoint variables below
// silently do nothing.
//
// Breakpoints match MVP.md §14.4: mobile < 768px, tablet 768–1024px, desktop > 1024px.
module.exports = {
  plugins: {
    'postcss-preset-mantine': {},
    'postcss-simple-vars': {
      variables: {
        'mantine-breakpoint-xs': '36em', // 576px
        'mantine-breakpoint-sm': '48em', // 768px
        'mantine-breakpoint-md': '64em', // 1024px
        'mantine-breakpoint-lg': '75em', // 1200px
        'mantine-breakpoint-xl': '88em', // 1408px
      },
    },
  },
};

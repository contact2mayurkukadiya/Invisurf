'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { resolveAppliedTokens } = require('../../../src/theme/chromeTheme.cjs');

describe('Internal Pages (invisurf://) Neutral Black & White Background Test Suite', () => {
  const ROOT = path.resolve(__dirname, '../../..');

  const NEUTRAL_LIGHT_BG = '#f7f8f9';
  const NEUTRAL_DARK_BG = '#121316';
  const NEUTRAL_LIGHT_SURFACE = '#ffffff';
  const NEUTRAL_DARK_SURFACE = '#18191d';

  describe('1. Chrome Theme Content Tokens Contract (chromeTheme.cjs)', () => {
    const builtInThemes = ['ocean', 'forest', 'sunset', 'violet', 'amber', 'indigo', 'mint', 'slate', 'default'];

    test('all built-in themes provide neutral dark background (#121316) in dark mode', () => {
      for (const theme of builtInThemes) {
        const darkTokens = resolveAppliedTokens({ accentTheme: theme, colorTheme: 'dark' }, true);
        assert.equal(
          darkTokens['--chrome-content-bg'],
          NEUTRAL_DARK_BG,
          `Theme ${theme} in dark mode must have --chrome-content-bg equal to ${NEUTRAL_DARK_BG}`
        );
        assert.equal(
          darkTokens['--chrome-content-surface'],
          NEUTRAL_DARK_SURFACE,
          `Theme ${theme} in dark mode must have --chrome-content-surface equal to ${NEUTRAL_DARK_SURFACE}`
        );
      }
    });

    test('all built-in themes provide neutral light background (#f7f8f9) in light mode', () => {
      for (const theme of builtInThemes) {
        const lightTokens = resolveAppliedTokens({ accentTheme: theme, colorTheme: 'light' }, false);
        assert.equal(
          lightTokens['--chrome-content-bg'],
          NEUTRAL_LIGHT_BG,
          `Theme ${theme} in light mode must have --chrome-content-bg equal to ${NEUTRAL_LIGHT_BG}`
        );
        assert.equal(
          lightTokens['--chrome-content-surface'],
          NEUTRAL_LIGHT_SURFACE,
          `Theme ${theme} in light mode must have --chrome-content-surface equal to ${NEUTRAL_LIGHT_SURFACE}`
        );
      }
    });

    test('custom accent color themes resolve to neutral background rather than accent tint', () => {
      const customColors = ['#ff0055', '#00ff88', '#9900ee', '#ffaa00'];
      for (const customHex of customColors) {
        const dark = resolveAppliedTokens({ accentTheme: 'custom', accentCustomHex: customHex, colorTheme: 'dark' }, true);
        assert.equal(dark['--chrome-content-bg'], NEUTRAL_DARK_BG, 'Custom theme dark content background must be neutral black');

        const light = resolveAppliedTokens({ accentTheme: 'custom', accentCustomHex: customHex, colorTheme: 'light' }, false);
        assert.equal(light['--chrome-content-bg'], NEUTRAL_LIGHT_BG, 'Custom theme light content background must be neutral white');
      }
    });
  });

  describe('2. Downloads Page Reference Tokens (DownloadsApp.css)', () => {
    const css = fs.readFileSync(path.join(ROOT, 'src/downloads/DownloadsApp.css'), 'utf8');

    test('defines light mode reference tokens in :root and [data-forced-appearance="light"]', () => {
      assert.match(css, /--dl-bg-page:\s*#f7f8f9/, 'Downloads light page background must be #f7f8f9');
      assert.match(css, /--dl-bg-header:\s*#ffffff/, 'Downloads light header background must be #ffffff');
      assert.match(css, /html\[data-forced-appearance="light"\]/, 'Downloads must support forced light appearance');
    });

    test('defines dark mode reference tokens in @media (prefers-color-scheme: dark) and [data-forced-appearance="dark"]', () => {
      assert.match(css, /--dl-bg-page:\s*#121316/, 'Downloads dark page background must be #121316');
      assert.match(css, /--dl-bg-header:\s*#18191d/, 'Downloads dark header background must be #18191d');
      assert.match(css, /html\[data-forced-appearance="dark"\]/, 'Downloads must support forced dark appearance');
    });
  });

  describe('3. History Page Theme Alignment (HistoryApp.css)', () => {
    const css = fs.readFileSync(path.join(ROOT, 'src/history/HistoryApp.css'), 'utf8');

    test('defines neutral background in :root and light mode', () => {
      assert.match(css, /--bg:\s*#f7f8f9/, 'History light page background must be #f7f8f9');
      assert.match(css, /--white:\s*#ffffff/, 'History light surface must be #ffffff');
    });

    test('defines neutral background in dark mode and forced dark appearance', () => {
      assert.match(css, /--bg:\s*#121316/, 'History dark page background must be #121316');
      assert.match(css, /--white:\s*#18191d/, 'History dark surface must be #18191d');
      assert.match(css, /html\[data-forced-appearance="dark"\][\s\S]*?--bg:\s*#121316/, 'Forced dark mode must set --bg to #121316');
      assert.match(css, /html\[data-forced-appearance="light"\][\s\S]*?--bg:\s*#f7f8f9/, 'Forced light mode must set --bg to #f7f8f9');
    });

    test('body binds to neutral background variable and does not leak accent-tinted variables', () => {
      assert.match(css, /body\s*\{[^}]*background:\s*var\(--bg\)/, 'History body must use var(--bg)');
      assert.doesNotMatch(css, /background:\s*var\(--chrome-shell-tint\)/, 'History body must not use --chrome-shell-tint');
      assert.doesNotMatch(css, /background:\s*var\(--chrome-nav-bg\)/, 'History body must not use --chrome-nav-bg');
    });
  });

  describe('4. Bookmark Page Theme Alignment (BookmarkApp.css)', () => {
    const css = fs.readFileSync(path.join(ROOT, 'src/bookmark/BookmarkApp.css'), 'utf8');

    test('defines neutral background in :root and light mode', () => {
      assert.match(css, /--bg:\s*#f7f8f9/, 'Bookmark light page background must be #f7f8f9');
      assert.match(css, /--white:\s*#ffffff/, 'Bookmark light surface must be #ffffff');
    });

    test('defines neutral background in dark mode and forced dark appearance', () => {
      assert.match(css, /--bg:\s*#121316/, 'Bookmark dark page background must be #121316');
      assert.match(css, /--white:\s*#18191d/, 'Bookmark dark surface must be #18191d');
      assert.match(css, /html\[data-forced-appearance="dark"\][\s\S]*?--bg:\s*#121316/, 'Forced dark mode must set --bg to #121316');
      assert.match(css, /html\[data-forced-appearance="light"\][\s\S]*?--bg:\s*#f7f8f9/, 'Forced light mode must set --bg to #f7f8f9');
    });

    test('body binds to neutral background variable and does not leak accent-tinted variables', () => {
      assert.match(css, /body\s*\{[^}]*background:\s*var\(--bg\)/, 'Bookmark body must use var(--bg)');
      assert.doesNotMatch(css, /background:\s*var\(--chrome-shell-tint\)/, 'Bookmark body must not use --chrome-shell-tint');
      assert.doesNotMatch(css, /background:\s*var\(--chrome-nav-bg\)/, 'Bookmark body must not use --chrome-nav-bg');
    });
  });

  describe('5. Settings Page Theme Alignment (SettingsApp.css)', () => {
    const css = fs.readFileSync(path.join(ROOT, 'src/settings/SettingsApp.css'), 'utf8');

    test('body canvas uses --chrome-content-bg with neutral fallbacks', () => {
      assert.match(css, /background:\s*var\(--chrome-content-bg,\s*var\(--settings-app-bg/, 'Settings body must bind to var(--chrome-content-bg)');
      assert.match(css, /--settings-app-bg:\s*var\(--chrome-content-bg,\s*#121316\)/, 'Settings dark fallback must be #121316');
      assert.match(css, /--settings-app-bg:\s*var\(--chrome-content-bg,\s*#f7f8f9\)/, 'Settings light fallback must be #f7f8f9');
    });

    test('sidebar and cards bind to neutral surface tokens', () => {
      assert.match(css, /--settings-surface:\s*var\(--chrome-content-surface,\s*#ffffff\)/, 'Settings light surface must be #ffffff');
      assert.match(css, /--settings-surface:\s*var\(--chrome-content-surface,\s*#18191d\)/, 'Settings dark surface must be #18191d');
    });

    test('does not use --chrome-shell-tint or --chrome-header-bg for canvas background', () => {
      assert.doesNotMatch(css, /--settings-app-bg:\s*var\(--chrome-shell-tint\)/, 'Settings must not bind app-bg to --chrome-shell-tint');
      assert.doesNotMatch(css, /--settings-app-bg:\s*var\(--chrome-header-bg\)/, 'Settings must not bind app-bg to --chrome-header-bg');
    });
  });

  describe('6. Extensions Page Theme Alignment (ExtensionsPage.css & extensions.html)', () => {
    const css = fs.readFileSync(path.join(ROOT, 'src/extensions/ExtensionsPage.css'), 'utf8');
    const html = fs.readFileSync(path.join(ROOT, 'src/extensions.html'), 'utf8');

    test('defines neutral background tokens in :root and light mode', () => {
      assert.match(css, /--ext-bg-page:\s*#f7f8f9/, 'Extensions light page background must be #f7f8f9');
      assert.match(css, /--ext-bg-header:\s*#ffffff/, 'Extensions light header background must be #ffffff');
    });

    test('defines neutral background tokens in dark mode and forced dark appearance', () => {
      assert.match(css, /--ext-bg-page:\s*#121316/, 'Extensions dark page background must be #121316');
      assert.match(css, /--ext-bg-header:\s*#18191d/, 'Extensions dark header background must be #18191d');
      assert.match(css, /html\[data-forced-appearance="dark"\][\s\S]*?--ext-bg-page:\s*#121316/, 'Forced dark must set --ext-bg-page to #121316');
      assert.match(css, /html\[data-forced-appearance="light"\][\s\S]*?--ext-bg-page:\s*#f7f8f9/, 'Forced light must set --ext-bg-page to #f7f8f9');
    });

    test('html shell does not use --chrome-shell-tint fallback', () => {
      assert.doesNotMatch(html, /--chrome-shell-tint/, 'extensions.html must not use --chrome-shell-tint fallback');
      assert.match(html, /var\(--chrome-content-bg,\s*#f7f8f9\)/, 'extensions.html must use neutral --chrome-content-bg fallback');
    });
  });

  describe('7. New Tab Page Theme Alignment (NewTabApp.css)', () => {
    const css = fs.readFileSync(path.join(ROOT, 'src/newtab/NewTabApp.css'), 'utf8');

    test('defines neutral surface tokens in :root and light mode', () => {
      assert.match(css, /--ntp-surface:\s*#f7f8f9/, 'NewTab light surface must be #f7f8f9');
      assert.match(css, /--ntp-white:\s*#ffffff/, 'NewTab light white must be #ffffff');
    });

    test('defines neutral surface tokens in dark mode and forced dark appearance', () => {
      assert.match(css, /--ntp-surface:\s*#121316/, 'NewTab dark surface must be #121316');
      assert.match(css, /--ntp-white:\s*#18191d/, 'NewTab dark white must be #18191d');
      assert.match(css, /html\[data-forced-appearance="dark"\][\s\S]*?--ntp-surface:\s*#121316/, 'Forced dark must set --ntp-surface to #121316');
      assert.match(css, /html\[data-forced-appearance="light"\][\s\S]*?--ntp-surface:\s*#f7f8f9/, 'Forced light must set --ntp-surface to #f7f8f9');
    });

    test('body and ntp background gradient bind directly to --ntp-surface without accent overrides', () => {
      assert.match(css, /background:\s*var\(--ntp-surface\)/, 'NewTab root/body must bind directly to var(--ntp-surface)');
      assert.doesNotMatch(css, /background:\s*var\(--chrome-slider/, 'NewTab must not override background with --chrome-slider');
      assert.doesNotMatch(css, /background:\s*var\(--chrome-body-bg/, 'NewTab must not override background with --chrome-body-bg');
    });
  });

  describe('8. Dynamic Theme Accent Tokens & Bookmark Delete Confirmation Dialog', () => {
    test('resolves accent tokens dynamically per preset theme in light and dark mode', () => {
      const forestDark = resolveAppliedTokens({ accentTheme: 'forest', colorTheme: 'dark' }, true);
      assert.equal(forestDark['--chrome-accent'], '#4ade80', 'Forest dark accent must be #4ade80');
      assert.equal(forestDark['--chrome-content-active-fg'], '#4ade80');

      const forestLight = resolveAppliedTokens({ accentTheme: 'forest', colorTheme: 'light' }, false);
      assert.equal(forestLight['--chrome-accent'], '#16a34a', 'Forest light accent must be #16a34a');
      assert.equal(forestLight['--chrome-content-active-fg'], '#16a34a');

      const oceanLight = resolveAppliedTokens({ accentTheme: 'ocean', colorTheme: 'light' }, false);
      assert.equal(oceanLight['--chrome-accent'], '#0284c7', 'Ocean light accent must be #0284c7');
    });

    test('BookmarkApp.css defines delete confirmation dialog classes matching other delete modals', () => {
      const css = fs.readFileSync(path.join(ROOT, 'src/bookmark/BookmarkApp.css'), 'utf8');
      assert.match(css, /\.b-delete-modal-desc/, 'Must define .b-delete-modal-desc');
      assert.match(css, /\.b-delete-modal-preview/, 'Must define .b-delete-modal-preview');
      assert.match(css, /\.b-modal-cancel/, 'Must define .b-modal-cancel with pill borders');
      assert.match(css, /\.b-modal-delete/, 'Must define .b-modal-delete with dynamic accent token');
      assert.match(css, /background:\s*var\(--chrome-accent,\s*var\(--blue\)\)/, 'Delete button must use dynamic accent');
    });
  });
});

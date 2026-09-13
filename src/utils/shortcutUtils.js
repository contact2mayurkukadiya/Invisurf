/**
 * Utility functions for keyboard shortcut parsing, formatting, and matching
 */

export function isMacPlatform() {
  if (typeof process !== 'undefined' && process.platform) {
    return process.platform === 'darwin';
  }
  if (typeof navigator !== 'undefined' && navigator.platform) {
    return /Mac/i.test(navigator.platform);
  }
  return false;
}

export function formatShortcutForDisplay(shortcutStr, options = {}) {
  if (!shortcutStr || typeof shortcutStr !== 'string') return '';
  const { compact = false } = options;
  const isMac = isMacPlatform();
  const parts = shortcutStr.split('+').map((p) => p.trim());
  const formatted = [];

  for (const part of parts) {
    const pLower = part.toLowerCase();
    if (pLower === 'cmdorctrl' || pLower === 'commandorcontrol') {
      formatted.push(compact ? (isMac ? '⌘' : 'Ctrl') : 'Ctrl/Cmd');
    } else if (pLower === 'ctrl' || pLower === 'control') {
      formatted.push(compact ? (isMac ? '⌃' : 'Ctrl') : 'Ctrl');
    } else if (pLower === 'cmd' || pLower === 'meta') {
      formatted.push(compact ? '⌘' : 'Cmd');
    } else if (pLower === 'shift') {
      formatted.push(compact ? (isMac ? '⇧' : 'Shift') : 'Shift');
    } else if (pLower === 'alt' || pLower === 'option') {
      formatted.push(compact ? (isMac ? '⌥' : 'Alt') : 'Alt');
    } else if (pLower === 'up' || pLower === 'arrowup') {
      formatted.push(compact ? '↑' : 'Up');
    } else if (pLower === 'down' || pLower === 'arrowdown') {
      formatted.push(compact ? '↓' : 'Down');
    } else if (pLower === 'left' || pLower === 'arrowleft') {
      formatted.push(compact ? '←' : 'Left');
    } else if (pLower === 'right' || pLower === 'arrowright') {
      formatted.push(compact ? '→' : 'Right');
    } else if (pLower === 'plus' || pLower === '=') {
      formatted.push(compact ? '+' : 'Plus');
    } else if (pLower === 'minus' || pLower === '-') {
      formatted.push(compact ? '-' : 'Minus');
    } else if (pLower === 'space') {
      formatted.push('Space');
    } else if (pLower === 'tab') {
      formatted.push('Tab');
    } else if (pLower === 'enter' || pLower === 'return') {
      formatted.push('Enter');
    } else if (pLower === 'backspace' || pLower === 'delete') {
      formatted.push('Backspace');
    } else {
      formatted.push(part.toUpperCase());
    }
  }

  return compact && isMac ? formatted.join('') : formatted.join(' + ');
}

export function parseShortcut(str) {
  if (!str || typeof str !== 'string') return null;
  const parts = str.split('+').map((p) => p.trim());
  let needCtrlOrCmd = false;
  let needShift = false;
  let needAlt = false;
  let key = '';

  for (const part of parts) {
    const pLower = part.toLowerCase();
    if (
      pLower === 'cmdorctrl' ||
      pLower === 'commandorcontrol' ||
      pLower === 'ctrl' ||
      pLower === 'cmd' ||
      pLower === 'meta' ||
      pLower === 'control'
    ) {
      needCtrlOrCmd = true;
    } else if (pLower === 'shift') {
      needShift = true;
    } else if (pLower === 'alt' || pLower === 'option') {
      needAlt = true;
    } else {
      key = pLower;
    }
  }
  return { needCtrlOrCmd, needShift, needAlt, key };
}

export function matchesShortcut(input, shortcutStr) {
  const parsed = parseShortcut(shortcutStr);
  if (!parsed || !input) return false;

  const isCtrlOrCmd = !!(input.control || input.meta);
  if (parsed.needCtrlOrCmd !== isCtrlOrCmd) return false;
  if (parsed.needShift !== !!input.shift) return false;
  if (parsed.needAlt !== !!input.alt) return false;

  const inKey = (input.key || '').toLowerCase();
  const inCode = (input.code || '').toLowerCase();
  const target = parsed.key.toLowerCase();

  // Arrow keys
  if (target === 'up' || target === 'arrowup') {
    return inKey === 'arrowup' || inKey === 'up' || inCode === 'arrowup';
  }
  if (target === 'down' || target === 'arrowdown') {
    return inKey === 'arrowdown' || inKey === 'down' || inCode === 'arrowdown';
  }
  if (target === 'left' || target === 'arrowleft') {
    return inKey === 'arrowleft' || inKey === 'left' || inCode === 'arrowleft';
  }
  if (target === 'right' || target === 'arrowright') {
    return inKey === 'arrowright' || inKey === 'right' || inCode === 'arrowright';
  }

  // Digits 0-9 with or without shift symbols
  if (/^[0-9]$/.test(target)) {
    const shiftSymbols = {
      '!': '1',
      '@': '2',
      '#': '3',
      '$': '4',
      '%': '5',
      '^': '6',
      '&': '7',
      '*': '8',
      '(': '9',
      ')': '0',
    };
    if (inKey === target || shiftSymbols[inKey] === target) return true;
    if (inCode === `digit${target}` || inCode === `numpad${target}`) return true;
    return false;
  }

  // Plus / Minus
  if (target === 'plus' || target === '+' || target === '=') {
    return inKey === '+' || inKey === '=' || inCode === 'equal' || inCode === 'numpadadd';
  }
  if (target === 'minus' || target === '-') {
    return inKey === '-' || inKey === '_' || inCode === 'minus' || inCode === 'numpadsubtract';
  }

  if (inKey === target) return true;
  if (inCode === `key${target}`) return true;

  return false;
}

export function eventToShortcutString(e) {
  if (!e) return null;
  const isCtrlOrCmd = e.ctrlKey || e.metaKey;
  const isShift = e.shiftKey;
  const isAlt = e.altKey;

  const key = e.key;
  // Ignore lonely modifier keys
  if (['Control', 'Meta', 'Shift', 'Alt', 'CapsLock'].includes(key)) {
    return null;
  }

  const parts = [];
  if (isCtrlOrCmd) parts.push('CmdOrCtrl');
  if (isAlt) parts.push('Alt');
  if (isShift) parts.push('Shift');

  let keyPart = key;
  if (key === 'ArrowUp') keyPart = 'Up';
  else if (key === 'ArrowDown') keyPart = 'Down';
  else if (key === 'ArrowLeft') keyPart = 'Left';
  else if (key === 'ArrowRight') keyPart = 'Right';
  else if (key === ' ' || key === 'Space') keyPart = 'Space';
  else if (key === '+' || key === '=' || e.code === 'Equal' || e.code === 'NumpadAdd') keyPart = 'Plus';
  else if (key === '-' || key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract') keyPart = '-';
  else if (e.code && e.code.startsWith('Digit')) {
    keyPart = e.code.replace('Digit', '');
  } else if (e.code && e.code.startsWith('Key')) {
    keyPart = e.code.replace('Key', '');
  } else if (key.length === 1) {
    keyPart = key.toUpperCase();
  }

  parts.push(keyPart);
  return parts.join('+');
}

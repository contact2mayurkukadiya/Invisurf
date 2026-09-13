/**
 * Helper to parse and match keyboard input events against shortcut strings in Electron main process
 */

function parseShortcut(str) {
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

function matchesShortcut(input, shortcutStr) {
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

module.exports = {
    parseShortcut,
    matchesShortcut
};

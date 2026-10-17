'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../../src/constants/conditionStrings.cjs');

test('Overscroll Navigation Constants and Physics', async (t) => {
    await t.test('conditionStrings defines required overscroll IPC constants', () => {
        assert.equal(C.IPC_SEND.OVERSCROLL_TRIGGER_NAVIGATION, 'overscroll:trigger-navigation');
        assert.equal(C.IPC_SEND.OVERSCROLL_REQUEST_SYNC, 'overscroll:request-sync');
        assert.equal(C.IPC_EVENT.OVERSCROLL_SYNC_STATE, 'overscroll:sync-state');
        assert.equal(C.IPC_EVENT.OVERSCROLL_FINGER_LIFTED, 'overscroll:finger-lifted');
        assert.equal(C.IPC_EVENT.OVERSCROLL_GESTURE_BEGIN, 'overscroll:gesture-begin');
    });

    await t.test('single swipe session direction locking and pause behavior', () => {
        // State machine simulation for a touch session
        let lockedDirection = null;
        let accumulatedX = 0;
        let isArmed = false;
        const THRESHOLD = 60;

        function onWheel(deltaX) {
            if (!lockedDirection) {
                lockedDirection = deltaX < 0 ? 'back' : 'forward';
            }

            if (lockedDirection === 'back') {
                accumulatedX -= deltaX;
                if (accumulatedX < 0) accumulatedX = 0;
            } else if (lockedDirection === 'forward') {
                accumulatedX += deltaX;
                if (accumulatedX < 0) accumulatedX = 0;
            }
            isArmed = accumulatedX >= THRESHOLD;
        }

        function onFingerLift() {
            const triggered = isArmed ? lockedDirection : null;
            lockedDirection = null;
            accumulatedX = 0;
            isArmed = false;
            return triggered;
        }

        // 1. User starts swiping right (back)
        onWheel(-40);
        assert.equal(lockedDirection, 'back');
        assert.equal(accumulatedX, 40);
        assert.equal(isArmed, false);

        // 2. Swipes more to reach armed state
        onWheel(-30);
        assert.equal(lockedDirection, 'back');
        assert.equal(accumulatedX, 70);
        assert.equal(isArmed, true);

        // 3. User stops swiping without lifting finger (pause):
        // No wheel events, no lift -> state must remain strictly held!
        assert.equal(lockedDirection, 'back');
        assert.equal(accumulatedX, 70);
        assert.equal(isArmed, true);

        // 4. Continuous left and right motion in single swipe:
        // User moves in reverse (deltaX > 0)
        onWheel(100); // Exceeds current accumulatedX
        // Must clamp at 0 and must NOT switch to 'forward'!
        assert.equal(lockedDirection, 'back');
        assert.equal(accumulatedX, 0);
        assert.equal(isArmed, false);

        // User wiggles right again without lifting fingers
        onWheel(-50);
        assert.equal(lockedDirection, 'back');
        assert.equal(accumulatedX, 50);

        // 5. User lifts fingers while sub-threshold
        const triggeredNav = onFingerLift();
        assert.equal(triggeredNav, null);
        assert.equal(lockedDirection, null);

        // 6. Fresh finger contact can now choose forward
        onWheel(80);
        assert.equal(lockedDirection, 'forward');
        assert.equal(accumulatedX, 80);
        assert.equal(isArmed, true);

        const forwardNav = onFingerLift();
        assert.equal(forwardNav, 'forward');
    });

    await t.test('displacement calculation smoothly reveals to half circle and caps at threshold', () => {
        const THRESHOLD = 60;
        const MAX_DISPLACEMENT = 75;

        function calculateDisplacement(delta) {
            if (delta >= THRESHOLD) {
                return MAX_DISPLACEMENT;
            }
            const progress = Math.max(0, delta / THRESHOLD);
            return MAX_DISPLACEMENT * Math.sin((progress * Math.PI) / 2);
        }

        // At 0 displacement is 0
        assert.equal(calculateDisplacement(0), 0);

        // Sub-threshold displacement (e.g. 30px)
        const disp30 = calculateDisplacement(30);
        assert.ok(disp30 > 0 && disp30 < MAX_DISPLACEMENT);
        assert.ok(disp30 > 40 && disp30 < 60);

        // At threshold (60px), displacement is exactly MAX_DISPLACEMENT (half circle: 75px)
        const disp60 = calculateDisplacement(THRESHOLD);
        assert.equal(disp60, MAX_DISPLACEMENT);

        // Beyond threshold (e.g. 100px, 1000px): stops more revealing, strictly clamped at 75px
        assert.equal(calculateDisplacement(70), MAX_DISPLACEMENT);
        assert.equal(calculateDisplacement(100), MAX_DISPLACEMENT);
        assert.equal(calculateDisplacement(1000), MAX_DISPLACEMENT);
    });

    await t.test('instant release and momentum rejection during navigation lockout', () => {
        let isNavigating = false;
        let isCooldown = false;
        let lockedDirection = null;
        let accumulatedX = 0;
        let triggeredNav = null;
        const THRESHOLD = 60;

        function onWheel(deltaX) {
            // Drop trailing momentum wheel events while navigating or in cooldown
            if (isNavigating || isCooldown) return false;

            if (!lockedDirection) {
                lockedDirection = deltaX < 0 ? 'back' : 'forward';
            }
            if (lockedDirection === 'back') {
                accumulatedX -= deltaX;
            } else {
                accumulatedX += deltaX;
            }
            return true;
        }

        function onFingerLift() {
            if (isNavigating) return null;
            if (accumulatedX >= THRESHOLD && lockedDirection) {
                triggeredNav = lockedDirection;
                isNavigating = true;
            } else {
                isCooldown = true;
            }
            accumulatedX = 0;
            lockedDirection = null;
            return triggeredNav;
        }

        // Swipes back to reach threshold
        assert.equal(onWheel(-70), true);
        assert.equal(accumulatedX, 70);

        // Immediate release fires navigation instantly
        const nav = onFingerLift();
        assert.equal(nav, 'back');
        assert.equal(isNavigating, true);

        // Trailing momentum wheel events arriving right after release are discarded
        assert.equal(onWheel(-50), false);
        assert.equal(onWheel(-30), false);
        assert.equal(lockedDirection, null); // Did not resurrect ghost gesture!

        // Page navigation sync completes
        isNavigating = false;
        isCooldown = false;

        // Fresh swipe can now proceed
        assert.equal(onWheel(80), true);
        assert.equal(lockedDirection, 'forward');
    });

    await t.test('rapid input-event debouncing within 50ms window', () => {
        let lastLiftTime = 0;
        let liftEventsEmitted = 0;

        function handleInputEvent(type, timestamp) {
            if (type === 'gestureScrollEnd' || type === 'gestureFlingStart') {
                if (timestamp - lastLiftTime < 50) return false;
                lastLiftTime = timestamp;
                liftEventsEmitted++;
                return true;
            }
            return false;
        }

        // 1. gestureFlingStart fires at t = 1000
        assert.equal(handleInputEvent('gestureFlingStart', 1000), true);
        assert.equal(liftEventsEmitted, 1);

        // 2. Overlapping gestureScrollEnd fires 10ms later at t = 1010
        assert.equal(handleInputEvent('gestureScrollEnd', 1010), false);
        assert.equal(liftEventsEmitted, 1); // Debounced!

        // 3. New gesture release fires at t = 1200 (> 50ms later)
        assert.equal(handleInputEvent('gestureScrollEnd', 1200), true);
        assert.equal(liftEventsEmitted, 2);
    });
});


import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const TabOverlayContext = createContext(null);

/**
 * Tier 3 (legacy): ref-counted tab snapshot + detach so shell HTML can paint above WebContentsView.
 * Prefer Tier 1 (native Menu.popup) or Tier 2 (`ChromeOverlayContext` / chromeOverlayV1*) for new UI.
 * beginOverlay/endOverlay must be paired; forceResetOverlay clears on window close/reload.
 */
export function TabOverlayProvider({ children }) {
  const [tabSnapshotDataUrl, setTabSnapshotDataUrl] = useState(null);
  const [sidebarSnapshotDataUrl, setSidebarSnapshotDataUrl] = useState(null);
  const [splitSnapshot, setSplitSnapshot] = useState(null);
  const [isLensSnapshot, setIsLensSnapshot] = useState(false);
  const overlayCountRef = useRef(0);

  const endOverlay = useCallback(() => {
    if (overlayCountRef.current === 0) return;
    overlayCountRef.current -= 1;
    if (overlayCountRef.current === 0) {
      setTabSnapshotDataUrl(null);
      setSidebarSnapshotDataUrl(null);
      setSplitSnapshot(null);
      setIsLensSnapshot(false);
      window.electronAPI.tabRestoreActive?.();
    }
  }, []);

  const beginOverlay = useCallback(async () => {
    const wasZero = overlayCountRef.current === 0;
    overlayCountRef.current += 1;
    if (!wasZero) return;

    /**
     * Native WebContentsView stacks above the BrowserWindow shell. Main must capture
     * the tab and sidebar while they are still visible, then hide them in one handler
     * so no frame shows shell UI (e.g. modals, omnibox) behind native views.
     */
    try {
      let result = null;
      const prep = window.electronAPI.tabPrepareShellOverlay?.();
      if (prep) {
        result = await prep;
      } else {
        await window.electronAPI.tabHideActive?.();
        result = { dataUrl: null, sidebarDataUrl: null, isLensMode: false, splitSnapshot: null };
      }
      if (overlayCountRef.current === 0) return;
      const dataUrl = result?.dataUrl ?? null;
      const sidebarDataUrl = result?.sidebarDataUrl ?? null;
      const splitSnap = result?.splitSnapshot ?? null;
      setIsLensSnapshot(!!result?.isLensMode);
      if (dataUrl) setTabSnapshotDataUrl(dataUrl);
      if (sidebarDataUrl) setSidebarSnapshotDataUrl(sidebarDataUrl);
      if (splitSnap) setSplitSnapshot(splitSnap);
    } catch (err) {
      console.error('beginOverlay', err);
      endOverlay();
    }
  }, [endOverlay]);

  const forceResetOverlay = useCallback(() => {
    overlayCountRef.current = 0;
    setTabSnapshotDataUrl(null);
    setSidebarSnapshotDataUrl(null);
    setSplitSnapshot(null);
    setIsLensSnapshot(false);
    window.electronAPI.tabRestoreActive?.();
  }, []);

  useEffect(() => {
    const onUnload = () => {
      forceResetOverlay();
    };
    window.addEventListener('beforeunload', onUnload);
    window.addEventListener('pagehide', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      window.removeEventListener('pagehide', onUnload);
      forceResetOverlay();
    };
  }, [forceResetOverlay]);

  const value = useMemo(
    () => ({
      beginOverlay,
      endOverlay,
      forceResetOverlay,
      splitSnapshot,
    }),
    [beginOverlay, endOverlay, forceResetOverlay, splitSnapshot],
  );

  return (
    <TabOverlayContext.Provider value={value}>
      {tabSnapshotDataUrl ? (
        <div className={`tab-content-snapshot ${isLensSnapshot ? 'tab-content-snapshot--lens' : ''}`} aria-hidden>
          <img src={tabSnapshotDataUrl} alt="" draggable={false} />
        </div>
      ) : null}
      {sidebarSnapshotDataUrl ? (
        <div className="side-panel-content-snapshot" aria-hidden>
          <img src={sidebarSnapshotDataUrl} alt="" draggable={false} />
        </div>
      ) : null}
      {children}
    </TabOverlayContext.Provider>
  );
}

export function useTabOverlay() {
  const ctx = useContext(TabOverlayContext);
  if (!ctx) {
    throw new Error('useTabOverlay must be used within TabOverlayProvider');
  }
  return ctx;
}

export function useOptionalTabOverlay() {
  return useContext(TabOverlayContext);
}

export { TabOverlayContext };

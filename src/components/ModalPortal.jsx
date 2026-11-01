import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders modal dialogs into document.body, escaping any ancestor
 * CSS stacking contexts (e.g. .header with position:relative and z-index:1).
 * Ensures modals sit at the root level of the DOM with z-index: 30000,
 * floating above both the sidebar (z-index: 2) and left content card (z-index: 1).
 */
export default function ModalPortal({ children }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (!mounted || typeof document === 'undefined') {
    return null;
  }

  return createPortal(children, document.body);
}

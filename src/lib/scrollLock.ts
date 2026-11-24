let lockCount = 0;
let savedOverflow = "";

/**
 * Locks body scroll; returns an unlock function. Ref-counted so nested overlays
 * (panel + confirm dialog) can unmount in any order without leaving the page stuck.
 */
export function lockBodyScroll(): () => void {
  if (lockCount === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  lockCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount -= 1;
    if (lockCount === 0) document.body.style.overflow = savedOverflow;
  };
}

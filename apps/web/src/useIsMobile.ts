import { useEffect, useState } from 'react';

// Single source of truth for the app's mobile breakpoint. Must match the
// `@media (max-width: 760px)` rules in the CSS modules so the JS-driven
// layout switches (bottom sheet, collapsed toolbar, layers menu) flip at
// exactly the same width as the style changes.
const QUERY = '(max-width: 760px)';

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mobile;
}

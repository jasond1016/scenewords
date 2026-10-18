import { useEffect, useRef } from "react";

// A new result or operation cancels the previous deadline, including on unmount.
export function useFeedbackTimeout(clear: () => void, result: unknown, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(clear, 1500);
    return () => window.clearTimeout(timer);
  }, [clear, result, active]);
}

export function useMutationFeedback(mutation: {
  isSuccess: boolean;
  submittedAt: number;
  reset: () => void;
}, scope: string | undefined) {
  const { isSuccess, submittedAt, reset } = mutation;
  const previousScope = useRef(scope);
  useEffect(() => {
    if (previousScope.current !== scope) reset();
    previousScope.current = scope;
  }, [scope, reset]);
  useFeedbackTimeout(reset, submittedAt, isSuccess);
}

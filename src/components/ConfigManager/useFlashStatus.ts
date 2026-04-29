import { useCallback, useEffect, useRef } from "react";
import type { StatusMessage } from "../../lib/settingsSchema";

const FLASH_STATUS_MS = 2000;

export function useFlashStatus(onStatus: (msg: StatusMessage | null) => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  return useCallback((message: StatusMessage, durationMs = FLASH_STATUS_MS) => {
    clearTimer();
    onStatus(message);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      onStatus(null);
    }, durationMs);
  }, [clearTimer, onStatus]);
}

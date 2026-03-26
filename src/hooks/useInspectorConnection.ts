import { useEffect, useRef, useCallback, useState } from "react";
import { dlog } from "../lib/debugLog";

/** Delay before first connection attempt (PTY needs ~50ms to spawn, Bun ~1s to init). */
const CONNECT_DELAY_MS = 1000;
/** Max reconnection attempts before giving up. */
const MAX_RETRIES = 3;
/** Backoff delays for reconnection attempts. */
const RETRY_DELAYS = [2000, 4000, 8000];

/**
 * Manages the BUN_INSPECT WebSocket connection lifecycle.
 * Sends Console.enable on connect. No polling, no state derivation.
 * State detection is handled by useTapPipeline + useTapEventProcessor.
 */
export function useInspectorConnection(
  sessionId: string | null,
  port: number | null,
  reconnectKey?: number
): {
  connected: boolean;
  disconnect: () => void;
  wsSend: (method: string, params?: Record<string, unknown>) => number;
  registerExternalHandler: (handler: ((msg: Record<string, unknown>) => void) | null) => void;
} {
  const [connected, setConnected] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const externalHandlerRef = useRef<((msg: Record<string, any>) => void) | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const msgIdRef = useRef(1);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  // Send a WebSocket message with auto-incrementing id
  const wsSend = useCallback((method: string, params?: Record<string, unknown>): number => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return -1;
    const id = msgIdRef.current++;
    ws.send(JSON.stringify({ id, method, params }));
    return id;
  }, []);

  // Connect to inspector WebSocket
  const connectRef = useRef<(port: number) => void>(() => {});
  const connect = useCallback((wsPort: number) => {
    const url = `ws://127.0.0.1:${wsPort}/0`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      dlog("inspector", sessionIdRef.current, `connected port=${wsPort}`);
      retryCountRef.current = 0;
      setConnected(true);
      // Enable console domain for Console.messageAdded push events
      wsSend("Console.enable");
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        // Log Runtime.evaluate exceptions
        if (msg.result?.exceptionDetails) {
          dlog("inspector", sessionIdRef.current, `evaluation error: ${msg.result.exceptionDetails.text || msg.result.exceptionDetails.exception?.description}`, "WARN");
        }

        // Forward all messages to external handler (tap pipeline)
        externalHandlerRef.current?.(msg);
      } catch {
        // Invalid message — skip
      }
    };

    ws.onclose = () => {
      dlog("inspector", sessionIdRef.current, `disconnected port=${wsPort}`);
      setConnected(false);
      wsRef.current = null;

      // Retry with backoff
      if (retryCountRef.current < MAX_RETRIES && sessionIdRef.current) {
        const delay = RETRY_DELAYS[retryCountRef.current] || 8000;
        retryCountRef.current++;
        dlog("inspector", sessionIdRef.current, `reconnecting attempt=${retryCountRef.current}/${MAX_RETRIES} delay=${delay}ms`, "DEBUG");
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          if (sessionIdRef.current) connectRef.current(wsPort);
        }, delay);
      }
    };

    ws.onerror = () => {
      // onclose fires after onerror — reconnection handled there
    };
  }, [wsSend]);
  connectRef.current = connect;

  const disconnect = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    const ws = wsRef.current;
    if (ws) {
      ws.onclose = null; // Prevent reconnection
      ws.close();
      wsRef.current = null;
    }
    setConnected(false);
    retryCountRef.current = 0;
    msgIdRef.current = 1;
  }, []);

  // Lifecycle: connect after delay when port is available
  useEffect(() => {
    if (!sessionId || !port) return;

    retryCountRef.current = 0;

    const timer = setTimeout(() => {
      connect(port);
    }, CONNECT_DELAY_MS);

    return () => {
      clearTimeout(timer);
      disconnect();
    };
  }, [sessionId, port, connect, disconnect, reconnectKey]);

  const registerExternalHandler = useCallback((handler: ((msg: Record<string, unknown>) => void) | null) => {
    externalHandlerRef.current = handler;
  }, []);

  return { connected, disconnect, wsSend, registerExternalHandler };
}

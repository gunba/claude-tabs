---
paths:
  - "src/hooks/useStartupBootstrap.ts"
---

# src/hooks/useStartupBootstrap.ts

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Hooks Manager

- [HM-11 L31] Hook configuration is user-managed only: claude-tabs may read and edit existing Claude hook files via the Hooks UI, but it never auto-installs or mutates user hook settings on startup.

## Weather
Ambient weather data pipeline for the header activity visualizer.

- [WX-01 L37] Cloudflare-derived weather for the header activity visualizer flows through the proxy and Tauri weather module: proxy responses from Anthropic/OpenAI read cf-ipcountry and call weather::set_country without blocking response streaming; lib.rs starts weather::init and registers get_current_weather; weather/mod.rs accepts two-letter non-XX country codes, maps known countries to representative coordinates, fetches Open-Meteo current conditions, persists the latest payload, emits weather-changed, and exposes the cached payload for startup hydration; useStartupBootstrap hydrates and subscribes once, and the weather store mirrors WeatherPayload fields for the renderer.

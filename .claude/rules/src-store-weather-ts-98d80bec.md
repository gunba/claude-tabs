---
paths:
  - "src/store/weather.ts"
---

# src/store/weather.ts

Tag line: `L<n>`; code usually starts at `L<n+1>`.

## Weather
Ambient weather data pipeline for the header activity visualizer.

- [WX-01 L5] Cloudflare-derived weather for the header activity visualizer flows through the proxy and Tauri weather module: proxy responses from Anthropic/OpenAI read cf-ipcountry and call weather::set_country without blocking response streaming; lib.rs starts weather::init and registers get_current_weather; weather/mod.rs accepts two-letter non-XX country codes, maps known countries to representative coordinates, fetches Open-Meteo current conditions, persists the latest payload, emits weather-changed, and exposes the cached payload for startup hydration; useStartupBootstrap hydrates and subscribes once, and the weather store mirrors WeatherPayload fields for the renderer.

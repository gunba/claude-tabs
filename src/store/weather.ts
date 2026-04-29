import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// [WX-01] Weather payload mirrors src-tauri/src/weather/mod.rs::WeatherPayload.
// Filled by `weather-changed` Tauri events (poll loop) plus the cached
// invoke on app startup. Country is the cf-ipcountry value the proxy saw
// on the most recent Anthropic / OpenAI response.

export interface WeatherPayload {
  country: string;
  label: string;
  weatherCode: number;
  tempC: number;
  windKph: number;
  precipMm: number;
  updatedAt: number;
  sunriseHour?: number | null;
  sunsetHour?: number | null;
}

interface WeatherState {
  country: string | null;
  label: string | null;
  weatherCode: number | null;
  tempC: number | null;
  windKph: number | null;
  precipMm: number | null;
  updatedAt: number | null;
  sunriseHour: number | null;
  sunsetHour: number | null;
  initialized: boolean;
  init: () => Promise<void>;
}

export const useWeatherStore = create<WeatherState>((set, get) => ({
  country: null,
  label: null,
  weatherCode: null,
  tempC: null,
  windKph: null,
  precipMm: null,
  updatedAt: null,
  sunriseHour: null,
  sunsetHour: null,
  initialized: false,
  init: async () => {
    if (get().initialized) return;
    set({ initialized: true });

    try {
      const cached = await invoke<WeatherPayload | null>("get_current_weather");
      if (cached) {
        set({
          country: cached.country,
          label: cached.label,
          weatherCode: cached.weatherCode,
          tempC: cached.tempC,
          windKph: cached.windKph,
          precipMm: cached.precipMm,
          updatedAt: cached.updatedAt,
          sunriseHour: cached.sunriseHour ?? null,
          sunsetHour: cached.sunsetHour ?? null,
        });
      }
    } catch {
      // Stay on null weather values; the event listener can still fill them later.
    }

    listen<WeatherPayload>("weather-changed", (event) => {
      const p = event.payload;
      set({
        country: p.country,
        label: p.label,
        weatherCode: p.weatherCode,
        tempC: p.tempC,
        windKph: p.windKph,
        precipMm: p.precipMm,
        updatedAt: p.updatedAt,
        sunriseHour: p.sunriseHour ?? null,
        sunsetHour: p.sunsetHour ?? null,
        initialized: true,
      });
    }).catch(() => {
      // Subscription failed; stay on whatever cache we already have.
    });
  },
}));

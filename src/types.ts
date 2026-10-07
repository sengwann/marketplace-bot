import type { Context, Scenes } from "telegraf";

export const CATEGORY_LABELS = {
  ELECTRONICS: "📱 အီလက်ထရောနစ်",
  CLOTHING: "👕 အဝတ်အထည်",
  HOME: "🏠 အိမ်သုံးပစ္စည်း",
  VEHICLE: "🚗 ယာဉ်",
  OTHER: "📦 အခြား",
} as const;

export const LOCATION_LABELS = {
  SHWE_KOKKO: "📍 ရွှေက္ကိုလ်",
  MYAWADDY: "📍 မြဝတီ",
} as const;

// ASCII-only names, used for channel hashtags.
export const CATEGORY_TAGS: Record<Category, string> = {
  ELECTRONICS: "Electronics",
  CLOTHING: "Fashion",
  HOME: "Home",
  VEHICLE: "Vehicle",
  OTHER: "Other",
};

export const LOCATION_TAGS: Record<Location, string> = {
  SHWE_KOKKO: "ShweKokko",
  MYAWADDY: "Myawaddy",
};

export type Category = keyof typeof CATEGORY_LABELS;
export type Location = keyof typeof LOCATION_LABELS;
export type Currency = "MMK" | "THB";

export const CATEGORIES = Object.keys(CATEGORY_LABELS) as Category[];
export const LOCATIONS = Object.keys(LOCATION_LABELS) as Location[];

export function isCategory(value: string): value is Category {
  return (CATEGORIES as string[]).includes(value);
}

export function isLocation(value: string): value is Location {
  return (LOCATIONS as string[]).includes(value);
}

// ------------------------------------------------------------
// Telegraf context (wizard scene + session)
// ------------------------------------------------------------

export interface MyWizardSession extends Scenes.WizardSessionData {}

export interface MySession extends Scenes.WizardSession<MyWizardSession> {}

export interface MyContext extends Context {
  session: MySession;
  scene: Scenes.SceneContextScene<MyContext, MyWizardSession>;
  wizard: Scenes.WizardContextWizard<MyContext>;
}

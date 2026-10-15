"use client";

import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

export const THEME_COOKIE = "nrl-theme";
export const THEME_EVENT = "nrl-theme";

function applyTheme(next: "light" | "dark") {
  document.documentElement.classList.toggle("dark", next === "dark");
  document.cookie = `${THEME_COOKIE}=${next};path=/;max-age=31536000;samesite=lax`;
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function ThemeToggle() {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label="Switch color theme"
      onClick={() => applyTheme(document.documentElement.classList.contains("dark") ? "light" : "dark")}
    >
      <Sun className="hidden h-4 w-4 dark:block" />
      <Moon className="h-4 w-4 dark:hidden" />
    </Button>
  );
}

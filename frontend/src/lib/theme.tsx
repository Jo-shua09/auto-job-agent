import { useEffect, useState } from "react";

export type Theme = "dark" | "light";

export const themeInitScript = `(function(){try{document.documentElement.classList.toggle('dark',(localStorage.getItem('jh-theme')||'dark')==='dark');}catch(e){document.documentElement.classList.add('dark');}})();`;

export function useTheme() {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);
  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    localStorage.setItem("jh-theme", next);
    setTheme(next);
  };
  return { theme, toggle };
}

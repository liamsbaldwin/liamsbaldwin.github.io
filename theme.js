(function () {
  const root = document.documentElement;
  const btn = document.querySelector(".theme-toggle");
  const key = "theme";

  // Load saved preference
  const saved = localStorage.getItem(key);
  if (saved === "dark") root.classList.add("dark");

  // If no saved pref, you *could* respect system preference (optional):
  // if (!saved && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
  //   root.classList.add("dark");
  // }

  btn?.addEventListener("click", () => {
    root.classList.toggle("dark");
    localStorage.setItem(key, root.classList.contains("dark") ? "dark" : "light");
  });
})();

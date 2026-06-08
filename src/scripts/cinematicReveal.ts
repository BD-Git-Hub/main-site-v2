const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const revealItems = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
const header = document.querySelector<HTMLElement>(".site-header");
const progress = document.querySelector<HTMLElement>(".site-header__progress");
const hero = document.querySelector<HTMLElement>(".hero");

const revealNow = (item: HTMLElement) => {
  item.classList.add("is-visible");
};

if ("IntersectionObserver" in window && !reduceMotion) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          continue;
        }

        revealNow(entry.target as HTMLElement);
        observer.unobserve(entry.target);
      }
    },
    {
      rootMargin: "0px 0px -12% 0px",
      threshold: 0.12,
    },
  );

  for (const item of revealItems) {
    observer.observe(item);
  }
} else {
  revealItems.forEach(revealNow);
}

const updateScrollState = () => {
  const scrollTop = window.scrollY;
  const scrollRange = document.documentElement.scrollHeight - window.innerHeight;
  const scrollProgress = scrollRange > 0 ? scrollTop / scrollRange : 0;

  progress?.style.setProperty("--scroll-progress", `${Math.min(scrollProgress, 1)}`);
  header?.classList.toggle("is-scrolled", scrollTop > 24);

  if (hero && !reduceMotion) {
    const heroHeight = Math.max(hero.offsetHeight, 1);
    const heroProgress = Math.min(scrollTop / heroHeight, 1);
    hero.style.setProperty("--hero-scroll", heroProgress.toFixed(3));
  }

};

updateScrollState();
window.addEventListener("scroll", updateScrollState, { passive: true });
window.addEventListener("resize", updateScrollState);

document.addEventListener(
  "astro:before-swap",
  () => {
    window.removeEventListener("scroll", updateScrollState);
    window.removeEventListener("resize", updateScrollState);
  },
  { once: true },
);

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const revealItems = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
const header = document.querySelector<HTMLElement>(".site-header");
const progress = document.querySelector<HTMLElement>(".site-header__progress");
const hero = document.querySelector<HTMLElement>(".hero");
const workStack = document.querySelector<HTMLElement>(".work__stack");
const projectCards = Array.from(document.querySelectorAll<HTMLElement>(".project-card"));

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

  if (workStack && projectCards.length > 0 && !reduceMotion) {
    const stackTop = workStack.getBoundingClientRect().top + scrollTop;
    const stackRange = Math.max(workStack.offsetHeight - window.innerHeight, 1);
    const stackProgress = Math.min(Math.max((scrollTop - stackTop) / stackRange, 0), 1);
    const activePosition = stackProgress * projectCards.length;

    projectCards.forEach((card, index) => {
      const localProgress = Math.min(Math.max(activePosition - index, 0), 1);
      const xPosition = -72 + localProgress * 148;
      const fadeIn = Math.min(localProgress / 0.16, 1);
      const fadeOut = Math.min((1 - localProgress) / 0.16, 1);
      const opacity = Math.max(0, Math.min(fadeIn, fadeOut));
      const centerWeight = 1 - Math.min(Math.abs(localProgress - 0.5) * 2, 1);

      card.style.setProperty("--card-x", `${xPosition.toFixed(2)}vw`);
      card.style.setProperty("--card-opacity", opacity.toFixed(3));
      card.style.setProperty("--card-scale", (0.92 + centerWeight * 0.08).toFixed(3));
      card.style.setProperty("--card-z", `${Math.round(centerWeight * 80)}px`);
      card.style.setProperty("--card-pointer", opacity > 0.45 ? "auto" : "none");
      card.style.zIndex = `${Math.round(20 + centerWeight * 30 + index)}`;
    });
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

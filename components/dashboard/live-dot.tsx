export function LiveDot({ live }: { live: boolean }) {
  return (
    <span className="relative inline-flex h-4 w-4 shrink-0" role="img" aria-label={live ? "Online" : "Offline"}>
      {live ? (
        <>
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 motion-safe:animate-live-ping" />
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 motion-safe:animate-live-ping motion-safe:[animation-delay:900ms]" />
        </>
      ) : null}
      <span className={`relative inline-flex h-4 w-4 rounded-full ${live ? "bg-emerald-500" : "bg-rose-500"}`} />
    </span>
  );
}

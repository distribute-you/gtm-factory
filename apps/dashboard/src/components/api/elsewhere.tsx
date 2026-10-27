import Link from "next/link";

/** A route the current data source does not serve: one sentence and the way back. */
export function NotHere({ api }: { api: boolean }) {
  return (
    <div className="mx-auto max-w-[640px] px-6 py-16">
      <h1 className="text-[28px] font-medium leading-[34px] tracking-[-0.02em]">{api ? "This page reads the simulator" : "This page reads a running GTM Factory"}</h1>
      <p className="k-fg2 mt-2 text-[14px]">
        {api ? "This GTM Factory runs for real, so it has no simulated world to show here." : "This build runs the simulator in your browser, with no server behind it."}{" "}
        <Link href="/" className="k-accent">
          Go back to Today
        </Link>
      </p>
    </div>
  );
}

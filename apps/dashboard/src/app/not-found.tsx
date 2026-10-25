import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-[640px] px-6 py-16">
      <h1 className="text-[28px] font-medium leading-[34px] tracking-[-0.02em]">This page is not in the factory</h1>
      <p className="k-fg2 mt-2 text-[14px]">
        <Link href="/" className="k-accent">
          Go back to Today
        </Link>
      </p>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

/** The old Check page is part of Scan now: /check links land on the same address there. */
export function CheckRedirect() {
  const router = useRouter();
  const params = useSearchParams();
  const query = params.toString();
  const target = `/scan${query ? `?${query}` : ""}`;

  useEffect(() => {
    router.replace(target);
  }, [router, target]);

  return (
    <main className="page main">
      <p className="lede">
        This page moved to{" "}
        <Link className="link" href={target}>
          Scan
        </Link>
        .
      </p>
    </main>
  );
}

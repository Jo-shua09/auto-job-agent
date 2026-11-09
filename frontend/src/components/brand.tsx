import Image from "next/image";
import { cn } from "@/lib/utils";
import brandIcon from "../../assets/icon.jpg";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("size-9 shrink-0 overflow-hidden rounded-xl border border-primary/20 shadow-glow", className)}>
      <Image src={brandIcon} alt="" className="size-full object-cover" />
    </span>
  );
}

export function BrandName({ className }: { className?: string }) {
  return (
    <span className={cn("ui-title truncate text-[1.0625rem]", className)}>
      Verdant
    </span>
  );
}

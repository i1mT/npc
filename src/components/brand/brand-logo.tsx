import Image from "next/image";
import Link from "next/link";
import { LOGO_PATH, SITE_NAME } from "@/lib/brand";

type BrandLogoProps = {
  href?: string;
  className?: string;
  imageClassName?: string;
  textClassName?: string;
  showText?: boolean;
  priority?: boolean;
};

export function BrandLogo({
  href = "/",
  className = "",
  imageClassName = "h-9 w-9",
  textClassName = "font-serif text-lg font-bold tracking-tight",
  showText = true,
  priority = false,
}: BrandLogoProps) {
  const content = (
    <>
      <Image
        src={LOGO_PATH}
        alt=""
        width={48}
        height={48}
        className={`shrink-0 object-cover ${imageClassName}`}
        priority={priority}
      />
      {showText ? <span className={textClassName}>{SITE_NAME}</span> : null}
    </>
  );

  return (
    <Link href={href} className={`inline-flex items-center gap-2 ${className}`} aria-label={SITE_NAME}>
      {content}
    </Link>
  );
}

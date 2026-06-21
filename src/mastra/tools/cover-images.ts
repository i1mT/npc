import { articleCoverUrl } from "@/lib/cover";

const BAD_IMAGE_HINTS = [
  "avatar",
  "badge",
  "favicon",
  "icon",
  "logo",
  "pixel",
  "share",
  "spacer",
  "tracking",
];

export function isUsableCoverImageUrl(value: string | null | undefined) {
  if (!value) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const normalized = `${url.hostname}${url.pathname}${url.search}`.toLowerCase();
  return !BAD_IMAGE_HINTS.some((hint) => normalized.includes(hint));
}

export function selectPublishImageUrl(input: {
  sourceId: string;
  sourceImageUrl: string | null | undefined;
  submittedImageUrl: string | null | undefined;
}) {
  if (isUsableCoverImageUrl(input.sourceImageUrl)) return input.sourceImageUrl as string;
  if (isUsableCoverImageUrl(input.submittedImageUrl)) return input.submittedImageUrl as string;
  return articleCoverUrl(input.sourceId);
}

import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { queryArticles, getArticleSourcesByIds } = await import("../src/db/articles");
  const { articleCoverUrl } = await import("../src/lib/cover");
  const { isUsableCoverImageUrl, selectPublishImageUrl } = await import("../src/mastra/tools/cover-images");
  const { getTavilyToolsets, disconnectTavilyMcp } = await import("../src/mastra/tools/tavily-mcp");

  const sources = await queryArticles({ day: 1, limit: 8 });
  if (!sources.length) throw new Error("Expected at least one source article.");

  const existing = await getArticleSourcesByIds([sources[0].id, "missing-source-id"]);
  if (existing.size !== 1) throw new Error(`Expected one mapped source, got ${existing.size}.`);

  const source = existing.get(sources[0].id);
  if (!source) throw new Error("Expected source id to be present in lookup result.");
  if (source.sourceUrl !== sources[0].sourceUrl) throw new Error("Mapped sourceUrl should match queryArticles result.");

  const sourceImage = "https://example.com/source-cover.jpg";
  const tavilyImage = "https://example.com/tavily-cover.jpg";
  const fallback = articleCoverUrl(source.id);

  if (selectPublishImageUrl({ sourceId: source.id, sourceImageUrl: sourceImage, submittedImageUrl: tavilyImage }) !== sourceImage) {
    throw new Error("Source image must win over editor-submitted Tavily image.");
  }

  if (selectPublishImageUrl({ sourceId: source.id, sourceImageUrl: null, submittedImageUrl: tavilyImage }) !== tavilyImage) {
    throw new Error("Valid editor-submitted image should be used when source image is missing.");
  }

  if (selectPublishImageUrl({ sourceId: source.id, sourceImageUrl: null, submittedImageUrl: "http://example.com/icon.png" }) !== fallback) {
    throw new Error("Invalid editor-submitted image should fall back to deterministic cover.");
  }

  if (isUsableCoverImageUrl("https://example.com/favicon.png")) {
    throw new Error("Favicon URLs should not be accepted as cover images.");
  }

  process.env.TAVILY_API_KEY = "";
  const toolsets = await getTavilyToolsets();
  if (Object.keys(toolsets).length !== 0) throw new Error("Tavily toolsets should be empty without TAVILY_API_KEY.");
  await disconnectTavilyMcp();

  console.log(JSON.stringify({ ok: true, checkedSourceId: source.id }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});

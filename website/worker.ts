import { createFileResponse } from "remix/response/file";
import { router } from "./app/router.ts";

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env) {
    // Static assets do not provide byte ranges locally. Give the short demo proper
    // range responses so browsers can seek consistently in preview and production.
    if (
      new URL(request.url).pathname === "/demo.mp4" &&
      ["GET", "HEAD"].includes(request.method)
    ) {
      const asset = await env.ASSETS.fetch(new Request(request.url));
      if (!asset.ok) return asset;
      const file = new File([await asset.blob()], "demo.mp4", {
        type: "video/mp4",
      });
      return createFileResponse(file, request, {
        acceptRanges: true,
        etag: "strong",
        lastModified: false,
        cacheControl: "public, max-age=3600",
      });
    }
    return router.fetch(request);
  },
};

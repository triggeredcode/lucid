# syntax=docker/dockerfile:1
#
# The render stage of the Lucid intro video. It needs only three things, all pinned here:
#   - Chromium (the one Playwright 1.64.0 expects, already in the base image) to draw every frame,
#   - FFmpeg (x264 and AAC) to encode them,
#   - the iA Writer Mono font (an npm package, so the exact files are in package-lock.json).
# The captures, the narration and the timeline are NOT in the image: they are mounted at run time (see compose.yaml).

# Playwright's own image: Ubuntu 24.04 (noble) with Node 24 and the matching browsers (Chromium 1248). Pinned by tag AND by
# digest, so the base cannot change under the build (`docker buildx imagetools inspect <tag>` prints the current digest).
FROM mcr.microsoft.com/playwright:v1.64.0-noble@sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/* \
 && ffmpeg -hide_banner -version | head -1

WORKDIR /app
COPY package.json package-lock.json ./
# Only what the render needs (Playwright and the font); the MCP client is used by the capture, on the host.
RUN npm ci --omit=dev --no-audit --no-fund
COPY render ./render
COPY script ./script

# Same rendering on every machine: a fixed colour profile, no font hinting, no GPU.
ENV TZ=UTC LANG=C.UTF-8
CMD ["node", "render/render.mjs"]

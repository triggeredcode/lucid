# The whole pipeline, one command per stage. Run from the video/ folder.
#
#   make install   # npm packages (Playwright, the font, the MCP client used by the capture)
#   make narrate   # HOST: the owner's voice from the local voice server, listened to again with Whisper
#   make capture   # HOST: the real Lucid app against the real model in LM Studio (needs `pnpm build` at the root first)
#   make plan      # the director: narration + capture -> .cache/render/timeline.json
#   make render    # CONTAINER: the video, the poster and the GIF
#   make gif       # CONTAINER: only the short looping GIF for the README
#   make all       # all of it
#
# Without Docker the render stage also runs on the host: `make render-host`.

.PHONY: install narrate capture plan render render-host poster poster-host gif gif-host all clean

install:
	npm ci

narrate:
	node narration/narrate.mjs

capture:
	cd .. && pnpm build
	node capture/capture.mjs

plan:
	node render/plan.mjs

render:
	docker compose build render
	docker compose run --rm render

render-host: plan
	node render/render.mjs
	node render/render.mjs --poster

poster:
	docker compose build render
	docker compose run --rm render sh -c "node render/plan.mjs && node render/render.mjs --poster"

poster-host: plan
	node render/render.mjs --poster

# The short looping demo for the README (about 10 s, 900 px wide, under 8 MB): out/lucid-demo.gif
gif:
	docker compose build render
	docker compose run --rm render sh -c "node render/plan.mjs --gif && node render/render.mjs --gif"

gif-host:
	node render/plan.mjs --gif
	node render/render.mjs --gif

all: narrate capture render

clean:
	rm -rf out .cache/render

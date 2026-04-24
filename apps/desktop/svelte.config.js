import svelteInjectComment from "@gitbutler/svelte-comment-injector";
import staticAdapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

const outDir = process.env.SVELTEKIT_OUT_DIR || "build";

const config = {
	preprocess: [vitePreprocess({ script: true }), svelteInjectComment()],
	kit: {
		alias: {
			$components: "./src/components",
		},
		adapter: staticAdapter({
			pages: outDir,
			assets: outDir,
			fallback: "index.html",
			precompress: false,
			strict: false,
		}),
	},
	compilerOptions: {
		css: "external",
	},
};

export default config;

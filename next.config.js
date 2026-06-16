const path = require('path')

/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'export',
    // `next build` (export) writes to publish/ (the Firebase hosting dir); `next dev`
    // uses the default .next/ so the dev server never clobbers the deployable build.
    distDir: process.env.NODE_ENV === 'production' ? 'publish' : '.next',
    cleanDistDir: true,
    // Relative asset paths are only needed for the static export hosted on Firebase.
    // In `next dev` this breaks `/_next` asset URLs (CSS 404s), so apply it prod-only.
    assetPrefix: process.env.NODE_ENV === 'production' ? '.' : undefined,
    productionBrowserSourceMaps: true,
    reactStrictMode: true,
    webpack: (config, options) => {
        config.experiments = {
            asyncWebAssembly: true,
            layers: true,
        }
        // Transformers.js (used by the on-device Ask AI) only ever runs in the
        // browser (WebGPU/WASM). Its package `exports` route Next's server compile
        // to a Node build that bundles onnxruntime-node's native .node binary and
        // unresolvable .wasm imports. Force the web build in every compile (it's
        // never executed server-side) and stub the native module out.
        config.resolve.alias = {
            ...config.resolve.alias,
            '@huggingface/transformers$': path.resolve(
                __dirname,
                'node_modules/@huggingface/transformers/dist/transformers.web.js'
            ),
            'onnxruntime-node': false,
        }
        return config
    },
}

module.exports = nextConfig

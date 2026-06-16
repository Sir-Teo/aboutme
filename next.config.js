const path = require('path')

/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'export',
    // `next build` (export) writes to publish/ (the Firebase hosting dir); `next dev`
    // uses the default .next/ so the dev server never clobbers the deployable build.
    distDir: process.env.NODE_ENV === 'production' ? 'publish' : '.next',
    cleanDistDir: true,
    productionBrowserSourceMaps: false,
    reactStrictMode: true,
    webpack: (config, options) => {
        config.experiments = {
            asyncWebAssembly: true,
            layers: true,
        }
        config.ignoreWarnings = [
            ...(config.ignoreWarnings || []),
            warning =>
                /@huggingface\/transformers\/dist\/transformers\.web\.js/.test(String(warning.module?.resource)) &&
                /Accessing import\.meta directly is unsupported/.test(String(warning.message)),
        ]
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

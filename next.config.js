/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'export',
    // `next build` (export) writes to publish/ (the Firebase hosting dir); `next dev`
    // uses the default .next/ so the dev server never clobbers the deployable build.
    distDir: process.env.NODE_ENV === 'production' ? 'publish' : '.next',
    cleanDistDir: true,
    dir: "./app/",
    assetPrefix: ".",
    productionBrowserSourceMaps: true,
    reactStrictMode: true,
    webpack: (config, options) => {
        config.experiments = {
            asyncWebAssembly: true,
            layers: true,
        }
        return config
    },
}

module.exports = nextConfig

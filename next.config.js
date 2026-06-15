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
        return config
    },
}

module.exports = nextConfig

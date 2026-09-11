import type { MetadataRoute } from 'next'
import { profile } from './data/profile'

// `output: export` requires metadata routes to opt in to static generation.
export const dynamic = 'force-static'

export default function robots(): MetadataRoute.Robots {
    return {
        rules: { userAgent: '*', allow: '/' },
        sitemap: `${profile.url}/sitemap.xml`,
    }
}

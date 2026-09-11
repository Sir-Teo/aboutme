import type { MetadataRoute } from 'next'
import { profile } from './data/profile'

// `output: export` requires metadata routes to opt in to static generation.
export const dynamic = 'force-static'

// One page, one entry. No lastModified: it would change on every build and make
// the deploy look dirty when nothing actually changed.
export default function sitemap(): MetadataRoute.Sitemap {
    return [{ url: profile.url, changeFrequency: 'monthly', priority: 1 }]
}

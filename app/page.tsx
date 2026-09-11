import { profile, links } from './data/profile'
import Links from './components/Links'
import Image from 'next/image'

// schema.org Person, derived from the same link data the page renders, so the
// structured description can never drift from what is on screen. Invisible to
// readers; it is what lets search engines tie all these profiles to one person.
function personJsonLd() {
    const email = links.find(l => l.href?.startsWith('mailto:'))?.href?.slice('mailto:'.length)
    return {
        '@context': 'https://schema.org',
        '@type': 'Person',
        name: profile.name,
        url: profile.url,
        image: `${profile.url}${profile.avatar}`,
        description: profile.description,
        jobTitle: profile.jobTitle,
        homeLocation: { '@type': 'Place', name: profile.location },
        ...(email ? { email } : {}),
        sameAs: links.filter(l => l.href?.startsWith('http')).map(l => l.href),
    }
}

export default function Home() {
    return (
        <main className="mx-auto max-w-2xl px-5 py-8 sm:px-6 sm:py-10 lg:max-w-3xl lg:py-12">
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(personJsonLd()) }} />
            <header className="flex flex-row items-center gap-4 sm:gap-5">
                <span className="avatar-ring shrink-0">
                    <Image
                        src={profile.avatar}
                        alt={`${profile.name} avatar`}
                        title={profile.avatarCredit}
                        width={96}
                        height={96}
                        priority
                        unoptimized
                        className="h-16 w-16 shrink-0 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-700 sm:h-24 sm:w-24"
                    />
                </span>
                <div>
                    <h1 className="site-name text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 sm:text-3xl">
                        {profile.name}
                    </h1>
                    <p className="mt-1.5 max-w-md text-[14px] leading-snug text-slate-500 dark:text-slate-400 sm:mt-2 sm:text-[15px] sm:leading-relaxed">
                        {profile.tagline}
                    </p>
                </div>
            </header>

            <section className="mt-6 sm:mt-7">
                <Links />
            </section>

            <p className="mt-4 text-[13px] leading-snug text-slate-500 dark:text-slate-400 sm:mt-6 sm:text-sm">
                I built{' '}
                <a
                    href="https://finos.teozeng.dev/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-slate-700 underline decoration-slate-300 underline-offset-2 transition hover:decoration-slate-500 dark:text-slate-200 dark:decoration-slate-600 dark:hover:decoration-slate-400"
                >
                    FinOS AgentLab
                </a>{' '}
                — now retired, but the site is still up if you want a look.
            </p>

            <p className="mt-2 text-[13px] leading-snug text-slate-500 dark:text-slate-400 sm:mt-3 sm:text-sm">
                These days I&apos;m building{' '}
                <a
                    href="https://coc.teozeng.dev/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-slate-700 underline decoration-slate-300 underline-offset-2 transition hover:decoration-slate-500 dark:text-slate-200 dark:decoration-slate-600 dark:hover:decoration-slate-400"
                >
                    a browser game
                </a>
                .
            </p>
        </main>
    )
}

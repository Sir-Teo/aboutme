import { profile } from './data/profile'
import Links from './components/Links'
import Image from 'next/image'

export default function Home() {
    return (
        <main className="mx-auto max-w-2xl px-5 py-8 sm:px-6 sm:py-10 lg:max-w-3xl lg:py-12">
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
                I&apos;m building{' '}
                <a
                    href="https://sir-teo.github.io/FinOS-AgentLab"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-slate-700 underline decoration-slate-300 underline-offset-2 transition hover:decoration-slate-500 dark:text-slate-200 dark:decoration-slate-600 dark:hover:decoration-slate-400"
                >
                    FinOS AgentLab
                </a>{' '}
                — if you&apos;re interested, join the waitlist!
            </p>
        </main>
    )
}

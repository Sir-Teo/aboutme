import { profile } from './data/profile'
import Links from './components/Links'
import Image from 'next/image'

export default function Home() {
    return (
        <main className="mx-auto max-w-2xl px-6 py-16 sm:py-24">
            <header className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
                <span className="avatar-ring shrink-0">
                    <Image
                        src={profile.avatar}
                        alt={`${profile.name} avatar`}
                        title={profile.avatarCredit}
                        width={96}
                        height={96}
                        priority
                        unoptimized
                        className="h-24 w-24 shrink-0 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-700"
                    />
                </span>
                <div>
                    <h1 className="site-name text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                        {profile.name}
                    </h1>
                    <p className="mt-2 max-w-md text-[15px] leading-relaxed text-slate-500 dark:text-slate-400">
                        {profile.tagline}
                    </p>
                </div>
            </header>

            <section className="mt-8">
                <Links />
            </section>
        </main>
    )
}

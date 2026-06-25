import { profile } from './data/profile'
import Links from './components/Links'
import Image from 'next/image'

export default function Home() {
    return (
        <main className="mx-auto max-w-2xl px-5 py-3 sm:px-6 sm:py-10 lg:py-12">
            <header className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-5">
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
                    <p className="mt-1.5 max-w-md text-[14px] leading-relaxed text-slate-500 dark:text-slate-400 sm:mt-2 sm:text-[15px]">
                        {profile.tagline}
                    </p>
                </div>
            </header>

            <section className="mt-4 sm:mt-7">
                <Links />
            </section>
        </main>
    )
}

import React from 'react'
import experience from '../api/mockinfo/experience'
import { map as _map } from 'lodash'
import { formatEnDateMY } from '@/app/util/date'
import ReactMarkdown from 'react-markdown'

const Experience = () => {
  const { data, title } = experience || {}

  return (
    <div className="experience-module p-4 w-full flex flex-col items-start gap-4 min-w-[35rem]">
      {/* Title */}
      <div className="text-left text-slate-800 text-2xl font-medium leading-none tracking-tight dark:text-zinc-200">
        {title}
      </div>
      {/* Experience Items */}
      <div className="w-full flex flex-col items-start gap-6">
        {_map(data, (item, index) => {
          const {
            logo,
            hireDate,
            lastDay,
            companyFullname,
            companyAbb,
            jobTitle,
            city,
            Responsibilities,
          } = item || {}

          const hireDateFormatted = formatEnDateMY(hireDate)
          const lastDayFormatted = formatEnDateMY(lastDay)

          return (
            <div
              key={`experience_${index}`}
              className="w-full flex items-start gap-4 mb-6 last:mb-0"
            >
              {/* Timeline Dot */}
              <div className="flex flex-col justify-center items-center">
                <div className="relative w-3 h-3 rounded-full">
                  <img
                    src="./misc/dot_04_l.svg"
                    className="absolute w-4 h-4"
                    alt="timeline dot"
                  />
                  {/* Inner dot can be styled further if needed */}
                  <div className="absolute w-2 h-2 p-0.5 left-[2.25px] top-[2.25px]" />
                </div>
              </div>
              {/* Content */}
              <div className="flex flex-col w-full">
                {/* Header (Dates and Location) */}
                <div className="flex justify-between items-center text-left">
                  <div className="text-slate-600 text-xs font-normal tracking-tight dark:text-stone-400">
                    {hireDateFormatted} - {lastDayFormatted}
                  </div>
                  {city && (
                    <div className="flex items-center ml-2">
                      <img
                        src="./misc/location.svg"
                        className="w-4 h-4 mr-1"
                        alt="location icon"
                      />
                      <div className="text-slate-500 text-xs font-normal tracking-tight dark:text-stone-300">
                        {city}
                      </div>
                    </div>
                  )}
                </div>
                {/* Job Info */}
                <div className="flex items-center mt-2 text-left">
                  <div className="w-7 h-7 relative rounded shadow overflow-hidden">
                    <img
                      src={logo}
                      alt={`${companyAbb} logo`}
                      className="w-full h-full"
                    />
                  </div>
                  <div className="flex flex-col ml-2">
                    <div className="text-slate-500 text-xs font-normal leading-3 tracking-tight dark:text-stone-300">
                      {jobTitle}
                    </div>
                    <div className="text-stone-600 text-lg font-bold leading-3 mt-2 dark:text-stone-200">
                      {companyAbb}
                    </div>
                  </div>
                </div>
                {/* Responsibilities */}
                <div className="mt-4 pl-4 text-slate-500 text-sm font-normal tracking-tight dark:text-gray-400 text-left">
                  <ReactMarkdown>{Responsibilities}</ReactMarkdown>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default Experience

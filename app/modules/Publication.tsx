import research from '../api/mockinfo/publication'
import { map as _map, isEmpty as _isEmpty } from 'lodash'
import { Fragment } from 'react'
import AlphabetSvg, { UPPERLOWER } from '../components/AlphabetSvg'

const ResearchExperience = () => {
    const { data, title } = research || {}
    return (
        <div className="research-module">
            <div className="p-4 w-full flex-col  justify-start items-start gap-4 inline-flex  min-w-[35rem]">
                <div className="text-center text-slate-800 text-2xl font-medium leading-none tracking-tight dark:text-zinc-200">
                    {title}
                </div>
                <div className="self-stretch flex-col justify-start items-start pt-2 flex pb-2 relative">
                    {_map(data, (project, pIndex) => {
                        const { tags, url} = project || {}
                        const tagsText = _isEmpty(tags) ? undefined : tags.join(` · `)
                        return (
                            <div
                                className="self-stretch justify-center items-start gap-2 flex-col   mb-6 last:mb-0"
                                key={`research_${pIndex}`}
                            >
                                <div className="top-info grow shrink basis-0 text-lg font-medium self-stretch mb-0.5 justify-center items-end gap-1 flex align-text-bottom">
                                    <div className=" text-slate-700 tracking-tight relative h-5 w-[50rem] dark:text-stone-200">
                                        <div className="absolute left-0 -top-[0.125rem]">
                                            <div className="left-0 -top-[2px] inline-block mr-2 justify-items-center rounded-sm relative">
                                                
                                            </div>
                                        </div>
                                    </div>
                                    {url ? (
                                    <a href = {url} className="pl-4 grow shrink basis-0 tracking-tight">
                                        <div className="float-right text-sm">
                                            <div className="text-blue-500 text-xs font-medium leading-3 cursor-pointer w-20 text-right">
                                                Code
                                                <img src="./misc/code.svg" className="w-3 h-3 inline" />
                                            </div>
                                        </div>
                                    </a>) : null
                                    }
                
                                </div>
                                <div className="flex-col h-[2px] bg-slate-300 w-full mt-1 mb-2" />
                                <div className="flex-col text-xs">
                                    {tagsText ? (
                                        <div className="tags text-slate-400  font-medium leading-3 dark:text-gray-400">
                                            {tagsText}
                                        </div>
                                    ) : null}
                                        <div className="desc text-slate-600 text-sm font-normal leading-1 mt-2 dark:text-gray-300">
                                        <a href = '../pdf/IUCrJournals_XRAIS_jun12.pdf' >Derek Mendez, James M. Holton, Artem Y. Lyubimov, Sabine Hollatz, Irimpan I. Mathews, Alexsander Cichosz, Vardan Martisoyan, <b><u>Teo Zeng</u></b>, Ryan Stofer, Robin Liu, Jinhu Song, Scott McPhillips, Mike Soltis, Aina E. Cohena. <b>XRAIS: Physics-informed artificial intelligence for monitoring crystallography experiments</b>. Submitted.</a>
                                        </div>
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}

export default ResearchExperience



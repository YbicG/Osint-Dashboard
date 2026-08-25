import { Radar } from 'lucide-react'
import { SearchBar } from '@/components/search-bar'

export default function HomePage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <Radar className="h-9 w-9 text-[var(--accent)]" strokeWidth={1.5} />
        <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">Search anything. Get a sourced dossier.</h1>
        <p className="max-w-md text-sm text-[var(--text-secondary)]">
          Every fact in the results traces back to a source, a timestamp, and archived evidence.
        </p>
      </div>
      <SearchBar />
    </div>
  )
}

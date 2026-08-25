import { Check, X, ShieldAlert, AlertTriangle, Loader2, Clock } from 'lucide-react'
import { STATUS_LABELS } from '@/lib/predicate-labels'
import { cn } from '@/lib/cn'

export interface ConnectorChipState {
  id: string
  name: string
  category: string
  status: 'pending' | 'running' | 'hit' | 'miss' | 'blocked' | 'error' | 'skipped_captcha'
  claimsProduced: number
}

const STATUS_STYLE: Record<ConnectorChipState['status'], { border: string; bg: string; text: string; icon: React.ElementType }> = {
  pending: { border: 'border-[var(--border-subtle)]', bg: 'bg-transparent', text: 'text-[var(--text-muted)]', icon: Clock },
  running: { border: 'border-[var(--status-pending)]/40', bg: 'bg-[var(--status-pending)]/10', text: 'text-[var(--status-pending)]', icon: Loader2 },
  hit: { border: 'border-[var(--status-hit)]/40', bg: 'bg-[var(--status-hit)]/10', text: 'text-[var(--status-hit)]', icon: Check },
  miss: { border: 'border-[var(--border-subtle)]', bg: 'bg-transparent', text: 'text-[var(--text-muted)]', icon: X },
  blocked: { border: 'border-[var(--status-blocked)]/40', bg: 'bg-[var(--status-blocked)]/10', text: 'text-[var(--status-blocked)]', icon: ShieldAlert },
  error: { border: 'border-[var(--status-error)]/40', bg: 'bg-[var(--status-error)]/10', text: 'text-[var(--status-error)]', icon: AlertTriangle },
  skipped_captcha: { border: 'border-[var(--status-blocked)]/40', bg: 'bg-[var(--status-blocked)]/10', text: 'text-[var(--status-blocked)]', icon: ShieldAlert },
}

export function ConnectorStatusChip({ chip }: { chip: ConnectorChipState }) {
  const style = STATUS_STYLE[chip.status]
  const Icon = style.icon

  return (
    <div className={cn('flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs', style.border, style.bg)}>
      <Icon className={cn('h-3.5 w-3.5 flex-shrink-0', style.text, chip.status === 'running' && 'animate-spin')} />
      <span className="min-w-0 truncate text-[var(--text-primary)]">{chip.name}</span>
      <span className={cn('flex-shrink-0 text-[10px] uppercase tracking-wide', style.text)}>
        {STATUS_LABELS[chip.status]}
        {chip.status === 'hit' && ` · ${chip.claimsProduced}`}
      </span>
    </div>
  )
}

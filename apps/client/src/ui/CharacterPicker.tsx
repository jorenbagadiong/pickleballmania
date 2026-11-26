import { ATHLETES } from '@pickleball/shared'
import { chooseLook } from '../net/session'
import { useUi } from '../state/store'

/**
 * Who to play as: one of the athletes, or Auto (picked from the nickname, as before).
 * Remembered on this computer and seen the same way by everyone.
 */
export function CharacterPicker({ small = false }: { small?: boolean }) {
  const look = useUi((s) => s.myLook)
  // Tiles share the width; the small row (in a panel) keeps them compact.
  const size = small ? 'h-11 w-9 shrink-0' : 'aspect-[4/5] min-w-0 flex-1'
  const tile = (selected: boolean) =>
    `${size} overflow-hidden rounded-lg border-2 transition ${
      selected
        ? 'border-lime-400 ring-2 ring-lime-400/40'
        : 'border-white/10 opacity-80 hover:border-white/40 hover:opacity-100'
    }`
  return (
    <div
      className="flex items-center justify-between gap-1"
      role="radiogroup"
      aria-label="Character"
      data-testid="character-picker"
    >
      <button
        type="button"
        role="radio"
        aria-checked={look === ''}
        aria-label="Auto: picked from your nickname"
        title="Auto: picked from your nickname"
        data-testid="look-auto"
        className={`${tile(look === '')} bg-slate-800 text-xs font-semibold text-slate-300`}
        onClick={(e) => {
          e.currentTarget.blur()
          chooseLook('')
        }}
      >
        Auto
      </button>
      {ATHLETES.map((a, i) => (
        <button
          key={a}
          type="button"
          role="radio"
          aria-checked={look === a}
          aria-label={`Athlete ${i + 1}`}
          title={`Athlete ${i + 1}`}
          data-testid={`look-${a}`}
          className={`${tile(look === a)} bg-slate-800`}
          onClick={(e) => {
            // Keyboard keys belong to the game afterwards.
            e.currentTarget.blur()
            chooseLook(a)
          }}
        >
          <img
            src={`/models/portraits/${a}.jpg`}
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
          />
        </button>
      ))}
    </div>
  )
}

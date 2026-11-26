import { useEffect } from 'react'
import { GameScene } from './game/GameScene'
import { resumeSavedSession } from './net/session'
import { useUi } from './state/store'
import { Hud } from './ui/Hud'
import { Lobby } from './ui/Lobby'
import { TournamentScreen } from './ui/Tournament'
import { StartScreen } from './ui/StartScreen'

let resumeAttempted = false

function GameView() {
  const phase = useUi((s) => s.phase)
  const tournament = useUi((s) => s.tournament !== null)
  return (
    <div className="fixed inset-0 select-none overflow-hidden bg-sky-200" data-testid="game">
      <GameScene />
      <Hud />
      {tournament ? <TournamentScreen /> : (phase === 'waiting' || phase === 'lobby') && <Lobby />}
    </div>
  )
}

export function App() {
  const screen = useUi((s) => s.screen)

  useEffect(() => {
    // After a refresh, try to reclaim our seat (guarded against StrictMode double-run).
    if (resumeAttempted) return
    resumeAttempted = true
    void resumeSavedSession()
  }, [])

  return screen === 'game' ? <GameView /> : <StartScreen />
}

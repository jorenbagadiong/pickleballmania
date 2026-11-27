import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { installDebugHook } from './debug/debugHook'
import { preloadAthletes } from './players/athlete/assets'
import './index.css'

installDebugHook()

const root = document.getElementById('root')
if (!root) throw new Error('#root element missing')

const query = new URLSearchParams(window.location.search)
// The character viewer is for development and tests only, and never joins a game.
if (query.has('viewer') && (import.meta.env.DEV || query.has('e2e'))) {
  void import('./viewer/Viewer').then(({ Viewer }) => createRoot(root).render(<Viewer />))
} else {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
  // While people type their name and set up a room, fetch the players' bodies.
  setTimeout(preloadAthletes, 500)
}

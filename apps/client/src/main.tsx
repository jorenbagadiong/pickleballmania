import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { installDebugHook } from './debug/debugHook'
import { preloadAthletes } from './players/athlete/assets'
import './index.css'

installDebugHook()

const root = document.getElementById('root')
if (!root) throw new Error('#root element missing')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// While people type their name and set up a room, fetch the players' bodies.
setTimeout(preloadAthletes, 500)

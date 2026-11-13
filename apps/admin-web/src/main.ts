/** Entry point: mount the Base UI admin application. */
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'

const host = document.getElementById('app')
if (host === null) throw new Error('admin root element is missing')
createRoot(host).render(createElement(App))

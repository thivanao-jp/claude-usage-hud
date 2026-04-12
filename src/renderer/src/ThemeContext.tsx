import { createContext, useContext } from 'react'
import { ThemeTokens, themes } from './theme'

export const ThemeContext = createContext<ThemeTokens>(themes.dark)

export function useTheme(): ThemeTokens {
  return useContext(ThemeContext)
}

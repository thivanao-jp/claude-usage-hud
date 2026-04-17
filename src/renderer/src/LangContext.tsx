import { createContext, useContext } from 'react'
import { Lang, TranslationKey, t as rawT } from './i18n'

export const LangContext = createContext<Lang>('en')

/** 現在の言語を返すフック */
export function useLang(): Lang {
  return useContext(LangContext)
}

/** 現在の言語に束縛された翻訳関数を返すフック */
export function useT() {
  const lang = useContext(LangContext)
  return (key: TranslationKey, ...args: (string | number)[]) => rawT(lang, key, ...args)
}

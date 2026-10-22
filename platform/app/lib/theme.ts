import { Cookie } from 'remix/headers'

import { THEME_COOKIE_NAME } from './constants.ts'

export type Theme = 'light' | 'dark'

// The theme the user picked with the theme toggle, or undefined to follow the system preference.
export function getTheme(request: Request): Theme | undefined {
  let theme = Cookie.from(request.headers.get('Cookie')).get(THEME_COOKIE_NAME)
  return theme === 'light' || theme === 'dark' ? theme : undefined
}

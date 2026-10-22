import { redirect } from 'remix/response/redirect'
import { createController } from 'remix/router'

import { isSiteConfigured } from '../../data/config.ts'
import { getPosts } from '../../data/posts/store.ts'
import { routes } from '../../routes.ts'
import { AdminLoginPage, AdminPage } from './admin-page.tsx'
import { checkAdminPassword, isAdminEnabled, isAdminLoggedIn, logInAdmin } from './auth.ts'
import { adminMiddleware, requireAdminLogin } from './middleware.ts'
import { renderAdminPage } from './ui/page.tsx'

function renderLoginPage(request: Request, error?: string) {
  let page = <AdminLoginPage enabled={isAdminEnabled} error={error} />
  return renderAdminPage(request, 'Log in', page, error ? { status: 401 } : undefined, {
    loggedIn: false,
  })
}

export default createController(routes.admin, {
  middleware: adminMiddleware,
  actions: {
    index: {
      middleware: [requireAdminLogin()],
      async handler(context) {
        // The site's required settings come first.
        if (!isSiteConfigured()) return redirect(routes.admin.config.index.href())
        let page = <AdminPage posts={await getPosts()} />
        return context.render(...renderAdminPage(context.request, 'Manage Site', page))
      },
    },
    login(context) {
      if (isAdminLoggedIn(context.session)) return redirect(routes.admin.index.href())
      return context.render(...renderLoginPage(context.request))
    },
    authenticate(context) {
      if (!checkAdminPassword(context.formData.get('password'))) {
        return context.render(...renderLoginPage(context.request, 'That password isn’t right.'))
      }
      logInAdmin(context.session)
      return redirect(routes.admin.index.href())
    },
    logout(context) {
      context.session.destroy()
      return redirect(routes.admin.login.href())
    },
  },
})

import { redirect } from 'remix/response/redirect'
import { createController } from 'remix/router'

import { isSiteConfigured } from '../../data/config.ts'
import { getPosts } from '../../data/posts.ts'
import { getTheme } from '../../lib/theme.ts'
import { routes } from '../../routes.ts'
import { Document } from '../document.tsx'
import { AdminLoginPage, AdminLogoutButton, AdminPage } from './admin-page.tsx'
import { checkAdminPassword, isAdminEnabled, isAdminLoggedIn, logInAdmin } from './auth.ts'
import { adminMiddleware, requireAdminLogin } from './middleware.ts'

export default createController(routes.admin, {
  middleware: adminMiddleware,
  actions: {
    index: {
      middleware: [requireAdminLogin()],
      async handler(context) {
        // The site's required settings come first.
        if (!isSiteConfigured()) return redirect(routes.admin.config.index.href())
        return context.render(
          <Document
            theme={getTheme(context.request)}
            meta={{ path: context.url.pathname, title: 'Manage Site', noindex: true }}
            navActions={<AdminLogoutButton />}
          >
            <AdminPage posts={await getPosts()} />
          </Document>,
        )
      },
    },
    login(context) {
      if (isAdminLoggedIn(context.session)) return redirect(routes.admin.index.href())
      return context.render(
        <Document
          theme={getTheme(context.request)}
          meta={{ path: context.url.pathname, title: 'Log in', noindex: true }}
        >
          <AdminLoginPage enabled={isAdminEnabled} />
        </Document>,
      )
    },
    authenticate(context) {
      if (!checkAdminPassword(context.formData.get('password'))) {
        return context.render(
          <Document
            theme={getTheme(context.request)}
            meta={{ path: context.url.pathname, title: 'Log in', noindex: true }}
          >
            <AdminLoginPage enabled={isAdminEnabled} error="That password isn’t right." />
          </Document>,
          { status: 401 },
        )
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

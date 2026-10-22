import { redirect } from 'remix/response/redirect'
import { createController } from 'remix/router'

import { deletePost } from '../../../data/posts/mutations.ts'
import { routes } from '../../../routes.ts'
import { adminMiddleware, requireAdminLogin } from '../middleware.ts'
import { renderPostNotFound } from './post-form.tsx'

export default createController(routes.admin.posts, {
  middleware: [...adminMiddleware, requireAdminLogin()],
  actions: {
    async delete(context) {
      if (!(await deletePost(context.params.id))) {
        return context.render(...renderPostNotFound(context.request))
      }
      return redirect(routes.admin.index.href(), 303)
    },
  },
})

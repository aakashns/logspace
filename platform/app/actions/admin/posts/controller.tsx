import { redirect } from 'remix/response/redirect'
import { createController } from 'remix/router'

import { db } from '../../../data/db.ts'
import { deletePostFiles } from '../../../data/media.ts'
import { posts } from '../../../data/tables.ts'
import { routes } from '../../../routes.ts'
import { adminMiddleware, requireAdminLogin } from '../middleware.ts'
import { renderPostNotFound } from './post-form.tsx'

export default createController(routes.admin.posts, {
  middleware: [...adminMiddleware, requireAdminLogin()],
  actions: {
    // Its media files go too. The post goes first: if removing a file fails, the files left over
    // aren't served, while a post whose files were removed first would show broken media.
    async delete(context) {
      let { id } = context.params
      let deleted = await db.delete(posts, id)
      if (!deleted) return context.render(...renderPostNotFound(context.request))
      await deletePostFiles(id)
      return redirect(routes.admin.index.href(), 303)
    },
  },
})

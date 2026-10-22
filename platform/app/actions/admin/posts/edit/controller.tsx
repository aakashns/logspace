import { redirect } from 'remix/response/redirect'
import { createController } from 'remix/router'

import { db } from '../../../../data/db.ts'
import { listPostFiles } from '../../../../data/media.ts'
import { fromPostRecord, posts, toPostRecord } from '../../../../data/tables.ts'
import { routes } from '../../../../routes.ts'
import { adminMiddleware, requireAdminLogin } from '../../middleware.ts'
import {
  readPostForm,
  savePostUploads,
  validatePostForm,
  type PostFormValues,
} from '../form-values.ts'
import { renderPostForm, renderPostNotFound } from '../post-form.tsx'

export default createController(routes.admin.posts.edit, {
  middleware: [...adminMiddleware, requireAdminLogin()],
  actions: {
    async index(context) {
      let { id } = context.params
      let row = await db.find(posts, id)
      if (!row) return context.render(...renderPostNotFound(context.request))
      // Rows are only written after passing the post format's checks, so they fit the form.
      let values = toPostRecord(row) as unknown as PostFormValues
      let files = await listPostFiles(id)
      return context.render(...renderPostForm(context.request, { isNew: false, values, files }))
    },
    async action(context) {
      let { id } = context.params
      let row = await db.find(posts, id)
      if (!row) return context.render(...renderPostNotFound(context.request))
      let { values, uploads, issues } = readPostForm(context.formData, id, row.type)
      await savePostUploads(id, uploads)
      let result = await validatePostForm(values, issues)
      if (!result.success) {
        let { issues } = result
        let files = await listPostFiles(id)
        return context.render(
          ...renderPostForm(context.request, { isNew: false, values, files, issues }),
        )
      }

      await db.update(posts, id, {
        ...fromPostRecord(result.record),
        updated_at: new Date().toISOString(),
      })
      return redirect(routes.posts.show.href({ id }), 303)
    },
  },
})

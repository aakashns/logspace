import { redirect } from 'remix/response/redirect'
import { createController } from 'remix/router'

import { listPostFiles } from '../../../../data/media.ts'
import { updatePost } from '../../../../data/posts/mutations.ts'
import { getPostRecord } from '../../../../data/posts/store.ts'
import { routes } from '../../../../routes.ts'
import { adminMiddleware, requireAdminLogin } from '../../middleware.ts'
import { readPostForm } from '../form-values.ts'
import { renderPostForm, renderPostNotFound } from '../post-form.tsx'

export default createController(routes.admin.posts.edit, {
  middleware: [...adminMiddleware, requireAdminLogin()],
  actions: {
    async index(context) {
      let { id } = context.params
      let values = await getPostRecord(id)
      if (!values) return context.render(...renderPostNotFound(context.request))
      let files = await listPostFiles(id)
      return context.render(...renderPostForm(context.request, { isNew: false, values, files }))
    },
    async action(context) {
      let { id } = context.params
      let existing = await getPostRecord(id)
      if (!existing) return context.render(...renderPostNotFound(context.request))
      let form = readPostForm(context.formData, id, existing.type)
      let result = await updatePost(id, form)
      if (!result) return context.render(...renderPostNotFound(context.request))
      if (result.success) return redirect(routes.posts.show.href({ id }), 303)
      let files = await listPostFiles(id)
      let { issues } = result
      return context.render(
        ...renderPostForm(context.request, { isNew: false, values: form.post, files, issues }),
      )
    },
  },
})
